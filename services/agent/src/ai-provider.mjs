export function createAiProvider() {
  const provider = process.env.AI_PROVIDER || "mock";
  const endpoint = process.env.AI_PROVIDER_ENDPOINT || "";
  if (provider === "mock") return mockProvider();
  return httpProvider(provider, endpoint);
}

function mockProvider() {
  return {
    name: "mock",
    async summarizeRecommendation({ mode, options }) {
      const lead = mode === "office" ? "A balanced office spread" : "A tuned surprise meal";
      return `${lead} with ${options.length} curated options. The top pick balances taste memory, budget, novelty, and availability.`;
    }
  };
}

function httpProvider(provider, endpoint) {
  return {
    name: provider,
    async summarizeRecommendation(payload) {
      if (!endpoint) {
        return `AI provider '${provider}' is configured but no endpoint is set; deterministic ranking was used.`;
      }
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, task: "summarize_recommendation", payload })
      });
      if (!response.ok) {
        return `AI provider '${provider}' returned ${response.status}; deterministic ranking was used.`;
      }
      const body = await response.json();
      return body.summary || "Deterministic ranking completed.";
    }
  };
}
