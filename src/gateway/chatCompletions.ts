import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import type { ClaudeSubprocess } from "../claude/types.js";
import { insertTrace } from "../db/traces.js";
import { gatewayErrorBody } from "./errorBody.js";
import type { TokenPerMinuteRateLimiter } from "./rateLimiter.js";

export const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";

const NO_PARSEABLE_OUTPUT_MESSAGE = "Claude Subprocess produced no parseable assistant output";

interface ChatMessage {
  role: string;
  content: string;
}

interface ChatCompletionRequestBody {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
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
 * Parses a single `stream-json` line and returns the assistant text it carries, if any.
 * A `result` event's text supersedes prior `assistant` events for the same line stream.
 */
function extractTextFromLine(line: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const event = parsed as Record<string, unknown>;

  if (event.type === "assistant" && typeof event.message === "object" && event.message !== null) {
    const message = event.message as Record<string, unknown>;
    if (Array.isArray(message.content)) {
      return joinTextParts(message.content);
    }
    return null;
  }
  if (event.type === "result" && typeof event.result === "string") {
    return event.result;
  }
  return null;
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
    text = extractTextFromLine(line) ?? text;
  }

  if (text === null) {
    throw new Error(NO_PARSEABLE_OUTPUT_MESSAGE);
  }

  return text;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

interface ResponseMeta {
  id: string;
  created: number;
  model: string;
}

function buildCompletionResponse(meta: ResponseMeta, assistantText: string): Record<string, unknown> {
  return {
    id: meta.id,
    object: "chat.completion",
    created: meta.created,
    model: meta.model,
    choices: [{ index: 0, message: { role: "assistant", content: assistantText }, finish_reason: "stop" }],
  };
}

interface ChunkChoiceDelta {
  role?: "assistant";
  content?: string;
}

function buildChunk(meta: ResponseMeta, delta: ChunkChoiceDelta, finishReason: "stop" | null): unknown {
  return {
    id: meta.id,
    object: "chat.completion.chunk",
    created: meta.created,
    model: meta.model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

interface StreamResult {
  assistantText: string;
  errorMessage: string | null;
}

/**
 * Consumes the Claude Subprocess's `stream-json` lines, forwarding each new slice of
 * assistant text as an OpenAI-format SSE chunk. Returns the fully assembled text (and any
 * mid-stream failure) so the caller can write a single, accurate Trace row once the stream
 * completes — HTTP headers are already committed by this point, so a failure here cannot
 * change the response status; it can only be recorded truthfully in the Trace.
 */
async function pipeStreamToSse(
  iterator: AsyncIterator<string>,
  firstLine: string,
  write: (chunk: string) => void,
  meta: ResponseMeta,
): Promise<StreamResult> {
  let assembledText = "";
  let roleSent = false;

  const processLine = (line: string): void => {
    const text = extractTextFromLine(line);
    if (text === null || text === assembledText) return;

    if (!roleSent) {
      write(`data: ${JSON.stringify(buildChunk(meta, { role: "assistant" }, null))}\n\n`);
      roleSent = true;
    }

    // A later event's text may supersede (not extend) what's already been streamed — e.g. a
    // terminal `result` differently phrased from the last `assistant` event. In that case we
    // trust it for the assembled/Trace text but don't re-emit already-sent content as a delta,
    // since OpenAI-format deltas are append-only from the client's perspective.
    if (text.startsWith(assembledText)) {
      const delta = text.slice(assembledText.length);
      write(`data: ${JSON.stringify(buildChunk(meta, { content: delta }, null))}\n\n`);
    }
    assembledText = text;
  };

  processLine(firstLine);
  let errorMessage: string | null = null;
  try {
    let next = await iterator.next();
    while (!next.done) {
      processLine(next.value);
      next = await iterator.next();
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  if (!roleSent) {
    write(`data: ${JSON.stringify(buildChunk(meta, { role: "assistant" }, null))}\n\n`);
  }
  write(`data: ${JSON.stringify(buildChunk(meta, {}, "stop"))}\n\n`);
  write("data: [DONE]\n\n");

  return { assistantText: assembledText, errorMessage };
}

export function registerChatCompletionsRoute(
  server: FastifyInstance,
  db: Database.Database,
  claudeSubprocess: ClaudeSubprocess,
  rateLimiter: TokenPerMinuteRateLimiter,
): void {
  server.post<{ Body: ChatCompletionRequestBody }>(CHAT_COMPLETIONS_PATH, async (request, reply) => {
    const { model, messages } = request.body ?? {};
    const requestBodyJson = JSON.stringify(request.body ?? {});
    const gatewayApiKeyId = request.gatewayApiKeyId ?? null;
    const rateLimitTpm = request.gatewayApiKeyRateLimitTpm ?? null;

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

    const sendError = (httpStatus: number, message: string, type: string): void => {
      const body = gatewayErrorBody(message, type);
      recordTrace(httpStatus, body, null);
      reply.status(httpStatus).send(body);
    };

    // Captured once so a request's prompt and completion tokens are always charged to the
    // same rate-limit window, even if the Claude Subprocess call straddles a minute boundary.
    const rateLimitNow = Date.now();
    const recordCompletionTokens = (assistantText: string): number => {
      const completionTokens = estimateTokens(assistantText);
      if (gatewayApiKeyId !== null) {
        rateLimiter.record(gatewayApiKeyId, completionTokens, rateLimitNow);
      }
      return completionTokens;
    };

    if (typeof model !== "string" || model.length === 0 || !isValidMessages(messages)) {
      sendError(
        400,
        "`model` and a non-empty `messages` array (each with string `role` and `content`) are required",
        "invalid_request_error",
      );
      return;
    }

    const prompt = buildPrompt(messages);
    const promptTokens = estimateTokens(prompt);

    if (
      gatewayApiKeyId !== null &&
      rateLimitTpm !== null &&
      !rateLimiter.tryConsume(gatewayApiKeyId, rateLimitTpm, promptTokens, rateLimitNow)
    ) {
      sendError(
        429,
        `Rate limit exceeded: this Gateway API Key is limited to ${rateLimitTpm} tokens per minute`,
        "rate_limit_error",
      );
      return;
    }

    if (request.body?.stream) {
      const iterator = claudeSubprocess.stream(prompt)[Symbol.asyncIterator]();

      let first: IteratorResult<string>;
      try {
        first = await iterator.next();
      } catch (err) {
        sendError(502, `Claude Subprocess failed: ${err instanceof Error ? err.message : String(err)}`, "api_error");
        return;
      }

      if (first.done) {
        sendError(
          502,
          `Claude Subprocess returned an unparseable response: ${NO_PARSEABLE_OUTPUT_MESSAGE}`,
          "api_error",
        );
        return;
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const meta: ResponseMeta = { id: `chatcmpl-${randomUUID()}`, created: Math.floor(Date.now() / 1000), model };
      const { assistantText, errorMessage } = await pipeStreamToSse(
        iterator,
        first.value,
        (chunk) => reply.raw.write(chunk),
        meta,
      );
      reply.raw.end();

      const completionTokens = recordCompletionTokens(assistantText);
      const responseBody: Record<string, unknown> = {
        ...buildCompletionResponse(meta, assistantText),
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      };
      if (errorMessage !== null) {
        // The subprocess failed after the 200 response was already committed to the wire, so
        // the HTTP status can't change — but the Trace must not claim a clean success.
        responseBody.error = gatewayErrorBody(`Claude Subprocess failed mid-stream: ${errorMessage}`, "api_error")
          .error;
      }
      recordTrace(200, responseBody, promptTokens + completionTokens);
      return;
    }

    let raw: string;
    try {
      raw = (await claudeSubprocess.send(prompt)).raw;
    } catch (err) {
      sendError(502, `Claude Subprocess failed: ${err instanceof Error ? err.message : String(err)}`, "api_error");
      return;
    }

    let assistantText: string;
    try {
      assistantText = extractAssistantText(raw);
    } catch (err) {
      sendError(
        502,
        `Claude Subprocess returned an unparseable response: ${err instanceof Error ? err.message : String(err)}`,
        "api_error",
      );
      return;
    }

    const completionTokens = recordCompletionTokens(assistantText);
    const meta: ResponseMeta = { id: `chatcmpl-${randomUUID()}`, created: Math.floor(Date.now() / 1000), model };
    const responseBody = {
      ...buildCompletionResponse(meta, assistantText),
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
