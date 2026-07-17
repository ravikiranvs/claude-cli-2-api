import { StubClaudeSubprocess } from "./stub.js";
import { RealClaudeSubprocess } from "./subprocess.js";
import type { ClaudeSubprocess } from "./types.js";

export type { ClaudeSubprocess, ClaudeSubprocessResult } from "./types.js";

export function createClaudeSubprocess(options: { stub: boolean }): ClaudeSubprocess {
  return options.stub ? new StubClaudeSubprocess() : new RealClaudeSubprocess();
}
