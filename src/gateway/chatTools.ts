export interface ChatToolsRequestBody {
  tools?: unknown;
  functions?: unknown;
}

/** True if `tools`/`functions`, when present, is well-formed enough to forward: absent or an array. */
export function isValidTools(value: unknown): boolean {
  return value === undefined || Array.isArray(value);
}

/** Picks the tool/function definitions to forward. `tools` (current OpenAI field) takes precedence over the deprecated `functions` field. */
export function resolveTools(body: ChatToolsRequestBody): unknown[] | undefined {
  if (Array.isArray(body.tools)) return body.tools;
  if (Array.isArray(body.functions)) return body.functions;
  return undefined;
}

/**
 * Appends tool/function definitions to the reconstructed prompt so they reach the Claude
 * Subprocess invocation intact — the same "reconstructed prompt" channel image references
 * are injected through (see chatImages.ts), since that's the only interface the subprocess
 * accepts (`claude -p "<reconstructed prompt>"`).
 */
export function appendToolsToPrompt(prompt: string, tools: unknown[] | undefined): string {
  if (!tools || tools.length === 0) return prompt;
  return `${prompt}\n\n[tools available: ${JSON.stringify(tools)}]`;
}
