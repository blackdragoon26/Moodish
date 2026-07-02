import { nowIso } from "./contracts.mjs";
import { logAudit } from "./memory.mjs";

export async function instrumentToolCall({ tool, userIdHash, recommendationId }, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - started;
    logAudit("mcp_tool_call", {
      tool,
      userIdHash,
      recommendationId,
      durationMs,
      status: "ok",
      ts: nowIso()
    });
    return result;
  } catch (error) {
    const durationMs = Date.now() - started;
    logAudit("mcp_tool_call", {
      tool,
      userIdHash,
      recommendationId,
      durationMs,
      status: "error",
      message: error.message,
      ts: nowIso()
    });
    throw error;
  }
}

export async function retrySwiggyCall(fn, { maxAttempts = 4, retryable = isRetryable } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt >= maxAttempts || !retryable(error)) throw error;
      const baseMs = 100 * 2 ** (attempt - 1);
      const jitterMs = Math.random() * baseMs * 0.25;
      await new Promise((resolve) => setTimeout(resolve, baseMs + jitterMs));
    }
  }
}

export function isRetryable(error) {
  const status = error?.status ?? error?.response?.status;
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  const code = error?.code ?? error?.body?.error?.code;
  return ["UPSTREAM_TIMEOUT", "UPSTREAM_ERROR", "INTERNAL_ERROR"].includes(code);
}
