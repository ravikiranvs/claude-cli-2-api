import { describe, expect, it } from "vitest";
import { signSessionToken, verifySessionToken } from "../src/admin/session.js";

describe("session tokens", () => {
  it("round-trips a valid token back to the signed-in username", () => {
    const token = signSessionToken("admin", "s3cret", { now: 1_000 });

    const result = verifySessionToken(token, "s3cret", 1_500);

    expect(result).toEqual({ username: "admin" });
  });

  it("rejects a token once it is past its expiry", () => {
    const token = signSessionToken("admin", "s3cret", { ttlSeconds: 60, now: 1_000 });

    const result = verifySessionToken(token, "s3cret", 1_061);

    expect(result).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signSessionToken("admin", "s3cret", { now: 1_000 });

    const result = verifySessionToken(token, "a-different-secret", 1_500);

    expect(result).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const token = signSessionToken("admin", "s3cret", { now: 1_000 });
    const [payload, signature] = token.split(".");
    const tamperedPayload = Buffer.from("root:9999999999").toString("base64url");

    const result = verifySessionToken(`${tamperedPayload}.${signature}`, "s3cret", 1_500);

    expect(result).toBeNull();
  });

  it("rejects garbage input", () => {
    expect(verifySessionToken("not-a-token", "s3cret", 1_000)).toBeNull();
    expect(verifySessionToken("", "s3cret", 1_000)).toBeNull();
  });
});
