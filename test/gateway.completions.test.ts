import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { StubClaudeSubprocess } from "../src/claude/stub.js";
import type { ClaudeSubprocess, ClaudeSubprocessResult } from "../src/claude/types.js";
import { openDatabase } from "../src/db/connection.js";
import { registerCompletionsRoute } from "../src/gateway/completions.js";
import { TokenPerMinuteRateLimiter } from "../src/gateway/rateLimiter.js";
import type Database from "better-sqlite3";

class FailingClaudeSubprocess implements ClaudeSubprocess {
  send(): Promise<ClaudeSubprocessResult> {
    return Promise.reject(new Error("claude subprocess exited with code 1: not authenticated"));
  }

  // eslint-disable-next-line require-yield
  async *stream(): AsyncIterable<string> {
    throw new Error("claude subprocess exited with code 1: not authenticated");
  }
}

class GarbageClaudeSubprocess implements ClaudeSubprocess {
  send(): Promise<ClaudeSubprocessResult> {
    return Promise.resolve({ raw: "not json at all" });
  }

  async *stream(): AsyncIterable<string> {
    yield "not json at all";
  }
}

function buildTestServer(claudeSubprocess: ClaudeSubprocess): { server: FastifyInstance; db: Database.Database } {
  const db = openDatabase(":memory:");
  const server = Fastify();
  registerCompletionsRoute(server, db, claudeSubprocess, new TokenPerMinuteRateLimiter());
  return { server, db };
}

const validBody = { model: "claude", prompt: "hi" };

describe("POST /v1/completions", () => {
  let server: FastifyInstance;
  let db: Database.Database;
  let baseUrl: string;

  afterEach(async () => {
    await server.close();
    db.close();
  });

  it("returns an OpenAI legacy Completion-shaped response for a valid request", async () => {
    ({ server, db } = buildTestServer(new StubClaudeSubprocess()));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const response = await fetch(`${baseUrl}/v1/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      object: "text_completion",
      model: "claude",
      choices: [{ text: "stubbed response", index: 0, logprobs: null, finish_reason: "stop" }],
    });
    expect(body.id).toMatch(/^cmpl-/);
    expect(body.usage.total_tokens).toBeGreaterThan(0);
  });

  it("writes a Trace row for a completed request", async () => {
    ({ server, db } = buildTestServer(new StubClaudeSubprocess()));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    await fetch(`${baseUrl}/v1/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });

    const row = db.prepare("SELECT * FROM traces").get() as Record<string, unknown>;

    expect(row.endpoint).toBe("/v1/completions");
    expect(row.http_status).toBe(200);
    expect(row.request_body).toBe(JSON.stringify(validBody));
    expect(String(row.response_body)).toContain("stubbed response");
  });

  it("rejects a request missing `prompt` with 400 and does not call the Claude Subprocess", async () => {
    ({ server, db } = buildTestServer(new FailingClaudeSubprocess()));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const response = await fetch(`${baseUrl}/v1/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "claude" }),
    });
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(400);
    expect(body.error.type).toBe("invalid_request_error");
  });

  it("returns a clear error, not a crash, when the Claude Subprocess fails", async () => {
    ({ server, db } = buildTestServer(new FailingClaudeSubprocess()));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const response = await fetch(`${baseUrl}/v1/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(502);
    expect(body.error.type).toBe("api_error");
    expect(body.error.message).toContain("not authenticated");

    const row = db.prepare("SELECT http_status FROM traces").get() as Record<string, unknown>;
    expect(row.http_status).toBe(502);
  });

  it("returns a clear error when the Claude Subprocess output can't be parsed", async () => {
    ({ server, db } = buildTestServer(new GarbageClaudeSubprocess()));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const response = await fetch(`${baseUrl}/v1/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(502);
    expect(body.error.type).toBe("api_error");
  });
});
