import type { ClaudeSubprocess, ClaudeSubprocessResult } from "./types.js";

export const CONCURRENCY_POOL_SIZE = 3;

/** Caps concurrent holders at `capacity`; excess `acquire()` callers queue in FIFO order. */
export class Semaphore {
  private available: number;
  private readonly queue: Array<() => void> = [];

  constructor(capacity: number) {
    this.available = capacity;
  }

  acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
      return;
    }
    this.available += 1;
  }
}

/** Gates every Claude Subprocess invocation through a shared Semaphore (the Concurrency Pool). */
export class PooledClaudeSubprocess implements ClaudeSubprocess {
  constructor(
    readonly inner: ClaudeSubprocess,
    private readonly semaphore: Semaphore,
  ) {}

  async send(prompt: string): Promise<ClaudeSubprocessResult> {
    await this.semaphore.acquire();
    try {
      return await this.inner.send(prompt);
    } finally {
      this.semaphore.release();
    }
  }

  async *stream(prompt: string): AsyncIterable<string> {
    await this.semaphore.acquire();
    try {
      yield* this.inner.stream(prompt);
    } finally {
      this.semaphore.release();
    }
  }
}
