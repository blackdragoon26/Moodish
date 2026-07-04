import { clampNumber, makeRecommendationId, normalizeList } from "./contracts.mjs";
import { expandIntentTokens } from "./swiggy-gateway.mjs";

export async function planPersonalMeal({ request, tasteProfile, swiggy, ai }) {
  const budget = clampNumber(request.budget, 120, 1000, tasteProfile.budgetComfort || 350);
  const novelty = clampNumber(request.novelty, 1, 5, tasteProfile.noveltyPreference || 3);
  const dietaryRules = mergeRules(tasteProfile.dietaryRules, request.dietaryRules);
  const mood = request.mood || "curious";
  const addresses = await swiggy.getAddresses();
  const address = pickAddress(addresses, request.addressLabel);
  const restaurants = await swiggy.searchRestaurants({ addressId: address.id, query: request.query || mood });
  const intentTags = expandIntentTokens([mood, request.query].filter(Boolean).join(" "));
  const candidates = await candidatePool({ swiggy, addressId: address.id, matches: restaurants, minOptions: 6 });
  const ranked = rankRestaurants(candidates, {
    budget,
    novelty,
    dietaryRules,
    intentTags,
    avoidCuisines: tasteProfile.weeklyCuisineHistory || [],
    likedCuisines: tasteProfile.likedCuisines || [],
    headcount: 1
  }).slice(0, 3);
  const options = await Promise.all(ranked.map((restaurant) => optionFromRestaurant(restaurant, swiggy, budget, 1, { intentTags, dietaryRules })));
  const aiSummary = await summarizeShortlist(ai, { mode: "solo", options });
  const run = {
    recommendationId: makeRecommendationId("solo"),
    mode: "solo",
    address,
    request: { ...request, budget, novelty, dietaryRules },
    options,
    summary: aiSummary.text,
    transparency: {
      moodInput: mood,
      intentTags,
      searchedRestaurants: restaurants.map((restaurant) => restaurant.name),
      candidateRestaurants: candidates.map((restaurant) => restaurant.name),
      ranking: ranked.map((restaurant) => ({
        restaurantName: restaurant.name,
        cuisine: restaurant.cuisine,
        score: restaurant.score
      })),
      ai: aiSummary.trace
    },
    safety: {
      requiresCartConfirmation: true,
      orderPlacementEnabled: false,
      note: "Cart can be prepared only after recommendation confirmation; real order placement is intentionally gated."
    }
  };
  return run;
}

export async function planOfficeLunch({ request, teamProfile, swiggy, ai }) {
  const headcount = clampNumber(request.headcount, 2, 15, teamProfile.headcount || 6);
  const budgetPerPerson = clampNumber(request.budgetPerPerson, 120, 1000, teamProfile.budgetPerPerson || 250);
  const totalBudget = headcount * budgetPerPerson;
  const dietaryRules = mergeRules(teamProfile.dietaryRules, request.dietaryRules);
  const avoidCuisines = mergeRules(teamProfile.cuisineAvoidList, request.cuisineAvoidList);
  const addresses = await swiggy.getAddresses();
  const address = pickAddress(addresses, request.addressLabel);
  const restaurants = await swiggy.searchRestaurants({ addressId: address.id, query: request.query || "office lunch" });
  const intentTags = expandIntentTokens([request.query, "office lunch"].filter(Boolean).join(" "));
  const candidates = await candidatePool({ swiggy, addressId: address.id, matches: restaurants, minOptions: 6 });
  const ranked = rankRestaurants(candidates, {
    budget: budgetPerPerson,
    novelty: 3,
    dietaryRules,
    intentTags,
    avoidCuisines,
    likedCuisines: [],
    headcount
  }).slice(0, 3);
  const options = await Promise.all(ranked.map((restaurant) => optionFromRestaurant(restaurant, swiggy, totalBudget, headcount, { intentTags, dietaryRules })));
  const addOns = await swiggy.searchProducts({ query: "office-friendly" });
  const aiSummary = await summarizeShortlist(ai, { mode: "office", options });
  const run = {
    recommendationId: makeRecommendationId("office"),
    mode: "office",
    address,
    request: { ...request, headcount, budgetPerPerson, totalBudget, dietaryRules, avoidCuisines },
    options: options.map((option) => ({ ...option, addOns: addOns.slice(0, 2) })),
    summary: aiSummary.text,
    transparency: {
      moodInput: request.query || "office lunch",
      intentTags,
      searchedRestaurants: restaurants.map((restaurant) => restaurant.name),
      candidateRestaurants: candidates.map((restaurant) => restaurant.name),
      ranking: ranked.map((restaurant) => ({
        restaurantName: restaurant.name,
        cuisine: restaurant.cuisine,
        score: restaurant.score
      })),
      ai: aiSummary.trace
    },
    safety: {
      requiresCartConfirmation: true,
      groupPaymentSupported: false,
      scheduledDeliverySupported: false,
      note: "V1 creates immediate confirmed carts only; group payment and scheduled delivery are not assumed."
    }
  };
  return run;
}

