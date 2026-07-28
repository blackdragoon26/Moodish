import { normalizeDiscoveryMode, normalizeDietMode } from "./intent.mjs";

export async function continueMealConversation(args = {}, tools) {
  const message = String(args.message || "").trim();
  if (!message) throw badRequest("Tell Moodish what you feel like eating.");
  const previous = args.state && typeof args.state === "object" ? args.state : {};
  const deterministicState = extractState(message, previous);
  let semanticResult = null;
  try {
    semanticResult = await tools.interpret_meal_message?.({
      message,
      previous,
      aiApiKey: args.aiApiKey,
      aiModel: args.aiModel
    });
  } catch (error) {
    semanticResult = {
      intent: null,
      trace: {
        status: "fallback",
        note: `Semantic AI was unavailable, so deterministic extraction was used: ${error.message}`
      }
    };
  }
  const state = mergeSemanticState(deterministicState, semanticResult?.intent, previous);
  const missing = [];
  if (!state.mood) missing.push("mood");
  if (!state.dietExplicit) missing.push("diet");
  if (!state.budgetExplicit) missing.push("budget");

  if (missing.length) {
    return {
      status: "needs_input",
      state,
      missing,
      reply: [semanticResult?.intent?.acknowledgement, followUp(missing)].filter(Boolean).join(" "),
      quickReplies: quickReplies(missing)
    };
  }

  const recommendation = await tools.plan_personal_meal({
    mood: state.mood,
    maxBudget: state.maxBudget,
    dietMode: state.dietMode,
    dietaryRules: state.dietaryRules,
    allergies: state.allergies,
    discoveryMode: state.discoveryMode,
    includeInstamartAddOns: state.includeInstamartAddOns,
    addOnIntent: state.addOnIntent,
    addressId: args.addressId,
    userIdHash: args.userIdHash,
    aiApiKey: args.aiApiKey,
    aiModel: args.aiModel
  });
  recommendation.transparency.conversation = {
    source: semanticResult?.intent ? "ai_structured" : "deterministic_fallback",
    intentKind: semanticResult?.intent?.intentKind || "new_plan",
    addOnIntent: state.addOnIntent,
    trace: semanticResult?.trace
  };
  return {
    status: "complete",
    state,
    reply: recommendation.summary,
    recommendation
  };
}

