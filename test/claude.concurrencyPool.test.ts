import { describe, expect, it } from "vitest";
import { PooledClaudeSubprocess, Semaphore } from "../src/claude/concurrencyPool.js";
import type { ClaudeSubprocess, ClaudeSubprocessResult } from "../src/claude/types.js";
import { SlowClaudeSubprocess } from "./fixtures/slowClaudeSubprocess.js";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

class TrackingClaudeSubprocess implements ClaudeSubprocess {
  current = 0;
  maxConcurrent = 0;
  completed = 0;
  private readonly gates: Array<{ promise: Promise<void>; resolve: () => void }> = [];

  async send(_prompt: string): Promise<ClaudeSubprocessResult> {
    this.current += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.current);
    const gate = deferred<void>();
    this.gates.push(gate);
    await gate.promise;
    this.current -= 1;
    this.completed += 1;
    return { raw: "ok" };
  }

  // eslint-disable-next-line require-yield
  async *stream(_prompt: string): AsyncIterable<string> {
    throw new Error("not used in these tests");
  }

  releaseNext(): void {
    const gate = this.gates.shift();
    gate?.resolve();
  }
}

/** A stub subprocess whose `stream()` takes a fixed artificial delay before yielding one line. */
class SlowStreamingClaudeSubprocess implements ClaudeSubprocess {
  current = 0;
  maxConcurrent = 0;
  completed = 0;

  constructor(private readonly delayMs: number) {}

  send(): Promise<ClaudeSubprocessResult> {
    throw new Error("not used in these tests");
  }

  async *stream(_prompt: string): AsyncIterable<string> {
    this.current += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.current);
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    this.current -= 1;
    this.completed += 1;
    yield "line";
  }
}

describe("Semaphore", () => {
  it("allows up to `capacity` concurrent holders and queues the rest", async () => {
    const semaphore = new Semaphore(2);
    const acquired: number[] = [];

    const first = semaphore.acquire().then(() => acquired.push(1));
    const second = semaphore.acquire().then(() => acquired.push(2));
    const third = semaphore.acquire().then(() => acquired.push(3));

    await Promise.resolve();
    await Promise.resolve();
    expect(acquired).toEqual([1, 2]);

    semaphore.release();
    await third;
    expect(acquired).toEqual([1, 2, 3]);

    await Promise.all([first, second]);
  });
});

describe("PooledClaudeSubprocess", () => {
  it("never runs more than the pool's capacity concurrently, and every queued request eventually completes", async () => {
    const slow = new SlowClaudeSubprocess(20);
    const pooled = new PooledClaudeSubprocess(slow, new Semaphore(3));

    const calls = Array.from({ length: 5 }, () => pooled.send("hi"));
    await Promise.all(calls);

    expect(slow.completed).toBe(5);
    expect(slow.maxConcurrent).toBe(3);
  });

  it("completes a queued request once a pool slot frees up", async () => {
    const tracking = new TrackingClaudeSubprocess();
    const pooled = new PooledClaudeSubprocess(tracking, new Semaphore(1));

    let secondCompleted = false;
    const firstCall = pooled.send("first");
    const secondCall = pooled.send("second").then((result) => {
      secondCompleted = true;
      return result;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(tracking.current).toBe(1);
    expect(secondCompleted).toBe(false);

    tracking.releaseNext();
    await firstCall;
    await Promise.resolve();
    tracking.releaseNext();
    await secondCall;

    expect(secondCompleted).toBe(true);
    expect(tracking.completed).toBe(2);
    expect(tracking.maxConcurrent).toBe(1);
  });

  it("releases the pool slot even if the underlying call rejects", async () => {
    class FailingClaudeSubprocess implements ClaudeSubprocess {
      send(): Promise<ClaudeSubprocessResult> {
        return Promise.reject(new Error("boom"));
      }
      // eslint-disable-next-line require-yield
      async *stream(): AsyncIterable<string> {
        throw new Error("not used");
      }
    }

    const semaphore = new Semaphore(1);
    const pooled = new PooledClaudeSubprocess(new FailingClaudeSubprocess(), semaphore);

    await expect(pooled.send("hi")).rejects.toThrow("boom");

    // The slot must have been released, so a second call can proceed immediately.
    let acquired = false;
    await semaphore.acquire().then(() => {
      acquired = true;
    });
    expect(acquired).toBe(true);
  });

  describe("stream()", () => {
    it("gates streaming calls through the same pool, never exceeding capacity", async () => {
      const slow = new SlowStreamingClaudeSubprocess(20);
      const pooled = new PooledClaudeSubprocess(slow, new Semaphore(3));

      const consume = async (): Promise<string[]> => {
        const lines: string[] = [];
        for await (const line of pooled.stream("hi")) {
          lines.push(line);
        }
        return lines;
      };

      await Promise.all(Array.from({ length: 5 }, () => consume()));

      expect(slow.completed).toBe(5);
      expect(slow.maxConcurrent).toBe(3);
    });

    it("releases the pool slot once the stream is exhausted", async () => {
      const semaphore = new Semaphore(1);
      const pooled = new PooledClaudeSubprocess(new SlowStreamingClaudeSubprocess(10), semaphore);

      const lines: string[] = [];
      for await (const line of pooled.stream("hi")) {
        lines.push(line);
      }
      expect(lines).toEqual(["line"]);

      let acquired = false;
      await semaphore.acquire().then(() => {
        acquired = true;
      });
      expect(acquired).toBe(true);
    });

    it("releases the pool slot even if the consumer stops iterating early (e.g. a disconnected SSE client)", async () => {
      class TwoLineClaudeSubprocess implements ClaudeSubprocess {
        cleanedUp = false;

        send(): Promise<ClaudeSubprocessResult> {
          throw new Error("not used in this test");
        }

        async *stream(): AsyncIterable<string> {
          try {
            yield "first";
            yield "second";
          } finally {
            this.cleanedUp = true;
          }
        }
      }

      const inner = new TwoLineClaudeSubprocess();
      const semaphore = new Semaphore(1);
      const pooled = new PooledClaudeSubprocess(inner, semaphore);

      for await (const line of pooled.stream("hi")) {
        expect(line).toBe("first");
        break;
      }

      expect(inner.cleanedUp).toBe(true);

      let acquired = false;
      await semaphore.acquire().then(() => {
        acquired = true;
      });
      expect(acquired).toBe(true);
    });
  });
});