export async function buildConfirmedCart({ recommendation, optionId, swiggy, confirmed }) {
  if (!confirmed) {
    const error = new Error("Explicit confirmation is required before cart build");
    error.status = 409;
    throw error;
  }
  const option = recommendation.options.find((candidate) => candidate.optionId === optionId) || recommendation.options[0];
  if (!option) {
    const error = new Error("No recommendation option available");
    error.status = 404;
    throw error;
  }
  const cart = await swiggy.buildFoodCart({
    restaurantId: option.restaurantId,
    items: option.items.map((item) => ({ itemId: item.itemId, quantity: item.quantity }))
  });
  return {
    ...cart,
    recommendationId: recommendation.recommendationId,
    explicitConfirmationCaptured: true,
    checkoutBlocked: true,
    checkoutNote: "Order placement remains disabled until a separate confirmed checkout path is added."
  };
}

function mergeRules(...groups) {
  return [...new Set(groups.flatMap(normalizeList))];
}

function pickAddress(addresses, label) {
  if (!addresses?.length) throw new Error("No saved Swiggy address is available");
  if (!label) return addresses[0];
  return addresses.find((address) => address.label?.toLowerCase() === String(label).toLowerCase()) || addresses[0];
}

async function summarizeShortlist(ai, payload) {
  const result = await ai.summarizeRecommendation(payload);
  const top = payload.options[0];
  if (!top) return result;
  if (mentionsTopBeforeAlternatives(result.text, payload.options)) return result;
  return {
    text: deterministicSummary(payload.mode, payload.options),
    trace: {
      ...result.trace,
      status: "overridden",
      note: "AI response did not lead with the top-ranked restaurant, so Moodish used a deterministic summary to avoid contradicting the shortlist.",
      responseText: result.text
    }
  };
}

function mentionsTopBeforeAlternatives(text = "", options = []) {
  const topName = options[0]?.restaurantName?.toLowerCase();
  if (!topName) return true;
  const normalized = text.toLowerCase();
  const topIndex = normalized.indexOf(topName);
  if (topIndex === -1) return false;
  return options.slice(1).every((option) => {
    const index = normalized.indexOf(option.restaurantName.toLowerCase());
    return index === -1 || index > topIndex;
  });
}

function deterministicSummary(mode, options) {
  const top = options[0];
  const runnerUps = options.slice(1, 3).map((option) => option.restaurantName);
  const alternatives = runnerUps.length ? ` Alternatives: ${runnerUps.join(" and ")}.` : "";
  const label = mode === "office" ? "team lunch" : "mood meal";
  return `${top.restaurantName} is the best ${label} fit: ${top.items.map((item) => item.name).join(", ")} for ₹${top.estimatedTotal}.${alternatives}`;
}

async function candidatePool({ swiggy, addressId, matches, minOptions }) {
  if ((matches || []).length >= minOptions) return matches;
  const all = await swiggy.searchRestaurants({ addressId, query: "" });
  const seen = new Set();
  return [...(matches || []), ...all].filter((restaurant) => {
    if (seen.has(restaurant.id)) return false;
    seen.add(restaurant.id);
    return true;
  });
}

function rankRestaurants(restaurants, context) {
  return restaurants
    .filter((restaurant) => restaurant.availabilityStatus === "OPEN")
    .filter((restaurant) => hasCompatibleItem(restaurant.items || [], context.dietaryRules))
    .map((restaurant) => ({ ...restaurant, score: scoreRestaurant(restaurant, context) }))
    .sort((a, b) => b.score - a.score);
}

