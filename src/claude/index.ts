import { CONCURRENCY_POOL_SIZE, PooledClaudeSubprocess, Semaphore } from "./concurrencyPool.js";
import { StubClaudeSubprocess } from "./stub.js";
import { RealClaudeSubprocess } from "./subprocess.js";
import type { ClaudeSubprocess } from "./types.js";

export type { ClaudeSubprocess, ClaudeSubprocessResult } from "./types.js";
export { CONCURRENCY_POOL_SIZE } from "./concurrencyPool.js";

export function createClaudeSubprocess(options: { stub: boolean }): ClaudeSubprocess {
  const inner = options.stub ? new StubClaudeSubprocess() : new RealClaudeSubprocess();
  return new PooledClaudeSubprocess(inner, new Semaphore(CONCURRENCY_POOL_SIZE));
}
