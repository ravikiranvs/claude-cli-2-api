import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { ClaudeSubprocess, ClaudeSubprocessResult } from "../src/claude/types.js";
import { registerChatCompletionsRoute } from "../src/gateway/chatCompletions.js";
import { openDatabase } from "../src/db/connection.js";
import { createUploadedFile } from "../src/db/uploadedFiles.js";
import { TokenPerMinuteRateLimiter } from "../src/gateway/rateLimiter.js";
import type Database from "better-sqlite3";

const CANNED_RESPONSE: ClaudeSubprocessResult = {
  raw: [
    '{"type":"system","subtype":"init"}',
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"stubbed response"}]}}',
    '{"type":"result","subtype":"success","result":"stubbed response"}',
  ].join("\n"),
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

describe("POST /v1/chat/completions (uploaded file reference)", () => {
  let server: FastifyInstance;
  let db: Database.Database;
  let baseUrl: string;

  afterEach(async () => {
    await server.close();
    db.close();
  });

  it("forwards a referenced uploaded file's on-disk path into the Claude Subprocess invocation intact", async () => {
    const subprocess = new RecordingClaudeSubprocess();
    ({ server, db } = buildTestServer(subprocess));
    createUploadedFile(db, {
      id: "file-abc123",
      filename: "report.txt",
      contentType: "text/plain",
      byteSize: 18,
      storagePath: "/data/uploads/file-abc123",
    });
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "summarize this" },
              { type: "file", file_id: "file-abc123" },
            ],
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(subprocess.lastPrompt).toContain("summarize this");
    expect(subprocess.lastPrompt).toContain("[file attached: /data/uploads/file-abc123]");
  });

  it("rejects a reference to an unknown file id with 400 and does not call the Claude Subprocess", async () => {
    const subprocess = new RecordingClaudeSubprocess();
    ({ server, db } = buildTestServer(subprocess));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude",
        messages: [{ role: "user", content: [{ type: "file", file_id: "file-does-not-exist" }] }],
      }),
    });
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(400);
    expect(body.error.message).toContain("file-does-not-exist");
    expect(subprocess.lastPrompt).toBeNull();
  });
});
