import type { ClaudeSubprocess, ClaudeSubprocessResult } from "../../src/claude/types.js";

/** A stub subprocess with a fixed artificial delay, for simulating a "slow" Claude Subprocess. */
export class SlowClaudeSubprocess implements ClaudeSubprocess {
  current = 0;
  maxConcurrent = 0;
  completed = 0;

  constructor(
    private readonly delayMs: number,
    private readonly raw: string = "ok",
  ) {}

  async send(_prompt: string): Promise<ClaudeSubprocessResult> {
    this.current += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.current);
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    this.current -= 1;
    this.completed += 1;
    return { raw: this.raw };
  }

  // eslint-disable-next-line require-yield
  async *stream(_prompt: string): AsyncIterable<string> {
    throw new Error("not used in these tests");
  }
}
