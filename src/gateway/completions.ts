import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import type { ClaudeSubprocess } from "../claude/types.js";
import { dispatchNonStreamingCompletion } from "./completionDispatch.js";
import type { TokenPerMinuteRateLimiter } from "./rateLimiter.js";
import { sendErrorAndTrace } from "./routeErrors.js";

export const COMPLETIONS_PATH = "/v1/completions";

interface CompletionRequestBody {
  model?: string;
  prompt?: string;
}

export function registerCompletionsRoute(
  server: FastifyInstance,
  db: Database.Database,
  claudeSubprocess: ClaudeSubprocess,
  rateLimiter: TokenPerMinuteRateLimiter,
): void {
  server.post<{ Body: CompletionRequestBody }>(COMPLETIONS_PATH, async (request, reply) => {
    const { model, prompt } = request.body ?? {};
    const requestBodyJson = JSON.stringify(request.body ?? {});
    const gatewayApiKeyId = request.gatewayApiKeyId ?? null;
    const rateLimitTpm = request.gatewayApiKeyRateLimitTpm ?? null;

    if (typeof model !== "string" || model.length === 0 || typeof prompt !== "string" || prompt.length === 0) {
      sendErrorAndTrace(
        reply,
        db,
        COMPLETIONS_PATH,
        gatewayApiKeyId,
        requestBodyJson,
        400,
        "`model` and a non-empty `prompt` string are required",
        "invalid_request_error",
      );
      return;
    }

    await dispatchNonStreamingCompletion({
      db,
      claudeSubprocess,
      rateLimiter,
      reply,
      endpoint: COMPLETIONS_PATH,
      gatewayApiKeyId,
      rateLimitTpm,
      requestBodyJson,
      prompt,
      buildResponseBody: (assistantText, promptTokens, completionTokens) => ({
        id: `cmpl-${randomUUID()}`,
        object: "text_completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ text: assistantText, index: 0, logprobs: null, finish_reason: "stop" }],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      }),
    });
  });
}
