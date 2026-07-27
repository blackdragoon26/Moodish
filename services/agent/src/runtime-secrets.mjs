import crypto from "node:crypto";

const fixtureSecrets = new Map();
const warned = new Set();

export function runtimeSigningSecret(purpose = "session") {
  const configured = process.env.GROUP_SESSION_SIGNING_KEY || process.env.TOKEN_ENCRYPTION_KEY;
  if (configured) return configured;

  if ((process.env.SWIGGY_MODE || "fixture") === "live") {
    const error = new Error("GROUP_SESSION_SIGNING_KEY or TOKEN_ENCRYPTION_KEY is required for live Swiggy mode");
    error.status = 503;
    throw error;
  }

  if (!fixtureSecrets.has(purpose)) fixtureSecrets.set(purpose, crypto.randomBytes(32).toString("base64url"));
  if (!warned.has(purpose)) {
    warned.add(purpose);
    console.warn(`[Moodish] Using an ephemeral ${purpose} key for fixture mode. Existing demo sessions expire after restart.`);
  }
  return fixtureSecrets.get(purpose);
}
