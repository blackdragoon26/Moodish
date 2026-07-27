import { normalizeDiscoveryMode, normalizeDietMode } from "./intent.mjs";

export async function continueMealConversation(args = {}, tools) {
  const message = String(args.message || "").trim();
  if (!message) throw badRequest("Tell Moodish what you feel like eating.");
  const previous = args.state && typeof args.state === "object" ? args.state : {};
  const state = extractState(message, previous);
  const missing = [];
  if (!state.mood) missing.push("mood");
  if (!state.dietExplicit) missing.push("diet");
  if (!state.budgetExplicit) missing.push("budget");

  if (missing.length) {
    return {
      status: "needs_input",
      state,
      missing,
      reply: followUp(missing),
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
    addressId: args.addressId,
    userIdHash: args.userIdHash,
    aiApiKey: args.aiApiKey,
    aiModel: args.aiModel
  });
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
  if (/\b(add[\s-]?ons?|drink|cold ?drink|dessert|complete meal)\b/.test(text)) next.includeInstamartAddOns = true;

  if (!previous.mood) {
    const stripped = text
      .replace(/(?:₹|rs\.?|rupees?|under|below|upto|up to|max(?:imum)?(?: budget)?|budget(?: is| of)?)\s*₹?\s*\d{2,4}/g, "")
      .replace(/\b(veg only|vegetarian|pure veg|non[\s-]?veg|both|anything|no restrictions?|none)\b/g, "")
      .trim();
    if (stripped && !/^(hi|hello|hey)$/.test(stripped)) next.mood = stripped;
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
