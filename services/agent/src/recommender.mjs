import { clampNumber, makeRecommendationId, normalizeList } from "./contracts.mjs";

export async function planPersonalMeal({ request, tasteProfile, swiggy, ai }) {
  const budget = clampNumber(request.budget, 120, 1000, tasteProfile.budgetComfort || 350);
  const novelty = clampNumber(request.novelty, 1, 5, tasteProfile.noveltyPreference || 3);
  const dietaryRules = mergeRules(tasteProfile.dietaryRules, request.dietaryRules);
  const mood = request.mood || "curious";
  const addresses = await swiggy.getAddresses();
  const address = pickAddress(addresses, request.addressLabel);
  const restaurants = await swiggy.searchRestaurants({ addressId: address.id, query: request.query || mood });
  const candidates = restaurants.length ? restaurants : await swiggy.searchRestaurants({ addressId: address.id, query: "" });
  const ranked = rankRestaurants(candidates, {
    budget,
    novelty,
    dietaryRules,
    avoidCuisines: tasteProfile.weeklyCuisineHistory || [],
    likedCuisines: tasteProfile.likedCuisines || [],
    headcount: 1
  }).slice(0, 3);
  const options = await Promise.all(ranked.map((restaurant) => optionFromRestaurant(restaurant, swiggy, budget, 1)));
  const run = {
    recommendationId: makeRecommendationId("solo"),
    mode: "solo",
    address,
    request: { ...request, budget, novelty, dietaryRules },
    options,
    summary: await ai.summarizeRecommendation({ mode: "solo", options }),
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
  const candidates = restaurants.length ? restaurants : await swiggy.searchRestaurants({ addressId: address.id, query: "" });
  const ranked = rankRestaurants(candidates, {
    budget: budgetPerPerson,
    novelty: 3,
    dietaryRules,
    avoidCuisines,
    likedCuisines: [],
    headcount
  }).slice(0, 3);
  const options = await Promise.all(ranked.map((restaurant) => optionFromRestaurant(restaurant, swiggy, totalBudget, headcount)));
  const addOns = await swiggy.searchProducts({ query: "office-friendly" });
  const run = {
    recommendationId: makeRecommendationId("office"),
    mode: "office",
    address,
    request: { ...request, headcount, budgetPerPerson, totalBudget, dietaryRules, avoidCuisines },
    options: options.map((option) => ({ ...option, addOns: addOns.slice(0, 2) })),
    summary: await ai.summarizeRecommendation({ mode: "office", options }),
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

function rankRestaurants(restaurants, context) {
  return restaurants
    .filter((restaurant) => restaurant.availabilityStatus === "OPEN")
    .map((restaurant) => ({ ...restaurant, score: scoreRestaurant(restaurant, context) }))
    .sort((a, b) => b.score - a.score);
}

function scoreRestaurant(restaurant, context) {
  let score = restaurant.rating * 10 - restaurant.distanceKm * 1.5;
  const priceDelta = Math.abs((restaurant.priceBand || context.budget) - context.budget);
  score -= priceDelta / 25;
  for (const rule of context.dietaryRules) {
    if (restaurant.tags.includes(rule)) score += 8;
    if (rule === "veg" && restaurant.tags.includes("non-veg")) score -= 12;
  }
  if (context.likedCuisines.includes(restaurant.cuisine)) score += 6;
  if (context.avoidCuisines.includes(restaurant.cuisine)) score -= 10 + context.novelty * 2;
  if (restaurant.tags.includes("novel")) score += context.novelty * 2;
  if (context.headcount > 1 && restaurant.tags.includes("office-friendly")) score += 8;
  return Number(score.toFixed(2));
}

async function optionFromRestaurant(restaurant, swiggy, budget, headcount) {
  const menu = await swiggy.getRestaurantMenu({ restaurantId: restaurant.id });
  const chosen = pickItems(menu.items, budget, headcount);
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

function pickItems(items, budget, headcount) {
  const sorted = [...items].sort((a, b) => b.price - a.price);
  const main = sorted.find((item) => item.price <= Math.max(budget, budget / headcount)) || sorted[sorted.length - 1];
  const quantity = Math.max(1, Math.min(headcount, Math.floor(budget / Math.max(main.price, 1))));
  return [{ ...main, quantity }];
}

function buildReasons(restaurant, items, budget, headcount) {
  const reasons = [`${restaurant.cuisine} option from ${restaurant.name}`, `${restaurant.rating} rating and ${restaurant.distanceKm}km away`];
  if (restaurant.tags.includes("high-protein")) reasons.push("Matches high-protein preference");
  if (restaurant.tags.includes("office-friendly") && headcount > 1) reasons.push("Good fit for shared office lunch");
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  if (total <= budget) reasons.push("Fits the requested budget");
  return reasons;
}
