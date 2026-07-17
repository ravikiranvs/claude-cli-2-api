export interface ClaudeSubprocessResult {
  /** Verbatim stdout produced by the Claude Subprocess. */
  raw: string;
}

export interface ClaudeSubprocess {
  send(prompt: string): Promise<ClaudeSubprocessResult>;
}
