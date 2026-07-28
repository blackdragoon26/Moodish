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
    async interpretMealMessage() {
      return null;
    },
    async summarizeRecommendation({ mode, options, matchNotice }) {
      const lead = mode === "office" ? "A balanced office spread" : "A tuned surprise meal";
      const prompt = buildSummaryPrompt({ mode, options, matchNotice });
      return {
        text: `${lead} with ${options.length} curated options. The top pick prioritizes the craving, dietary needs, maximum budget, and availability.`,
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
    async interpretMealMessage() {
      return null;
    },
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
    async interpretMealMessage({ message, previous = {} }) {
      const prompt = buildInterpretationPrompt({ message, previous });
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
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "moodish_meal_intent",
                strict: true,
                schema: MEAL_INTENT_SCHEMA
              }
            },
            provider: { require_parameters: true },
            temperature: 0.2,
            max_tokens: 500
          })
        });
      } catch (error) {
        throw providerError(`OpenRouter semantic extraction timed out or failed: ${error.message}`, {
          provider: "openrouter",
          model,
          status: "request_failed",
          request: prompt
        });
      }
      if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        throw providerError(`OpenRouter semantic extraction returned HTTP ${response.status}.`, {
          provider: "openrouter",
          model,
          status: "http_error",
          httpStatus: response.status,
          responseText: redact(responseText),
          request: prompt
        });
      }
      const body = await response.json();
      const content = body.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw providerError("OpenRouter returned no semantic intent.", {
          provider: "openrouter",
          model,
          status: "empty_response",
          request: prompt,
          responseText: redact(JSON.stringify(body))
        });
      }
      let intent;
      try {
        intent = JSON.parse(content);
      } catch {
        throw providerError("OpenRouter returned malformed semantic intent.", {
          provider: "openrouter",
          model,
          status: "invalid_json",
          request: prompt,
          responseText: redact(content)
        });
      }
      return {
        intent,
        trace: {
          provider: "openrouter",
          model,
          status: "ok",
          task: "semantic_meal_intent",
          request: prompt,
          responseText: redact(content)
        }
      };
    },
    async summarizeRecommendation({ mode, options, matchNotice }) {
      const prompt = buildSummaryPrompt({ mode, options, matchNotice });
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

function buildSummaryPrompt({ mode, options, matchNotice = "" }) {
  return {
    messages: [
      {
        role: "system",
        content:
          "You are Moodish, a warm, food-loving older-sibling style concierge: caring, lightly witty, and professionally useful. Summarize recommendations in one friendly sentence. Mention the top-ranked restaurant first. A small food pun, playful image, or tiny rhyme is welcome when natural, but never force humour or obscure the answer. Never claim an exact craving match when matchType is alternative or broad. Do not mention hidden scores or internal ids."
      },
      {
        role: "user",
        content: JSON.stringify({
          mode,
          matchNotice,
          options: options.map((option) => ({
            restaurantName: option.restaurantName,
            cuisine: option.cuisine,
            estimatedTotal: option.estimatedTotal,
            reasons: option.reasons,
            items: option.items.map((item) => item.name),
            matchType: option.matchType
          }))
        })
      }
    ]
  };
}

const MEAL_INTENT_SCHEMA = {
  type: "object",
  properties: {
    intentKind: {
      type: "string",
      enum: ["new_plan", "modify_plan", "small_talk"],
      description: "Whether this starts a meal plan, edits the active plan, or is casual conversation."
    },
    mood: {
      type: "string",
      description: "A compact but semantically rich description of the desired food. Empty when unchanged."
    },
    dietMode: { type: "string", enum: ["unknown", "veg", "non_veg", "both"] },
    dietExplicit: { type: "boolean" },
    maxBudget: { type: "number", minimum: 0, maximum: 100000 },
    budgetExplicit: { type: "boolean" },
    dietaryRules: { type: "array", items: { type: "string" } },
    allergies: { type: "array", items: { type: "string" } },
    discoveryMode: { type: "string", enum: ["unspecified", "comfort", "balanced", "explore"] },
    addOnIntent: {
      type: "string",
      enum: ["none", "beverage", "dessert", "side", "complete_meal", "remove_addons"]
    },
    requestedDishes: { type: "array", items: { type: "string" } },
    attributes: { type: "array", items: { type: "string" } },
    cuisines: { type: "array", items: { type: "string" } },
    acknowledgement: {
      type: "string",
      description: "A short warm acknowledgement with optional light food humour; no recommendation claims."
    },
    followUp: {
      type: "string",
      description: "One concise friendly question if essential information is missing, otherwise empty."
    }
  },
  required: [
    "intentKind",
    "mood",
    "dietMode",
    "dietExplicit",
    "maxBudget",
    "budgetExplicit",
    "dietaryRules",
    "allergies",
    "discoveryMode",
    "addOnIntent",
    "requestedDishes",
    "attributes",
    "cuisines",
    "acknowledgement",
    "followUp"
  ],
  additionalProperties: false
};

function buildInterpretationPrompt({ message, previous }) {
  return {
    messages: [
      {
        role: "system",
        content:
          "You interpret messages for Moodish, a food-planning concierge. Understand semantic cravings, cultural food language, textures, flavours, meal edits, implied add-ons, and conversational references. Explicit user statements override previous state. Do not infer allergies or dietary restrictions. If the person says add, swap, remove, also, instead, or refers to the current result, use modify_plan. Keep acknowledgement warm like a caring older sibling, professionally apt, with gentle food humour only when natural. Ask at most one useful follow-up. Return only the required JSON schema."
      },
      {
        role: "user",
        content: JSON.stringify({ previous, message })
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
