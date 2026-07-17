import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_SECONDS = 12 * 60 * 60;

export interface SessionTokenOptions {
  ttlSeconds?: number;
  now?: number;
}

export interface SessionPayload {
  username: string;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function signSessionToken(
  username: string,
  secret: string,
  options: SessionTokenOptions = {},
): string {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const expiresAt = now + ttlSeconds;

  const payload = Buffer.from(`${username}:${expiresAt}`, "utf8").toString("base64url");
  const signature = sign(payload, secret);

  return `${payload}.${signature}`;
}

export function verifySessionToken(
  token: string,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature) return null;

  const expectedSignature = sign(payload, secret);
  const signatureBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  if (signatureBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

  const decoded = Buffer.from(payload, "base64url").toString("utf8");
  const separatorIndex = decoded.lastIndexOf(":");
  if (separatorIndex === -1) return null;

  const username = decoded.slice(0, separatorIndex);
  const expiresAt = Number(decoded.slice(separatorIndex + 1));
  if (!username || !Number.isFinite(expiresAt)) return null;
  if (now >= expiresAt) return null;

  return { username };
}
