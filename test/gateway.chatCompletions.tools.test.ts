import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { ClaudeSubprocess, ClaudeSubprocessResult } from "../src/claude/types.js";
import { registerChatCompletionsRoute } from "../src/gateway/chatCompletions.js";
import { openDatabase } from "../src/db/connection.js";
import { TokenPerMinuteRateLimiter } from "../src/gateway/rateLimiter.js";
import type Database from "better-sqlite3";

const CANNED_RESPONSE: ClaudeSubprocessResult = {
  raw: [
    '{"type":"system","subtype":"init"}',
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"stubbed response"}]}}',
    '{"type":"result","subtype":"success","result":"stubbed response"}',
  ].join("\n"),
};

const weatherTool = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the current weather for a location",
    parameters: { type: "object", properties: { location: { type: "string" } }, required: ["location"] },
  },
};

class RecordingClaudeSubprocess implements ClaudeSubprocess {
  lastPrompt: string | null = null;

  async send(prompt: string): Promise<ClaudeSubprocessResult> {
    this.lastPrompt = prompt;
    return CANNED_RESPONSE;
  }

  async *stream(): AsyncIterable<string> {
    throw new Error("not used in these tests");
  }
}

function buildTestServer(claudeSubprocess: ClaudeSubprocess): { server: FastifyInstance; db: Database.Database } {
  const db = openDatabase(":memory:");
  const server = Fastify();
  registerChatCompletionsRoute(server, db, claudeSubprocess, new TokenPerMinuteRateLimiter());
  return { server, db };
}

function extractForwardedTools(prompt: string): unknown {
  const match = /\[tools available: (.+)\]$/.exec(prompt);
  return match ? JSON.parse(match[1]) : null;
}

describe("POST /v1/chat/completions (tool/function definitions)", () => {
  let server: FastifyInstance;
  let db: Database.Database;
  let baseUrl: string;

  afterEach(async () => {
    await server.close();
    db.close();
  });

  it("forwards `tools` into the Claude Subprocess invocation intact", async () => {
    const subprocess = new RecordingClaudeSubprocess();
    ({ server, db } = buildTestServer(subprocess));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude",
        messages: [{ role: "user", content: "what's the weather in Boston?" }],
        tools: [weatherTool],
      }),
    });

    expect(response.status).toBe(200);
    expect(extractForwardedTools(subprocess.lastPrompt!)).toEqual([weatherTool]);
  });

  it("forwards the deprecated `functions` field into the Claude Subprocess invocation intact", async () => {
    const subprocess = new RecordingClaudeSubprocess();
    ({ server, db } = buildTestServer(subprocess));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const legacyFunction = {
      name: "get_weather",
      description: "Get the current weather for a location",
      parameters: { type: "object", properties: { location: { type: "string" } } },
    };

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude",
        messages: [{ role: "user", content: "what's the weather in Boston?" }],
        functions: [legacyFunction],
      }),
    });

    expect(response.status).toBe(200);
    expect(extractForwardedTools(subprocess.lastPrompt!)).toEqual([legacyFunction]);
  });

  it("does not append a tools block when no tools are supplied", async () => {
    const subprocess = new RecordingClaudeSubprocess();
    ({ server, db } = buildTestServer(subprocess));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "claude", messages: [{ role: "user", content: "hi" }] }),
    });

    expect(subprocess.lastPrompt).not.toContain("[tools available:");
  });

  it("rejects a non-array `tools` value with 400 and does not call the Claude Subprocess", async () => {
    const subprocess = new RecordingClaudeSubprocess();
    ({ server, db } = buildTestServer(subprocess));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude",
        messages: [{ role: "user", content: "hi" }],
        tools: "not an array",
      }),
    });
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(400);
    expect(body.error.type).toBe("invalid_request_error");
    expect(subprocess.lastPrompt).toBeNull();
  });
});
