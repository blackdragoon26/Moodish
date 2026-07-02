export function createAiProvider({ fetchImpl = fetch } = {}) {
  const provider = process.env.AI_PROVIDER || "mock";
  const endpoint = process.env.AI_PROVIDER_ENDPOINT || "";
  if (provider === "mock") return mockProvider();
  if (provider === "openrouter") return openRouterProvider(fetchImpl);
  return httpProvider(provider, endpoint, fetchImpl);
}

const DEFAULT_AI_TIMEOUT_MS = 4500;

function mockProvider() {
  return {
    name: "mock",
    async summarizeRecommendation({ mode, options }) {
      const lead = mode === "office" ? "A balanced office spread" : "A tuned surprise meal";
      return `${lead} with ${options.length} curated options. The top pick balances taste memory, budget, novelty, and availability.`;
    }
  };
}

function httpProvider(provider, endpoint, fetchImpl) {
  return {
    name: provider,
    async summarizeRecommendation(payload) {
      if (!endpoint) {
        return `AI provider '${provider}' is configured but no endpoint is set; deterministic ranking was used.`;
      }
      let response;
      try {
        response = await fetchWithTimeout(fetchImpl, endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider, task: "summarize_recommendation", payload })
        });
      } catch (error) {
        return `AI provider '${provider}' timed out or failed; deterministic ranking was used.`;
      }
      if (!response.ok) {
        return `AI provider '${provider}' returned ${response.status}; deterministic ranking was used.`;
      }
      const body = await response.json();
      return body.summary || "Deterministic ranking completed.";
    }
  };
}

function openRouterProvider(fetchImpl) {
  const apiKey = process.env.OPENROUTER_API_KEY || "";
  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
  return {
    name: "openrouter",
    async summarizeRecommendation({ mode, options }) {
      if (!apiKey) {
        return "OpenRouter is configured but OPENROUTER_API_KEY is missing; deterministic ranking was used.";
      }
      let response;
      try {
        response = await fetchWithTimeout(fetchImpl, "https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
            "http-referer": "https://github.com/blackdragoon26/Moodish",
            "x-title": "Moodish"
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "system",
                content:
                  "You are Moodish, a concise food planning assistant. Summarize recommendations in one friendly sentence. Do not mention hidden scores or internal ids."
              },
              {
                role: "user",
                content: JSON.stringify({
                  mode,
                  options: options.map((option) => ({
                    restaurantName: option.restaurantName,
                    cuisine: option.cuisine,
                    estimatedTotal: option.estimatedTotal,
                    reasons: option.reasons,
                    items: option.items.map((item) => item.name)
                  }))
                })
              }
            ],
            temperature: 0.4,
            max_tokens: 90
          })
        });
      } catch (error) {
        return "OpenRouter timed out or failed; deterministic ranking was used.";
      }
      if (!response.ok) {
        return `OpenRouter returned ${response.status}; deterministic ranking was used.`;
      }
      const body = await response.json();
      return body.choices?.[0]?.message?.content?.trim() || "Deterministic ranking completed.";
    }
  };
}

async function fetchWithTimeout(fetchImpl, url, init) {
  const timeoutMs = Number(process.env.AI_PROVIDER_TIMEOUT_MS || DEFAULT_AI_TIMEOUT_MS);
  const controller = new AbortController();
  let timeout;
  try {
    return await Promise.race([
      fetchImpl(url, { ...init, signal: controller.signal }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("AI provider timeout"));
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
