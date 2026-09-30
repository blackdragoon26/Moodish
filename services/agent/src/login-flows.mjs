import crypto from "node:crypto";
import { getSecretSession, saveSecretSession, takeSecretSession, pruneExpiredFlows } from "./memory.mjs";

// Why a login failed, as handed back to the web app (`?swiggy_error=`,
// `?login_error=`) and the native apps (`moodish://auth-callback?error=`).
// Source of truth: the web app and both native apps keep their own messages
// for exactly these codes.
export const LOGIN_ERRORS = Object.freeze({
  EXPIRED: "expired",
  BROWSER_MISMATCH: "browser_mismatch",
  DECLINED: "declined",
  EXCHANGE_FAILED: "exchange_failed",
  UPDATE_REQUIRED: "update_required",
  FAILED: "failed"
});
const KNOWN_REASONS = new Set(Object.values(LOGIN_ERRORS));

export const hashValue = value => crypto.createHash("sha256").update(String(value)).digest("base64url");

// `flowKind` ("mobile" or "browser") says which app should receive the reason.
export function loginFailure(message, reason, flowKind, status = 400) {
  return Object.assign(new Error(message), { status, loginError: reason, flowKind });
}

// The reason safe to put in a redirect: a known code, never provider text.
export function loginErrorReason(error) {
  return KNOWN_REASONS.has(error.loginError) ? error.loginError : LOGIN_ERRORS.FAILED;
}

// A new flow's state and PKCE pair.
export function newFlowSecrets({ stateBytes = 24 } = {}) {
  const state = crypto.randomBytes(stateBytes).toString("base64url");
  const verifier = crypto.randomBytes(32).toString("base64url");
  return { state, verifier, challenge: hashValue(verifier) };
}

// Login flows (swiggy, google, platform) are stored durably so any replica or a
// restarted process can finish them, and each is redeemed at most once.
const flowKey = (kind, state) => `${kind}-flow:${hashValue(state || "")}`;

export async function saveFlow(kind, state, record) {
  await saveSecretSession(flowKey(kind, state), record);
  await pruneExpiredFlows();
}

// Reads a flow without consuming it, so checks such as the browser binding can
// refuse a wrong caller without burning the rightful caller's flow.
export async function peekFlow(kind, state) {
  return state ? getSecretSession(flowKey(kind, state)) : null;
}

// Consumes a flow; only one caller ever gets it back.
export async function claimFlow(kind, state) {
  return takeSecretSession(flowKey(kind, state));
}
