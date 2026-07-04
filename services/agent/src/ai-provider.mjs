export function createAiProvider({ fetchImpl = fetch, overrides = {} } = {}) {
  const provider = overrides.provider || process.env.AI_PROVIDER || "mock";
  const endpoint = process.env.AI_PROVIDER_ENDPOINT || "";
  if (provider === "mock") return mockProvider();
  if (provider === "openrouter") return openRouterProvider(fetchImpl, overrides);
  return httpProvider(provider, endpoint, fetchImpl);
}

const DEFAULT_AI_TIMEOUT_MS = 4500;

function mockProvider() {
  return {
    name: "mock",
    async summarizeRecommendation({ mode, options }) {
      const lead = mode === "office" ? "A balanced office spread" : "A tuned surprise meal";
      const prompt = buildSummaryPrompt({ mode, options });
      return {
        text: `${lead} with ${options.length} curated options. The top pick balances taste memory, budget, novelty, and availability.`,
        trace: {
          provider: "mock",
          status: "local_mock",
          note: "No external AI call was made. Set AI_PROVIDER=openrouter and OPENROUTER_API_KEY to test real inference.",
          request: prompt
        }
      };
    }
  };
}

function httpProvider(provider, endpoint, fetchImpl) {
  return {
    name: provider,
    async summarizeRecommendation(payload) {
      const prompt = buildSummaryPrompt(payload);
      if (!endpoint) {
        throw providerError(`AI provider '${provider}' is configured but AI_PROVIDER_ENDPOINT is missing.`, {
          provider,
          status: "configuration_error",
          request: prompt
        });
      }
      let response;
      try {
        response = await fetchWithTimeout(fetchImpl, endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider, task: "summarize_recommendation", payload })
        });
      } catch (error) {
        throw providerError(`AI provider '${provider}' timed out or failed: ${error.message}`, {
          provider,
          status: "request_failed",
          request: prompt
        });
      }
      if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        throw providerError(`AI provider '${provider}' returned HTTP ${response.status}.`, {
          provider,
          status: "http_error",
          httpStatus: response.status,
          responseText: redact(responseText),
          request: prompt
        });
      }
      const body = await response.json();
      const text = body.summary;
      if (!text) {
        throw providerError(`AI provider '${provider}' returned no summary.`, {
          provider,
          status: "empty_response",
          request: prompt,
          responseText: redact(JSON.stringify(body))
        });
      }
      return {
        text,
        trace: {
          provider,
          status: "ok",
          request: prompt,
          responseText: text
        }
      };
    }
  };
}

function openRouterProvider(fetchImpl, overrides = {}) {
  const apiKey = overrides.apiKey || process.env.OPENROUTER_API_KEY || "";
  const model = overrides.model || process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
  return {
    name: "openrouter",
    async summarizeRecommendation({ mode, options }) {
      const prompt = buildSummaryPrompt({ mode, options });
      if (!apiKey) {
        throw providerError("OpenRouter is configured but OPENROUTER_API_KEY is missing.", {
          provider: "openrouter",
          model,
          status: "configuration_error",
          request: prompt
        });
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
            messages: prompt.messages,
            temperature: 0.4,
            max_tokens: 90
          })
        });
      } catch (error) {
        throw providerError(`OpenRouter timed out or failed: ${error.message}`, {
          provider: "openrouter",
          model,
          status: "request_failed",
          request: prompt
        });
      }
      if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        throw providerError(`OpenRouter returned HTTP ${response.status}.`, {
          provider: "openrouter",
          model,
          status: "http_error",
          httpStatus: response.status,
          responseText: redact(responseText),
          request: prompt
        });
      }
      const body = await response.json();
      const text = body.choices?.[0]?.message?.content?.trim();
      if (!text) {
        throw providerError("OpenRouter returned no assistant message.", {
          provider: "openrouter",
          model,
          status: "empty_response",
          request: prompt,
          responseText: redact(JSON.stringify(body))
        });
      }
      return {
        text,
        trace: {
          provider: "openrouter",
          model,
          status: "ok",
          request: prompt,
          responseText: text
        }
      };
    }
  };
}

function buildSummaryPrompt({ mode, options }) {
  return {
    messages: [
      {
        role: "system",
        content:
          "You are Moodish, a concise food planning assistant. Summarize recommendations in one friendly sentence. Mention the top-ranked restaurant first. Do not mention hidden scores or internal ids."
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
    ]
  };
}

function providerError(message, details = {}) {
  const error = new Error(message);
  error.status = 502;
  error.details = details;
  return error;
}

function redact(value = "") {
  return String(value).replace(/sk-[a-zA-Z0-9_-]+/g, "[redacted-key]").slice(0, 1200);
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
