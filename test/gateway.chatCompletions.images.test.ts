import { existsSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { ClaudeSubprocess, ClaudeSubprocessResult } from "../src/claude/types.js";
import { MAX_IMAGES_PER_REQUEST, MAX_IMAGE_BYTES, MAX_REQUEST_BODY_BYTES } from "../src/gateway/chatImages.js";
import { registerChatCompletionsRoute } from "../src/gateway/chatCompletions.js";
import { openDatabase } from "../src/db/connection.js";
import { TokenPerMinuteRateLimiter } from "../src/gateway/rateLimiter.js";
import type Database from "better-sqlite3";

async function waitForFileDeleted(path: string, timeoutMs = 1000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!existsSync(path)) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return !existsSync(path);
}

const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const TINY_PNG_DATA_URI = `data:image/png;base64,${TINY_PNG_BASE64}`;

function oversizedDataUri(mimeType: string, bytes: number): string {
  return `data:${mimeType};base64,${Buffer.alloc(bytes, 1).toString("base64")}`;
}

const CANNED_RESPONSE: ClaudeSubprocessResult = {
  raw: [
    '{"type":"system","subtype":"init"}',
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"stubbed response"}]}}',
    '{"type":"result","subtype":"success","result":"stubbed response"}',
  ].join("\n"),
};

class RecordingClaudeSubprocess implements ClaudeSubprocess {
  lastPrompt: string | null = null;
  fileExistedDuringCall = false;
  callCount = 0;

  async send(prompt: string): Promise<ClaudeSubprocessResult> {
    this.callCount += 1;
    this.lastPrompt = prompt;
    const match = /\[image attached: (.+?)\]/.exec(prompt);
    if (match) {
      this.fileExistedDuringCall = existsSync(match[1]);
    }
    return CANNED_RESPONSE;
  }

  async *stream(): AsyncIterable<string> {
    throw new Error("not used in these tests");
  }
}

function buildTestServer(claudeSubprocess: ClaudeSubprocess): { server: FastifyInstance; db: Database.Database } {
  const db = openDatabase(":memory:");
  const server = Fastify({ bodyLimit: MAX_REQUEST_BODY_BYTES });
  registerChatCompletionsRoute(server, db, claudeSubprocess, new TokenPerMinuteRateLimiter());
  return { server, db };
}

describe("POST /v1/chat/completions (image content blocks)", () => {
  let server: FastifyInstance;
  let db: Database.Database;
  let baseUrl: string;

  afterEach(async () => {
    await server.close();
    db.close();
  });

  it("accepts an image content block, injects the temp file path into the prompt, and deletes it once the subprocess exits", async () => {
    const subprocess = new RecordingClaudeSubprocess();
    ({ server, db } = buildTestServer(subprocess));
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
              { type: "text", text: "what is this?" },
              { type: "image_url", image_url: { url: TINY_PNG_DATA_URI } },
            ],
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(subprocess.callCount).toBe(1);
    expect(subprocess.fileExistedDuringCall).toBe(true);
    expect(subprocess.lastPrompt).toContain("what is this?");

    const match = /\[image attached: (.+?)\]/.exec(subprocess.lastPrompt!);
    expect(match).not.toBeNull();
    expect(await waitForFileDeleted(match![1])).toBe(true);
  });

  it("rejects an oversized image with 400 and does not call the Claude Subprocess", async () => {
    const subprocess = new RecordingClaudeSubprocess();
    ({ server, db } = buildTestServer(subprocess));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude",
        messages: [
          {
            role: "user",
            content: [{ type: "image_url", image_url: { url: oversizedDataUri("image/png", MAX_IMAGE_BYTES + 1) } }],
          },
        ],
      }),
    });
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(400);
    expect(body.error.message).toContain("5MB");
    expect(subprocess.callCount).toBe(0);
  });

  it("rejects an unsupported image format with 400 and does not call the Claude Subprocess", async () => {
    const subprocess = new RecordingClaudeSubprocess();
    ({ server, db } = buildTestServer(subprocess));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude",
        messages: [
          {
            role: "user",
            content: [{ type: "image_url", image_url: { url: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" } }],
          },
        ],
      }),
    });
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(400);
    expect(body.error.message).toContain("Unsupported image format");
    expect(subprocess.callCount).toBe(0);
  });

  it("rejects a request with more than 100 images with 400 and does not call the Claude Subprocess", async () => {
    const subprocess = new RecordingClaudeSubprocess();
    ({ server, db } = buildTestServer(subprocess));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const imagePart = { type: "image_url", image_url: { url: TINY_PNG_DATA_URI } };
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude",
        messages: [{ role: "user", content: Array(MAX_IMAGES_PER_REQUEST + 1).fill(imagePart) }],
      }),
    });
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(400);
    expect(body.error.message).toContain(`${MAX_IMAGES_PER_REQUEST}`);
    expect(subprocess.callCount).toBe(0);
  });
});
