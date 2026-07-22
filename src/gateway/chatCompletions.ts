import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ClaudeSubprocess } from "../claude/types.js";
import { insertTrace } from "../db/traces.js";
import { createFileResolver, validateFileReferences } from "./chatFiles.js";
import { buildPrompt, isValidContent, MAX_REQUEST_BODY_BYTES, validateImageContent } from "./chatImages.js";
import type { ChatMessageInput } from "./chatImages.js";
import { appendToolsToPrompt, isValidTools, resolveTools } from "./chatTools.js";
import type { ChatToolsRequestBody } from "./chatTools.js";
import { estimateTokens, extractTextFromLine, NO_PARSEABLE_OUTPUT_MESSAGE } from "./claudeOutput.js";
import { dispatchNonStreamingCompletion } from "./completionDispatch.js";
import { gatewayErrorBody } from "./errorBody.js";
import type { TokenPerMinuteRateLimiter } from "./rateLimiter.js";
import { sendErrorAndTrace } from "./routeErrors.js";

export const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";

type ChatMessage = ChatMessageInput;

interface ChatCompletionRequestBody extends ChatToolsRequestBody {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
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
        isValidContent((message as ChatMessage).content),
    )
  );
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
  server.post<{ Body: ChatCompletionRequestBody }>(
    CHAT_COMPLETIONS_PATH,
    { bodyLimit: MAX_REQUEST_BODY_BYTES },
    async (request, reply) => {
      const { model, messages, tools, functions } = request.body ?? {};
      const requestBodyJson = JSON.stringify(request.body ?? {});
      const gatewayApiKeyId = request.gatewayApiKeyId ?? null;
      const rateLimitTpm = request.gatewayApiKeyRateLimitTpm ?? null;

      const sendError = (httpStatus: number, message: string, type: string): FastifyReply => {
        return sendErrorAndTrace(
          reply,
          db,
          CHAT_COMPLETIONS_PATH,
          gatewayApiKeyId,
          requestBodyJson,
          httpStatus,
          message,
          type,
        );
      };

      if (typeof model !== "string" || model.length === 0 || !isValidMessages(messages)) {
        return sendError(
          400,
          "`model` and a non-empty `messages` array (each with string `role` and `content`) are required",
          "invalid_request_error",
        );
      }

      const imageValidationError = validateImageContent(messages);
      if (imageValidationError !== null) {
        return sendError(400, imageValidationError, "invalid_request_error");
      }

      const fileValidationError = validateFileReferences(messages, db);
      if (fileValidationError !== null) {
        return sendError(400, fileValidationError, "invalid_request_error");
      }

      if (!isValidTools(tools) || !isValidTools(functions)) {
        return sendError(400, "`tools` and `functions`, when present, must be arrays", "invalid_request_error");
      }

      let prompt: string;
      let cleanupImages: () => Promise<void>;
      try {
        ({ prompt, cleanup: cleanupImages } = await buildPrompt(messages, { resolveFile: createFileResolver(db) }));
      } catch (err) {
        return sendError(
          502,
          `Failed to process image content: ${err instanceof Error ? err.message : String(err)}`,
          "api_error",
        );
      }
      prompt = appendToolsToPrompt(prompt, resolveTools({ tools, functions }));

      try {
        if (!request.body?.stream) {
          return await dispatchNonStreamingCompletion({
            db,
            claudeSubprocess,
            rateLimiter,
            reply,
            endpoint: CHAT_COMPLETIONS_PATH,
            gatewayApiKeyId,
            rateLimitTpm,
            requestBodyJson,
            prompt,
            buildResponseBody: (assistantText, promptTokens, completionTokens) => ({
              ...buildCompletionResponse(
                { id: `chatcmpl-${randomUUID()}`, created: Math.floor(Date.now() / 1000), model },
                assistantText,
              ),
              usage: {
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
                total_tokens: promptTokens + completionTokens,
              },
            }),
          });
        }

        const promptTokens = estimateTokens(prompt);
        const rateLimitNow = Date.now();

        if (
          gatewayApiKeyId !== null &&
          rateLimitTpm !== null &&
          !rateLimiter.tryConsume(gatewayApiKeyId, rateLimitTpm, promptTokens, rateLimitNow)
        ) {
          return sendError(
            429,
            `Rate limit exceeded: this Gateway API Key is limited to ${rateLimitTpm} tokens per minute`,
            "rate_limit_error",
          );
        }

        const iterator = claudeSubprocess.stream(prompt)[Symbol.asyncIterator]();

        let first: IteratorResult<string>;
        try {
          first = await iterator.next();
        } catch (err) {
          return sendError(
            502,
            `Claude Subprocess failed: ${err instanceof Error ? err.message : String(err)}`,
            "api_error",
          );
        }

        if (first.done) {
          return sendError(
            502,
            `Claude Subprocess returned an unparseable response: ${NO_PARSEABLE_OUTPUT_MESSAGE}`,
            "api_error",
          );
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

        const completionTokens = estimateTokens(assistantText);
        if (gatewayApiKeyId !== null) {
          rateLimiter.record(gatewayApiKeyId, completionTokens, rateLimitNow);
        }
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
        insertTrace(db, {
          gatewayApiKeyId,
          endpoint: CHAT_COMPLETIONS_PATH,
          httpStatus: 200,
          requestBody: requestBodyJson,
          responseBody: JSON.stringify(responseBody),
          tokenCount: promptTokens + completionTokens,
        });
      } finally {
        // The Claude Subprocess has exited by this point on every path above (dispatch already
        // awaited, or the stream fully consumed), so any temp image files are safe to delete.
        await cleanupImages();
      }
    },
  );
}
