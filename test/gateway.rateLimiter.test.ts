import { describe, expect, it } from "vitest";
import { TokenPerMinuteRateLimiter } from "../src/gateway/rateLimiter.js";

describe("TokenPerMinuteRateLimiter", () => {
  it("admits requests whose tokens fit within the key's TPM limit for the current window", () => {
    const limiter = new TokenPerMinuteRateLimiter();

    expect(limiter.tryConsume(1, 100, 40, 0)).toBe(true);
    expect(limiter.tryConsume(1, 100, 40, 0)).toBe(true);
  });

  it("rejects a request that would exceed the key's TPM limit for the current window", () => {
    const limiter = new TokenPerMinuteRateLimiter();

    expect(limiter.tryConsume(1, 100, 80, 0)).toBe(true);
    expect(limiter.tryConsume(1, 100, 30, 0)).toBe(false);
  });

  it("does not reserve tokens for a rejected request", () => {
    const limiter = new TokenPerMinuteRateLimiter();

    expect(limiter.tryConsume(1, 100, 80, 0)).toBe(true);
    expect(limiter.tryConsume(1, 100, 30, 0)).toBe(false);
    // The rejected 30 wasn't reserved, so 20 more still fits in the 100 budget.
    expect(limiter.tryConsume(1, 100, 20, 0)).toBe(true);
  });

  it("resets the window each minute, unblocking subsequent requests", () => {
    const limiter = new TokenPerMinuteRateLimiter();

    expect(limiter.tryConsume(1, 100, 90, 0)).toBe(true);
    expect(limiter.tryConsume(1, 100, 20, 30_000)).toBe(false);

    // A full minute has elapsed since the window started at t=0.
    expect(limiter.tryConsume(1, 100, 90, 60_000)).toBe(true);
  });

  it("enforces each Gateway API Key's limit independently of other keys", () => {
    const limiter = new TokenPerMinuteRateLimiter();

    expect(limiter.tryConsume(1, 50, 50, 0)).toBe(true);
    expect(limiter.tryConsume(1, 50, 1, 0)).toBe(false);

    // Key 2 has its own budget and is unaffected by key 1 being exhausted.
    expect(limiter.tryConsume(2, 200, 150, 0)).toBe(true);
  });

  it("record() adds usage to the current window without an admission check", () => {
    const limiter = new TokenPerMinuteRateLimiter();

    expect(limiter.tryConsume(1, 100, 40, 0)).toBe(true);
    limiter.record(1, 50, 0);

    // 40 + 50 = 90 already used; 20 more would exceed the 100 budget.
    expect(limiter.tryConsume(1, 100, 20, 0)).toBe(false);
    expect(limiter.tryConsume(1, 100, 10, 0)).toBe(true);
  });
});
