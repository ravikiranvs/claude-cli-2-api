import type { ClaudeSubprocess, ClaudeSubprocessResult } from "./types.js";

const CANNED_LINES = [
  '{"type":"system","subtype":"init"}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"stubbed response"}]}}',
  '{"type":"result","subtype":"success","result":"stubbed response"}',
];

const CANNED_RESPONSE: ClaudeSubprocessResult = {
  raw: CANNED_LINES.join("\n"),
};

export class StubClaudeSubprocess implements ClaudeSubprocess {
  async send(_prompt: string): Promise<ClaudeSubprocessResult> {
    return CANNED_RESPONSE;
  }

  async *stream(_prompt: string): AsyncIterable<string> {
    for (const line of CANNED_LINES) {
      yield line;
    }
  }
}
