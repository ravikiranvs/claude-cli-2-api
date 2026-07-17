import { describe, expect, it } from "vitest";
import { createClaudeSubprocess } from "../src/claude/index.js";

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

  it("returns the real subprocess implementation when test mode is not enabled", () => {
    const stubbed = createClaudeSubprocess({ stub: true });
    const real = createClaudeSubprocess({ stub: false });

    expect(real).not.toBe(stubbed);
    expect(real.constructor).not.toBe(stubbed.constructor);
  });
});
