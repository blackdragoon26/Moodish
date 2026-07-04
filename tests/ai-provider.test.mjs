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

  const result = await provider.summarizeRecommendation({
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

  assert.equal(result.text, "Try Millet Monk for a balanced high-protein surprise.");
  assert.equal(result.trace.provider, "openrouter");
  assert.equal(result.trace.status, "ok");
  assert.match(result.trace.request.messages[1].content, /Millet Monk/);
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(calls[0].init.headers.authorization, "Bearer test-key");

  restoreEnv("AI_PROVIDER", oldProvider);
  restoreEnv("OPENROUTER_API_KEY", oldKey);
  restoreEnv("OPENROUTER_MODEL", oldModel);
});

test("openrouter provider supports request scoped key and model overrides", async () => {
  const oldProvider = process.env.AI_PROVIDER;
  const oldKey = process.env.OPENROUTER_API_KEY;
  const oldModel = process.env.OPENROUTER_MODEL;
  process.env.AI_PROVIDER = "mock";
  delete process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_MODEL = "env/model";

  const calls = [];
  const provider = createAiProvider({
    overrides: { provider: "openrouter", apiKey: "request-key", model: "request/model" },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        async json() {
          return { choices: [{ message: { content: "Try Green Fork Deli first." } }] };
        }
      };
    }
  });

  const result = await provider.summarizeRecommendation({
    mode: "solo",
    options: [
      {
        restaurantName: "Green Fork Deli",
        cuisine: "Healthy",
        estimatedTotal: 259,
        reasons: ["Fits budget"],
        items: [{ name: "Avocado Chickpea Crunch Salad" }]
      }
    ]
  });

  assert.equal(result.text, "Try Green Fork Deli first.");
  assert.equal(calls[0].init.headers.authorization, "Bearer request-key");
  assert.match(calls[0].init.body, /request\/model/);
  assert.equal(result.trace.model, "request/model");

  restoreEnv("AI_PROVIDER", oldProvider);
  restoreEnv("OPENROUTER_API_KEY", oldKey);
  restoreEnv("OPENROUTER_MODEL", oldModel);
});

test("openrouter provider returns relevant error when inference hangs", async () => {
  const oldProvider = process.env.AI_PROVIDER;
  const oldKey = process.env.OPENROUTER_API_KEY;
  const oldTimeout = process.env.AI_PROVIDER_TIMEOUT_MS;
  process.env.AI_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.AI_PROVIDER_TIMEOUT_MS = "5";

  const provider = createAiProvider({
    fetchImpl: async () => new Promise(() => {})
  });

  await assert.rejects(
    () =>
      provider.summarizeRecommendation({
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
      }),
    (error) => {
      assert.equal(error.status, 502);
      assert.match(error.message, /timed out|failed/);
      assert.equal(error.details.provider, "openrouter");
      assert.equal(error.details.status, "request_failed");
      return true;
    }
  );

  restoreEnv("AI_PROVIDER", oldProvider);
  restoreEnv("OPENROUTER_API_KEY", oldKey);
  restoreEnv("AI_PROVIDER_TIMEOUT_MS", oldTimeout);
});

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
