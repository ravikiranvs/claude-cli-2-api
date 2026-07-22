export const RATE_LIMIT_WINDOW_MS = 60_000;

interface RateLimitWindow {
  windowStart: number;
  usedTokens: number;
}

/** Enforces each Gateway API Key's independent token-per-minute Rate Limit. */
export class TokenPerMinuteRateLimiter {
  private readonly windows = new Map<number, RateLimitWindow>();

  /**
   * Reserves `tokens` against `gatewayApiKeyId`'s budget for the current 1-minute window if
   * doing so would not exceed `rateLimitTpm`. Returns false, without reserving, otherwise.
   */
  tryConsume(gatewayApiKeyId: number, rateLimitTpm: number, tokens: number, now: number = Date.now()): boolean {
    const window = this.currentWindow(gatewayApiKeyId, now);
    if (window.usedTokens + tokens > rateLimitTpm) {
      return false;
    }
    window.usedTokens += tokens;
    return true;
  }

  /** Adds `tokens` to the current window's usage without an admission check (e.g. completion tokens, known only after dispatch). */
  record(gatewayApiKeyId: number, tokens: number, now: number = Date.now()): void {
    const window = this.currentWindow(gatewayApiKeyId, now);
    window.usedTokens += tokens;
  }

  private currentWindow(gatewayApiKeyId: number, now: number): RateLimitWindow {
    const existing = this.windows.get(gatewayApiKeyId);
    if (existing && now - existing.windowStart < RATE_LIMIT_WINDOW_MS) {
      return existing;
    }
    const fresh: RateLimitWindow = { windowStart: now, usedTokens: 0 };
    this.windows.set(gatewayApiKeyId, fresh);
    return fresh;
  }
}
