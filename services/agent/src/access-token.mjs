import crypto from "node:crypto";
import { runtimeSigningSecret } from "./runtime-secrets.mjs";

export function signGroupAccessToken({ sessionId, actorId, expiresInSeconds = 3600 }) {
  const payload = Buffer.from(
    JSON.stringify({
      sessionId,
      actorId,
      exp: Math.floor(Date.now() / 1000) + expiresInSeconds
    })
  ).toString("base64url");
  const signature = crypto.createHmac("sha256", signingKey()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyGroupAccessToken(token, expectedSessionId) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) throw unauthorized("Missing group access token");
  const expected = crypto.createHmac("sha256", signingKey()).update(payload).digest("base64url");
  if (!safeEqual(expected, signature)) throw unauthorized("Invalid group access token");
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw unauthorized("Invalid group access token payload");
  }
  if (decoded.exp <= Math.floor(Date.now() / 1000)) throw unauthorized("Expired group access token");
  if (expectedSessionId && decoded.sessionId !== expectedSessionId) throw unauthorized("Group access token session mismatch");
  return decoded;
}

function signingKey() {
  return runtimeSigningSecret("group-session");
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function unauthorized(message) {
  const error = new Error(message);
  error.status = 401;
  return error;
}
