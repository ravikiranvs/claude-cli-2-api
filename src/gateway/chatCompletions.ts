import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import type { ClaudeSubprocess } from "../claude/types.js";
import { insertTrace } from "../db/traces.js";
import { gatewayErrorBody } from "./errorBody.js";

export const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";

interface ChatMessage {
  role: string;
  content: string;
}

interface ChatCompletionRequestBody {
  model?: string;
  messages?: ChatMessage[];
}

interface TextPart {
  type: string;
  text: string;
}

function isTextPart(value: unknown): value is TextPart {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "text";
}

function joinTextParts(parts: unknown[]): string | null {
  const textParts = parts.filter(isTextPart).map((part) => part.text);
  return textParts.length > 0 ? textParts.join("") : null;
}

function isValidMessages(messages: unknown): messages is ChatMessage[] {
  return (
    Array.isArray(messages) &&
    messages.length > 0 &&
    messages.every(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        typeof (message as ChatMessage).role === "string" &&
        typeof (message as ChatMessage).content === "string",
    )
  );
}

function buildPrompt(messages: ChatMessage[]): string {
  return messages.map((message) => `${message.role}: ${message.content}`).join("\n\n");
}

/**
 * Reads the newline-delimited `stream-json` events emitted by a Claude Subprocess and
 * picks out the final assistant text, preferring the terminal `result` event when present.
 */
function extractAssistantText(raw: string): string {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let text: string | null = null;

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const event = parsed as Record<string, unknown>;

    if (event.type === "assistant" && typeof event.message === "object" && event.message !== null) {
      const message = event.message as Record<string, unknown>;
      if (Array.isArray(message.content)) {
        text = joinTextParts(message.content) ?? text;
      }
    } else if (event.type === "result" && typeof event.result === "string") {
      text = event.result;
    }
  }

  if (text === null) {
    throw new Error("Claude Subprocess produced no parseable assistant output");
  }

  return text;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function registerChatCompletionsRoute(
  server: FastifyInstance,
  db: Database.Database,
  claudeSubprocess: ClaudeSubprocess,
): void {
  server.post<{ Body: ChatCompletionRequestBody }>(CHAT_COMPLETIONS_PATH, async (request, reply) => {
    const { model, messages } = request.body ?? {};
    const requestBodyJson = JSON.stringify(request.body ?? {});
    const gatewayApiKeyId = request.gatewayApiKeyId ?? null;

    const recordTrace = (httpStatus: number, responseBody: unknown, tokenCount: number | null): void => {
      insertTrace(db, {
        gatewayApiKeyId,
        endpoint: CHAT_COMPLETIONS_PATH,
        httpStatus,
        requestBody: requestBodyJson,
        responseBody: JSON.stringify(responseBody),
        tokenCount,
      });
    };

    if (typeof model !== "string" || model.length === 0 || !isValidMessages(messages)) {
      const body = gatewayErrorBody(
        "`model` and a non-empty `messages` array (each with string `role` and `content`) are required",
        "invalid_request_error",
      );
      recordTrace(400, body, null);
      reply.status(400).send(body);
      return;
    }

    let raw: string;
    try {
      raw = (await claudeSubprocess.send(buildPrompt(messages))).raw;
    } catch (err) {
      const body = gatewayErrorBody(
        `Claude Subprocess failed: ${err instanceof Error ? err.message : String(err)}`,
        "api_error",
      );
      recordTrace(502, body, null);
      reply.status(502).send(body);
      return;
    }

    let assistantText: string;
    try {
      assistantText = extractAssistantText(raw);
    } catch (err) {
      const body = gatewayErrorBody(
        `Claude Subprocess returned an unparseable response: ${err instanceof Error ? err.message : String(err)}`,
        "api_error",
      );
      recordTrace(502, body, null);
      reply.status(502).send(body);
      return;
    }

    const promptTokens = estimateTokens(buildPrompt(messages));
    const completionTokens = estimateTokens(assistantText);

    const responseBody = {
      id: `chatcmpl-${randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: assistantText },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };

    recordTrace(200, responseBody, promptTokens + completionTokens);
    reply.status(200).send(responseBody);
  });
}
