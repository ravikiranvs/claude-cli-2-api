import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { PooledClaudeSubprocess } from "../src/claude/concurrencyPool.js";
import { createClaudeSubprocess } from "../src/claude/index.js";

const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

const { RealClaudeSubprocess } = await import("../src/claude/subprocess.js");

function createFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

describe("createClaudeSubprocess", () => {
  it("returns a stub that resolves with a canned response when test mode is enabled, without spawning the real claude CLI", async () => {
    const subprocess = createClaudeSubprocess({ stub: true });

    const result = await subprocess.send("hello");

    expect(result.raw).toBe(
      [
        '{"type":"system","subtype":"init"}',
        '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"stubbed response"}]}}',
        '{"type":"result","subtype":"success","result":"stubbed response"}',
      ].join("\n"),
    );
  });

  it("wraps the real subprocess implementation when test mode is not enabled, and a distinct instance each call", () => {
    const stubbed = createClaudeSubprocess({ stub: true }) as PooledClaudeSubprocess;
    const real = createClaudeSubprocess({ stub: false }) as PooledClaudeSubprocess;

    expect(real).not.toBe(stubbed);
    expect(real.inner.constructor).not.toBe(stubbed.inner.constructor);
    expect((createClaudeSubprocess({ stub: true }) as PooledClaudeSubprocess).inner.constructor).toBe(
      stubbed.inner.constructor,
    );
  });

  it("streams the same canned lines as `send` returns, one per iteration", async () => {
    const subprocess = createClaudeSubprocess({ stub: true });

    const lines: string[] = [];
    for await (const line of subprocess.stream("hello")) {
      lines.push(line);
    }

    expect(lines).toEqual([
      '{"type":"system","subtype":"init"}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"stubbed response"}]}}',
      '{"type":"result","subtype":"success","result":"stubbed response"}',
    ]);
  });
});

describe("RealClaudeSubprocess", () => {
  it("passes --verbose alongside --output-format stream-json, since the real CLI rejects stream-json in print mode without it", async () => {
    const child = createFakeChild();
    mockSpawn.mockReturnValue(child);

    const subprocess = new RealClaudeSubprocess();
    const draining = (async () => {
      for await (const _line of subprocess.stream("hello")) {
        // drain
      }
    })();

    child.stdout.end();
    child.emit("close", 0);
    await draining;

    expect(mockSpawn).toHaveBeenCalledWith("claude", [
      "-p",
      "hello",
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
  });
});
