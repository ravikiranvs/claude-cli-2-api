import type { ClaudeSubprocess, ClaudeSubprocessResult } from "./types.js";

const CANNED_RESPONSE: ClaudeSubprocessResult = {
  raw: '{"role":"assistant","content":"stubbed response"}',
};

export class StubClaudeSubprocess implements ClaudeSubprocess {
  async send(_prompt: string): Promise<ClaudeSubprocessResult> {
    return CANNED_RESPONSE;
  }
}
