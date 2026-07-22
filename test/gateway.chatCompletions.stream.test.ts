import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { ClaudeSubprocess, ClaudeSubprocessResult } from "../src/claude/types.js";
import { openDatabase } from "../src/db/connection.js";
import { registerChatCompletionsRoute } from "../src/gateway/chatCompletions.js";
import { TokenPerMinuteRateLimiter } from "../src/gateway/rateLimiter.js";
import type Database from "better-sqlite3";

class LinesClaudeSubprocess implements ClaudeSubprocess {
  constructor(private readonly lines: string[]) {}

  async send(): Promise<ClaudeSubprocessResult> {
    return { raw: this.lines.join("\n") };
  }

  async *stream(): AsyncIterable<string> {
    for (const line of this.lines) {
      yield line;
    }
  }
}

class FailingImmediatelyClaudeSubprocess implements ClaudeSubprocess {
  send(): Promise<ClaudeSubprocessResult> {
    return Promise.reject(new Error("claude subprocess exited with code 1: not authenticated"));
  }

  // eslint-disable-next-line require-yield
  async *stream(): AsyncIterable<string> {
    throw new Error("claude subprocess exited with code 1: not authenticated");
  }
}

class FailingMidStreamClaudeSubprocess implements ClaudeSubprocess {
  send(): Promise<ClaudeSubprocessResult> {
    return Promise.reject(new Error("claude subprocess exited with code 1: crashed"));
  }

  async *stream(): AsyncIterable<string> {
    yield '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"partial"}]}}';
    throw new Error("claude subprocess exited with code 1: crashed");
  }
}

const growingTextLines = [
  '{"type":"system","subtype":"init"}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hello"}]}}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hello, world"}]}}',
  '{"type":"result","subtype":"success","result":"Hello, world"}',
];

const divergentResultLines = [
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hello, world"}]}}',
  '{"type":"result","subtype":"success","result":"A different final answer"}',
];

function buildTestServer(claudeSubprocess: ClaudeSubprocess): { server: FastifyInstance; db: Database.Database } {
  const db = openDatabase(":memory:");
  const server = Fastify();
  registerChatCompletionsRoute(server, db, claudeSubprocess, new TokenPerMinuteRateLimiter());
  return { server, db };
}

function parseSseEvents(body: string): unknown[] {
  return body
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => chunk.replace(/^data: /, ""))
    .map((data) => (data === "[DONE]" ? "[DONE]" : JSON.parse(data)));
}

const streamBody = {
  model: "claude",
  messages: [{ role: "user", content: "hi" }],
  stream: true,
};

describe("POST /v1/chat/completions (stream)", () => {
  let server: FastifyInstance;
  let db: Database.Database;
  let baseUrl: string;

  afterEach(async () => {
    await server.close();
    db.close();
  });

  it("returns a text/event-stream response with incremental deltas ending in [DONE]", async () => {
    ({ server, db } = buildTestServer(new LinesClaudeSubprocess(growingTextLines)));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(streamBody),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const events = parseSseEvents(await response.text());

    expect(events[events.length - 1]).toBe("[DONE]");

    const chunks = events.slice(0, -1) as Array<Record<string, any>>;
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const chunk of chunks) {
      expect(chunk.object).toBe("chat.completion.chunk");
      expect(chunk.choices[0].index).toBe(0);
    }

    expect(chunks[0].choices[0].delta).toMatchObject({ role: "assistant" });

    const contentDeltas = chunks
      .map((chunk) => chunk.choices[0].delta.content)
      .filter((content): content is string => typeof content === "string");
    expect(contentDeltas.join("")).toBe("Hello, world");

    const last = chunks[chunks.length - 1];
    expect(last.choices[0].finish_reason).toBe("stop");
  });

  it("does not duplicate content when a later event's text supersedes rather than extends the streamed text", async () => {
    ({ server, db } = buildTestServer(new LinesClaudeSubprocess(divergentResultLines)));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(streamBody),
    });

    const events = parseSseEvents(await response.text());
    const chunks = events.slice(0, -1) as Array<Record<string, any>>;
    const contentDeltas = chunks
      .map((chunk) => chunk.choices[0].delta.content)
      .filter((content): content is string => typeof content === "string");

    // "A different final answer" doesn't extend "Hello, world", so it must not be re-emitted
    // as a delta on top of what's already been streamed.
    expect(contentDeltas.join("")).toBe("Hello, world");

    const row = db.prepare("SELECT response_body FROM traces").get() as Record<string, unknown>;
    const responseBody = JSON.parse(String(row.response_body));
    expect(responseBody.choices[0].message.content).toBe("A different final answer");
  });

  it("writes a single Trace row with the full assembled response once the stream completes", async () => {
    ({ server, db } = buildTestServer(new LinesClaudeSubprocess(growingTextLines)));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(streamBody),
    });

    const rows = db.prepare("SELECT * FROM traces").all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].http_status).toBe(200);
    expect(rows[0].endpoint).toBe("/v1/chat/completions");
    expect(String(rows[0].response_body)).toContain("Hello, world");
    expect(rows[0].token_count).toBeGreaterThan(0);
  });

  it("rejects an invalid streaming request with a plain 400 JSON error, not SSE", async () => {
    ({ server, db } = buildTestServer(new LinesClaudeSubprocess(growingTextLines)));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "claude", stream: true }),
    });
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(400);
    expect(body.error.type).toBe("invalid_request_error");
  });

  it("returns a plain 502 JSON error when the Claude Subprocess fails before producing output", async () => {
    ({ server, db } = buildTestServer(new FailingImmediatelyClaudeSubprocess()));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(streamBody),
    });
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).not.toContain("text/event-stream");
    expect(body.error.type).toBe("api_error");

    const row = db.prepare("SELECT http_status FROM traces").get() as Record<string, unknown>;
    expect(row.http_status).toBe(502);
  });

  it("terminates the stream gracefully with [DONE] when the Claude Subprocess fails mid-stream, and records the failure in the Trace", async () => {
    ({ server, db } = buildTestServer(new FailingMidStreamClaudeSubprocess()));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(streamBody),
    });

    expect(response.status).toBe(200);
    const events = parseSseEvents(await response.text());
    expect(events[events.length - 1]).toBe("[DONE]");

    const row = db.prepare("SELECT * FROM traces").get() as Record<string, unknown>;
    expect(row.http_status).toBe(200);
    const responseBody = JSON.parse(String(row.response_body));
    expect(responseBody.error.message).toContain("crashed");
    expect(responseBody.choices[0].message.content).toBe("partial");
  });
});
