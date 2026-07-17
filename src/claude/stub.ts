import type { ClaudeSubprocess, ClaudeSubprocessResult } from "./types.js";

const CANNED_RESPONSE: ClaudeSubprocessResult = {
  raw: [
    '{"type":"system","subtype":"init"}',
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"stubbed response"}]}}',
    '{"type":"result","subtype":"success","result":"stubbed response"}',
  ].join("\n"),
};

export class StubClaudeSubprocess implements ClaudeSubprocess {
  async send(_prompt: string): Promise<ClaudeSubprocessResult> {
    return CANNED_RESPONSE;
  }
}