export function extractState(message, previous = {}) {
  const text = message.toLowerCase();
  const next = {
    mood: previous.mood || "",
    dietMode: previous.dietMode || "both",
    dietaryRules: [...(previous.dietaryRules || [])],
    allergies: [...(previous.allergies || [])],
    maxBudget: previous.maxBudget || 350,
    discoveryMode: normalizeDiscoveryMode(previous),
    includeInstamartAddOns: previous.includeInstamartAddOns ?? true,
    addOnIntent: previous.addOnIntent || "none",
    dietExplicit: Boolean(previous.dietExplicit),
    budgetExplicit: Boolean(previous.budgetExplicit)
  };

  const budget = text.match(/(?:₹|rs\.?|rupees?|under|below|upto|up to|max(?:imum)?(?: budget)?|budget(?: is| of)?)\s*₹?\s*(\d{2,4})/i);
  const fallbackBudget = text.match(/\b(\d{3,4})\b/);
  if (budget || fallbackBudget) {
    next.maxBudget = Number((budget || fallbackBudget)[1]);
    next.budgetExplicit = true;
  }

  const hasNonVegChoice = /\b(non[\s-]?veg|chicken|mutton|fish|egg)\b/.test(text);
  if (hasNonVegChoice && !/\bveg only\b/.test(text)) {
    next.dietMode = "non_veg";
    next.dietExplicit = true;
  }
  if (!hasNonVegChoice && /\b(veg|veg only|vegetarian|pure veg|vegan|jain)\b/.test(text)) {
    next.dietMode = "veg";
    next.dietExplicit = true;
  }
  if (/\b(both|anything|no food preference|veg and non[\s-]?veg|either)\b/.test(text)) {
    next.dietMode = "both";
    next.dietExplicit = true;
  }

  const rulePatterns = [
    ["vegan", /\bvegan\b/],
    ["jain", /\bjain\b/],
    ["high-protein", /\b(high[\s-]?protein|protein heavy)\b/],
    ["low-carb", /\blow[\s-]?carb\b/],
    ["no-onion-garlic", /\b(no onion|no garlic|without onion|without garlic)\b/]
  ];
  for (const [rule, pattern] of rulePatterns) {
    if (pattern.test(text) && !next.dietaryRules.includes(rule)) next.dietaryRules.push(rule);
  }
  const allergy = text.match(/(?:allergic to|allergy[:\s]+|no)\s+(peanut|peanuts|mushroom|shellfish|dairy|gluten|nuts?)/);
  if (allergy && !next.allergies.includes(allergy[1])) next.allergies.push(allergy[1]);
  if (/\b(no restrictions?|none|no allergies)\b/.test(text)) next.dietExplicit = true;

  if (/\b(familiar|usual|good old|comfort)\b/.test(text)) next.discoveryMode = "comfort";
  if (/\b(absolutely new|something new|surprise me|adventurous|explore)\b/.test(text)) next.discoveryMode = "explore";
  if (/\b(mix|balanced)\b/.test(text)) next.discoveryMode = "balanced";
  if (/\b(no add[\s-]?ons?|food only)\b/.test(text)) next.includeInstamartAddOns = false;
  if (/\b(no add[\s-]?ons?|food only|remove (?:the )?(?:drink|dessert|side))\b/.test(text)) next.addOnIntent = "remove_addons";
  if (/\b(beverage|drink|cold ?drink|cola|soda|juice|shake)\b/.test(text)) next.addOnIntent = "beverage";
  else if (/\b(dessert|sweet dish|something sweet)\b/.test(text)) next.addOnIntent = "dessert";
  else if (/\b(side|starter|fries)\b/.test(text)) next.addOnIntent = "side";
  else if (/\b(add[\s-]?ons?|complete meal|make it complete)\b/.test(text)) next.addOnIntent = "complete_meal";
  if (next.addOnIntent !== "none" && next.addOnIntent !== "remove_addons") next.includeInstamartAddOns = true;
  if (next.addOnIntent === "remove_addons") next.includeInstamartAddOns = false;

  if (!previous.mood) {
    const stripped = text
      .replace(/(?:₹|rs\.?|rupees?|under|below|upto|up to|max(?:imum)?(?: budget)?|budget(?: is| of)?)\s*₹?\s*\d{2,4}/g, "")
      .replace(/\b(veg only|vegetarian|pure veg|non[\s-]?veg|both|anything|no restrictions?|none)\b/g, "")
      .trim();
    if (stripped && !/^(hi|hello|hey)$/.test(stripped)) next.mood = stripped;
  }
  return next;
}

function mergeSemanticState(deterministic, semantic, previous) {
  if (!semantic || typeof semantic !== "object") return deterministic;
  const next = { ...deterministic };
  if (semantic.intentKind === "new_plan" && semantic.mood) next.mood = semantic.mood;
  if (!previous.mood && semantic.mood) next.mood = semantic.mood;
  if (semantic.dietExplicit && ["veg", "non_veg", "both"].includes(semantic.dietMode)) {
    next.dietMode = semantic.dietMode;
    next.dietExplicit = true;
  }
  if (semantic.budgetExplicit && Number(semantic.maxBudget) > 0) {
    next.maxBudget = Number(semantic.maxBudget);
    next.budgetExplicit = true;
  }
  if (Array.isArray(semantic.dietaryRules)) {
    next.dietaryRules = [...new Set([...next.dietaryRules, ...semantic.dietaryRules.map(String)])];
  }
  if (Array.isArray(semantic.allergies)) {
    next.allergies = [...new Set([...next.allergies, ...semantic.allergies.map(String)])];
  }
  if (["comfort", "balanced", "explore"].includes(semantic.discoveryMode)) {
    next.discoveryMode = semantic.discoveryMode;
  }
  if (["beverage", "dessert", "side", "complete_meal", "remove_addons"].includes(semantic.addOnIntent)) {
    next.addOnIntent = semantic.addOnIntent;
    next.includeInstamartAddOns = semantic.addOnIntent !== "remove_addons";
  }
  return next;
}

function followUp(missing) {
  if (missing.includes("mood")) return "What are you in the mood for? Describe a dish, texture, flavour, or just the kind of day you are having.";
  if (missing.includes("diet") && missing.includes("budget")) {
    return "Two quick choices and I’m set. First, what food boundary should I protect?";
  }
  if (missing.includes("diet")) return "Choose the food boundary I should protect.";
  return "What is the most you want to spend on this meal?";
}

function quickReplies(missing) {
  if (missing.includes("diet")) return ["Veg", "Both", "Non-veg", "Vegan", "Jain"];
  if (missing.includes("budget")) return ["Under ₹250", "Under ₹400", "Under ₹600", "Under ₹1000"];
  return ["Chewy and smoky", "Light but satisfying", "Spicy comfort food"];
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}