function scoreRestaurant(restaurant, context) {
  let score = restaurant.rating * 10 - restaurant.distanceKm * 1.5;
  const priceDelta = Math.abs((restaurant.priceBand || context.budget) - context.budget);
  score -= priceDelta / 25;
  const restaurantText = [restaurant.name, restaurant.cuisine, ...restaurant.tags].join(" ").toLowerCase();
  const itemText = restaurant.items?.flatMap((item) => [item.name, ...item.tags]).join(" ").toLowerCase() || "";
  const intentMatches = (context.intentTags || []).filter((tag) => restaurantText.includes(tag));
  const itemMatches = (context.intentTags || []).filter((tag) => itemText.includes(tag));
  const hasExplicitIntent = intentMatches.length > 0 || itemMatches.length > 0;
  score += intentMatches.length * 12;
  score += itemMatches.length * 7;
  for (const rule of context.dietaryRules) {
    if (restaurant.tags.includes(rule)) score += hasExplicitIntent ? 3 : 8;
    if (rule === "veg" && restaurant.tags.includes("non-veg") && !hasExplicitIntent) score -= 12;
  }
  if (context.likedCuisines.includes(restaurant.cuisine)) score += hasExplicitIntent ? 2 : 6;
  if (context.avoidCuisines.includes(restaurant.cuisine) && !intentMatches.length) score -= 10 + context.novelty * 2;
  if (restaurant.tags.includes("novel")) score += context.novelty * 2;
  if (context.headcount > 1 && restaurant.tags.includes("office-friendly")) score += 8;
  return Number(score.toFixed(2));
}

async function optionFromRestaurant(restaurant, swiggy, budget, headcount, context = {}) {
  const menu = await swiggy.getRestaurantMenu({ restaurantId: restaurant.id });
  const compatibleItems = filterCompatibleItems(menu.items, context.dietaryRules);
  const chosen = pickItems(compatibleItems, budget, headcount, context);
  const total = chosen.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return {
    optionId: `${restaurant.id}_${chosen.map((item) => item.itemId).join("_")}`,
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    cuisine: restaurant.cuisine,
    rating: restaurant.rating,
    distanceKm: restaurant.distanceKm,
    score: restaurant.score,
    items: chosen,
    estimatedTotal: total,
    reasons: buildReasons(restaurant, chosen, budget, headcount),
    tradeoffs: total > budget ? ["Slightly above requested budget"] : ["Within requested budget"]
  };
}

function pickItems(items, budget, headcount, context = {}) {
  if (!items.length) {
    const error = new Error("No menu items match the requested dietary rules");
    error.status = 422;
    throw error;
  }
  const sorted = [...items].sort((a, b) => scoreItem(b, context) - scoreItem(a, context) || b.price - a.price);
  const main = sorted.find((item) => item.price <= Math.max(budget, budget / headcount)) || sorted[sorted.length - 1];
  const quantity = Math.max(1, Math.min(headcount, Math.floor(budget / Math.max(main.price, 1))));
  return [{ ...main, quantity }];
}

function hasCompatibleItem(items, dietaryRules = []) {
  return filterCompatibleItems(items, dietaryRules).length > 0;
}

function filterCompatibleItems(items, dietaryRules = []) {
  const rules = new Set(dietaryRules);
  return items.filter((item) => {
    if (rules.has("vegan") && !item.tags.includes("vegan")) return false;
    if (rules.has("veg") && (item.tags.includes("non-veg") || item.tags.includes("egg"))) return false;
    if (rules.has("jain") && !item.tags.includes("jain")) return false;
    if (rules.has("no-onion-garlic") && !item.tags.includes("no-onion-garlic")) return false;
    return true;
  });
}

function scoreItem(item, context) {
  const itemText = [item.name, ...item.tags].join(" ").toLowerCase();
  let score = 0;
  for (const tag of context.intentTags || []) {
    if (itemText.includes(tag)) score += 5;
  }
  for (const rule of context.dietaryRules || []) {
    if (item.tags.includes(rule)) score += 4;
    if (rule === "veg" && item.tags.includes("non-veg")) score -= 20;
    if (rule === "vegan" && !item.tags.includes("vegan")) score -= 12;
  }
  return score;
}

function buildReasons(restaurant, items, budget, headcount) {
  const reasons = [`${restaurant.cuisine} option from ${restaurant.name}`, `${restaurant.rating} rating and ${restaurant.distanceKm}km away`];
  if (restaurant.tags.includes("high-protein")) reasons.push("Matches high-protein preference");
  if (restaurant.tags.includes("office-friendly") && headcount > 1) reasons.push("Good fit for shared office lunch");
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  if (total <= budget) reasons.push("Fits the requested budget");
  return reasons;
}
