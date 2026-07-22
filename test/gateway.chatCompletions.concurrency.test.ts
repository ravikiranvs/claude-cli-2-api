import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { CONCURRENCY_POOL_SIZE, PooledClaudeSubprocess, Semaphore } from "../src/claude/concurrencyPool.js";
import { openDatabase } from "../src/db/connection.js";
import { registerChatCompletionsRoute } from "../src/gateway/chatCompletions.js";
import { TokenPerMinuteRateLimiter } from "../src/gateway/rateLimiter.js";
import { SlowClaudeSubprocess } from "./fixtures/slowClaudeSubprocess.js";
import type Database from "better-sqlite3";

const CANNED_RAW = [
  '{"type":"system","subtype":"init"}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"stubbed response"}]}}',
  '{"type":"result","subtype":"success","result":"stubbed response"}',
].join("\n");

describe("POST /v1/chat/completions (Concurrency Pool)", () => {
  let server: FastifyInstance;
  let db: Database.Database;

  afterEach(async () => {
    await server.close();
    db.close();
  });

  it("caps simultaneous Claude Subprocess invocations at the pool size and completes every queued request", async () => {
    const slow = new SlowClaudeSubprocess(30, CANNED_RAW);
    const claudeSubprocess = new PooledClaudeSubprocess(slow, new Semaphore(CONCURRENCY_POOL_SIZE));

    db = openDatabase(":memory:");
    server = Fastify();
    registerChatCompletionsRoute(server, db, claudeSubprocess, new TokenPerMinuteRateLimiter());
    const baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const requestCount = CONCURRENCY_POOL_SIZE + 2;
    const responses = await Promise.all(
      Array.from({ length: requestCount }, () =>
        fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: "claude", messages: [{ role: "user", content: "hi" }] }),
        }),
      ),
    );

    for (const response of responses) {
      expect(response.status).toBe(200);
    }
    expect(slow.completed).toBe(requestCount);
    expect(slow.maxConcurrent).toBeLessThanOrEqual(CONCURRENCY_POOL_SIZE);
    expect(slow.maxConcurrent).toBe(CONCURRENCY_POOL_SIZE);

    const traceCount = db.prepare("SELECT COUNT(*) as count FROM traces").get() as { count: number };
    expect(traceCount.count).toBe(requestCount);
  });
});
