export const NO_PARSEABLE_OUTPUT_MESSAGE = "Claude Subprocess produced no parseable assistant output";

interface TextPart {
  type: string;
  text: string;
}

function isTextPart(value: unknown): value is TextPart {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "text";
}

function joinTextParts(parts: unknown[]): string | null {
  const textParts = parts.filter(isTextPart).map((part) => part.text);
  return textParts.length > 0 ? textParts.join("") : null;
}

/**
 * Parses a single `stream-json` line and returns the assistant text it carries, if any.
 * A `result` event's text supersedes prior `assistant` events for the same line stream.
 */
export function extractTextFromLine(line: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const event = parsed as Record<string, unknown>;

  if (event.type === "assistant" && typeof event.message === "object" && event.message !== null) {
    const message = event.message as Record<string, unknown>;
    if (Array.isArray(message.content)) {
      return joinTextParts(message.content);
    }
    return null;
  }
  if (event.type === "result" && typeof event.result === "string") {
    return event.result;
  }
  return null;
}

/**
 * Reads the newline-delimited `stream-json` events emitted by a Claude Subprocess and
 * picks out the final assistant text, preferring the terminal `result` event when present.
 */
export function extractAssistantText(raw: string): string {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let text: string | null = null;
  for (const line of lines) {
    text = extractTextFromLine(line) ?? text;
  }

  if (text === null) {
    throw new Error(NO_PARSEABLE_OUTPUT_MESSAGE);
  }

  return text;
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
