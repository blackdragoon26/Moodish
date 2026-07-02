import test from "node:test";
import assert from "node:assert/strict";
import { createAiProvider } from "../services/agent/src/ai-provider.mjs";

test("openrouter provider summarizes via chat completions without exposing key", async () => {
  const oldProvider = process.env.AI_PROVIDER;
  const oldKey = process.env.OPENROUTER_API_KEY;
  const oldModel = process.env.OPENROUTER_MODEL;
  process.env.AI_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_MODEL = "test/model";

  const calls = [];
  const provider = createAiProvider({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        async json() {
          return { choices: [{ message: { content: "Try Millet Monk for a balanced high-protein surprise." } }] };
        }
      };
    }
  });

  const summary = await provider.summarizeRecommendation({
    mode: "solo",
    options: [
      {
        restaurantName: "Millet Monk",
        cuisine: "South Indian",
        estimatedTotal: 249,
        reasons: ["Fits budget"],
        items: [{ name: "Podi Millet Bowl" }]
      }
    ]
  });

  assert.equal(summary, "Try Millet Monk for a balanced high-protein surprise.");
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(calls[0].init.headers.authorization, "Bearer test-key");

  restoreEnv("AI_PROVIDER", oldProvider);
  restoreEnv("OPENROUTER_API_KEY", oldKey);
  restoreEnv("OPENROUTER_MODEL", oldModel);
});

test("openrouter provider falls back quickly when inference hangs", async () => {
  const oldProvider = process.env.AI_PROVIDER;
  const oldKey = process.env.OPENROUTER_API_KEY;
  const oldTimeout = process.env.AI_PROVIDER_TIMEOUT_MS;
  process.env.AI_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.AI_PROVIDER_TIMEOUT_MS = "5";

  const provider = createAiProvider({
    fetchImpl: async () => new Promise(() => {})
  });

  const summary = await provider.summarizeRecommendation({
    mode: "solo",
    options: [
      {
        restaurantName: "Millet Monk",
        cuisine: "South Indian",
        estimatedTotal: 249,
        reasons: ["Fits budget"],
        items: [{ name: "Podi Millet Bowl" }]
      }
    ]
  });

  assert.match(summary, /timed out|failed/);

  restoreEnv("AI_PROVIDER", oldProvider);
  restoreEnv("OPENROUTER_API_KEY", oldKey);
  restoreEnv("AI_PROVIDER_TIMEOUT_MS", oldTimeout);
});

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
