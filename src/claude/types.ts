export interface ClaudeSubprocessResult {
  /** Verbatim stdout produced by the Claude Subprocess. */
  raw: string;
}

export interface ClaudeSubprocess {
  send(prompt: string): Promise<ClaudeSubprocessResult>;
  /** Yields each raw `stream-json` line as it is produced, in order. */
  stream(prompt: string): AsyncIterable<string>;
}
