import { clampNumber, makeRecommendationId, normalizeList } from "./contracts.mjs";
import { extractMealIntent, normalizeDietMode, normalizeDiscoveryMode } from "./intent.mjs";
import { expandIntentTokens } from "./swiggy-gateway.mjs";

export async function planPersonalMeal({ request, tasteProfile, swiggy, ai }) {
  const budget = clampNumber(request.maxBudget ?? request.budget, 120, 1000, tasteProfile.budgetComfort || 350);
  const discoveryMode = normalizeDiscoveryMode(request);
  const dietMode = normalizeDietMode(request.dietMode);
  const dietaryRules = resolveRequestRules(request, tasteProfile);
  const allergies = normalizeRules(request.allergies);
  validateDietConstraints(dietMode, dietaryRules);
  const mood = request.mood || "curious";
  const addresses = await swiggy.getAddresses();
  const address = pickAddress(addresses, request.addressLabel, request.addressId);
  const intent = extractMealIntent([mood, request.query].filter(Boolean).join(" "));
  const discovery = await discoverPersonalCandidates({ swiggy, addressId: address.id, intent, dietMode });
  const intentTags = expandIntentTokens(intent.tokens.join(" "));
  const candidates = await hydrateCandidateMenus(discovery.restaurants, swiggy, address.id);
  const ranked = rankRestaurants(candidates, {
    budget,
    discoveryMode,
    dietMode,
    dietaryRules,
    allergies,
    intentTags,
    avoidCuisines: tasteProfile.weeklyCuisineHistory || [],
    likedCuisines: tasteProfile.likedCuisines || [],
    headcount: 1,
    matchTypes: discovery.matchTypes
  }).slice(0, 3);
  const options = await Promise.all(
    ranked.map((restaurant) =>
      optionFromRestaurant(restaurant, swiggy, budget, 1, {
        addressId: address.id,
        intentTags,
        dietaryRules,
        allergies,
        dietMode,
        matchType: discovery.matchTypes.get(restaurant.id) || "broad"
      })
    )
  );
  const addOns = request.includeInstamartAddOns
    ? await complementaryProducts(swiggy, address.id, intent, Math.max(0, budget - (options[0]?.estimatedTotal || 0)))
    : [];
  const matchNotice =
    intent.hasExplicitDish && !discovery.exactMatch
      ? `No exact ${intent.primaryDish} match was available; these are clearly labelled similar alternatives.`
      : "";
  const aiSummary = await summarizeShortlist(ai, { mode: "solo", options, matchNotice });
  const run = {
    recommendationId: makeRecommendationId("solo"),
    mode: "solo",
    address,
    request: {
      ...request,
      maxBudget: budget,
      budget,
      dietMode,
      discoveryMode,
      dietaryRules,
      allergies,
      noveltyDeprecated: request.novelty !== undefined
    },
    options,
    addOns,
    summary: matchNotice ? `${matchNotice} ${aiSummary.text}` : aiSummary.text,
    transparency: {
      dataSource: swiggy.mode,
      moodInput: mood,
      intentTags,
      structuredIntent: intent,
      exactMatch: discovery.exactMatch,
      fallbackQueries: discovery.fallbackQueries,
      searchedRestaurants: discovery.searchedRestaurants,
      candidateRestaurants: candidates.map((restaurant) => restaurant.name),
      ranking: ranked.map((restaurant) => ({
        restaurantName: restaurant.name,
        cuisine: restaurant.cuisine,
        score: restaurant.score,
        matchType: discovery.matchTypes.get(restaurant.id) || "broad",
        adjustments: restaurant.adjustments
      })),
      instamart: {
        requested: Boolean(request.includeInstamartAddOns),
        dataSource: swiggy.mode,
        count: addOns.length,
        separateFulfilment: true
      },
      ai: aiSummary.trace
    },
    demo: swiggy.mode === "fixture" ? demoDisclosure() : undefined,
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
  const dietaryRules = request.dietaryRules !== undefined ? normalizeRules(request.dietaryRules) : normalizeRules(teamProfile.dietaryRules);
  const dietMode = normalizeDietMode(request.dietMode || (dietaryRules.includes("veg") ? "veg" : "both"));
  const avoidCuisines = mergeRules(teamProfile.cuisineAvoidList, request.cuisineAvoidList);
  const addresses = await swiggy.getAddresses();
  const address = pickAddress(addresses, request.addressLabel);
  const restaurants = await swiggy.searchRestaurants({ addressId: address.id, query: request.query || "office lunch" });
  const intentTags = expandIntentTokens([request.query, "office lunch"].filter(Boolean).join(" "));
  const candidates = await hydrateCandidateMenus(
    await candidatePool({ swiggy, addressId: address.id, matches: restaurants, minOptions: 6 }),
    swiggy,
    address.id
  );
  const ranked = rankRestaurants(candidates, {
    budget: budgetPerPerson,
    discoveryMode: "balanced",
    dietMode,
    dietaryRules,
    allergies: normalizeRules(request.allergies),
    intentTags,
    avoidCuisines,
    likedCuisines: [],
    headcount,
    requiresVegOption: Number(request.vegCount || 0) > 0,
    requiresNonVegOption: Number(request.nonVegCount || 0) > 0,
    matchTypes: new Map()
  }).slice(0, 3);
  const options = await Promise.all(
    ranked.map((restaurant) =>
      optionFromRestaurant(restaurant, swiggy, totalBudget, headcount, {
        addressId: address.id,
        intentTags,
        dietaryRules,
        dietMode,
        vegCount: Number(request.vegCount || 0),
        nonVegCount: Number(request.nonVegCount || 0),
        bothCount: Number(request.bothCount || 0),
        requiresVegOption: Number(request.vegCount || 0) > 0,
        requiresNonVegOption: Number(request.nonVegCount || 0) > 0
      })
    )
  );
  const officeIntent = extractMealIntent(request.query || "office lunch");
  const addOns = await complementaryProducts(swiggy, address.id, officeIntent, totalBudget);
  const aiSummary = await summarizeShortlist(ai, { mode: "office", options });
  const run = {
    recommendationId: makeRecommendationId("office"),
    mode: "office",
    address,
    request: { ...request, headcount, budgetPerPerson, totalBudget, dietaryRules, dietMode, avoidCuisines },
    options: options.map((option) => ({ ...option, addOns: addOns.slice(0, 2) })),
    summary: aiSummary.text,
    transparency: {
      dataSource: swiggy.mode,
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
    demo: swiggy.mode === "fixture" ? demoDisclosure() : undefined,
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

function pickAddress(addresses, label, addressId) {
  if (!addresses?.length) throw new Error("No saved Swiggy address is available");
  if (addressId) return addresses.find((address) => address.id === addressId) || addresses[0];
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
  if (topIndex > 20) return false;
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

async function candidatePool({ swiggy, addressId, matches, minOptions, allowBroadFallback = true }) {
  if ((matches || []).length >= minOptions) return matches;
  if (!allowBroadFallback) return matches || [];
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
    .filter((restaurant) => hasCompatibleItem(restaurant.items || [], context))
    .filter((restaurant) => hasDietCoverage(restaurant.items || [], context))
    .map((restaurant) => {
      const result = scoreRestaurant(restaurant, context);
      return { ...restaurant, score: result.score, adjustments: result.adjustments };
    })
    .sort((a, b) => b.score - a.score);
}

function scoreRestaurant(restaurant, context) {
  const adjustments = [];
  let score = restaurant.rating * 10 - restaurant.distanceKm * 1.5;
  adjustments.push({ reason: "rating-and-distance", value: Number(score.toFixed(2)) });
  const matchType = context.matchTypes?.get(restaurant.id);
  if (matchType === "exact") {
    score += 100;
    adjustments.push({ reason: "exact-dish-match", value: 100 });
  } else if (matchType === "alternative") {
    score += 45;
    adjustments.push({ reason: "similar-dish-alternative", value: 45 });
  }
  const restaurantText = [restaurant.name, restaurant.cuisine, ...restaurant.tags].join(" ").toLowerCase();
  const itemText = restaurant.items?.flatMap((item) => [item.name, ...item.tags]).join(" ").toLowerCase() || "";
  const intentMatches = (context.intentTags || []).filter((tag) => restaurantText.includes(tag));
  const itemMatches = (context.intentTags || []).filter((tag) => itemText.includes(tag));
  const hasExplicitIntent = intentMatches.length > 0 || itemMatches.length > 0;
  score += intentMatches.length * 12;
  score += itemMatches.length * 7;
  if (intentMatches.length || itemMatches.length) {
    adjustments.push({ reason: "craving-relevance", value: intentMatches.length * 12 + itemMatches.length * 7 });
  }
  for (const rule of context.dietaryRules) {
    if (restaurant.tags.includes(rule)) score += hasExplicitIntent ? 2 : 4;
    if (rule === "veg" && restaurant.tags.includes("non-veg") && !hasExplicitIntent) score -= 12;
  }
  const discoveryAdjustment = scoreDiscoveryPreference(restaurant, context);
  score += discoveryAdjustment;
  if (discoveryAdjustment) adjustments.push({ reason: `discovery-${context.discoveryMode}`, value: discoveryAdjustment });
  if (context.headcount > 1 && restaurant.tags.includes("office-friendly")) score += 8;
  return { score: Number(score.toFixed(2)), adjustments };
}

async function optionFromRestaurant(restaurant, swiggy, budget, headcount, context = {}) {
  const menu = await swiggy.getRestaurantMenu({ restaurantId: restaurant.id, addressId: context.addressId });
  const compatibleItems = filterCompatibleItems(menu.items, context).filter(
    (item) => item.price <= Math.max(budget, budget / Math.max(headcount, 1))
  );
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
    matchType: context.matchType || "broad",
    dataSource: swiggy.mode,
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
  const perPersonBudget = headcount > 1 ? budget / headcount : budget;
  if (headcount > 1 && context.requiresVegOption && context.requiresNonVegOption) {
    const vegItems = sorted.filter((item) => !item.tags.includes("non-veg") && !item.tags.includes("egg"));
    const nonVegItems = sorted.filter((item) => item.tags.includes("non-veg"));
    const vegMain = vegItems.find((item) => item.price <= perPersonBudget);
    const nonVegMain = nonVegItems.find((item) => item.price <= perPersonBudget);
    if (vegMain && nonVegMain) {
      const vegQuantity = Math.max(1, Math.min(headcount - 1, Number(context.vegCount || 1)));
      const nonVegQuantity = headcount - vegQuantity;
      return [
        { ...vegMain, quantity: vegQuantity },
        { ...nonVegMain, quantity: nonVegQuantity }
      ];
    }
  }
  const main = sorted.find((item) => item.price <= perPersonBudget) || [...sorted].sort((a, b) => a.price - b.price)[0];
  const quantity = Math.max(1, headcount);
  const remaining = perPersonBudget - main.price;
  const side = sorted.find(
    (item) =>
      item.itemId !== main.itemId &&
      item.price <= remaining &&
      item.tags.some((tag) => ["side", "beverage", "bread", "fries", "dessert"].includes(tag))
  );
  return [{ ...main, quantity }, ...(side ? [{ ...side, quantity }] : [])];
}

function hasDietCoverage(items, context = {}) {
  if (!context.requiresVegOption && !context.requiresNonVegOption) return true;
  const compatible = filterCompatibleItems(items, context);
  const hasVeg = compatible.some((item) => !item.tags.includes("non-veg") && !item.tags.includes("egg"));
  const hasNonVeg = compatible.some((item) => item.tags.includes("non-veg"));
  if (context.requiresVegOption && !hasVeg) return false;
  if (context.requiresNonVegOption && !hasNonVeg) return false;
  return true;
}

function hasCompatibleItem(items, context = {}) {
  return filterCompatibleItems(items, context).some(
    (item) => item.price <= Math.max(context.budget, context.budget / Math.max(context.headcount || 1, 1))
  );
}

function filterCompatibleItems(items, context = {}) {
  const rules = new Set(context.dietaryRules || []);
  const allergies = new Set(context.allergies || []);
  return items.filter((item) => {
    const itemText = [item.name, ...(item.tags || [])].join(" ").toLowerCase();
    if ([...allergies].some((allergy) => itemText.includes(allergy.toLowerCase()))) return false;
    if (context.dietMode === "veg" && (item.tags.includes("non-veg") || item.tags.includes("egg"))) return false;
    if (context.dietMode === "non_veg" && !item.tags.includes("non-veg")) return false;
    if (rules.has("vegan") && !item.tags.includes("vegan")) return false;
    if (rules.has("veg") && (item.tags.includes("non-veg") || item.tags.includes("egg"))) return false;
    if (rules.has("jain") && !item.tags.includes("jain")) return false;
    if (rules.has("no-onion-garlic") && !item.tags.includes("no-onion-garlic")) return false;
    if (rules.has("high-protein") && !item.tags.includes("high-protein")) return false;
    if (rules.has("low-carb") && !item.tags.includes("low-carb")) return false;
    return true;
  });
}

async function discoverPersonalCandidates({ swiggy, addressId, intent, dietMode }) {
  const vegFilter = dietMode === "veg" ? 1 : 0;
  const matchTypes = new Map();
  const fallbackQueries = [];
  const exactItems = await swiggy.searchMenu({ addressId, query: intent.exactQuery, vegFilter });
  const literalMatches = intent.primaryDish ? (exactItems || []).filter((entry) => itemMatchesDish(entry, intent.primaryDish)) : [];
  let exactMatch = literalMatches.length > 0;
  let items = exactMatch ? literalMatches : exactItems || [];
  for (const entry of items) matchTypes.set(entry.restaurant.id, exactMatch ? "exact" : "broad");

  if (intent.hasExplicitDish && !exactMatch) {
    items = [];
    for (const query of intent.alternativeQueries) {
      fallbackQueries.push(query);
      const alternatives = await swiggy.searchMenu({ addressId, query, vegFilter });
      for (const entry of alternatives || []) {
        items.push(entry);
        if (!matchTypes.has(entry.restaurant.id)) matchTypes.set(entry.restaurant.id, "alternative");
      }
      if (uniqueRestaurants(items).length >= 3) break;
    }
  }

  let restaurants = uniqueRestaurants(items);
  let searchedRestaurants = restaurants.map((restaurant) => restaurant.name);
  if (!intent.hasExplicitDish) {
    const matches = await swiggy.searchRestaurants({ addressId, query: intent.raw || intent.exactQuery });
    searchedRestaurants = matches.map((restaurant) => restaurant.name);
    restaurants = await candidatePool({ swiggy, addressId, matches, minOptions: 6, allowBroadFallback: true });
  }
  return { restaurants, searchedRestaurants, matchTypes, exactMatch, fallbackQueries };
}

function uniqueRestaurants(items = []) {
  const seen = new Set();
  return items
    .map((entry) => entry.restaurant)
    .filter((restaurant) => {
      if (!restaurant || seen.has(restaurant.id)) return false;
      seen.add(restaurant.id);
      return true;
    });
}

function itemMatchesDish(entry, dish) {
  if (!dish) return false;
  return [entry.name, ...(entry.tags || [])].join(" ").toLowerCase().includes(dish.toLowerCase());
}

function resolveRequestRules(request, tasteProfile) {
  if (Object.prototype.hasOwnProperty.call(request, "dietaryRules")) return normalizeRules(request.dietaryRules);
  return normalizeRules(tasteProfile.dietaryRules);
}

function normalizeRules(value) {
  return normalizeList(value).filter((rule) => rule.toLowerCase() !== "none");
}

function validateDietConstraints(dietMode, dietaryRules) {
  if (dietMode === "non_veg" && (dietaryRules.includes("vegan") || dietaryRules.includes("veg"))) {
    const error = new Error("Non-veg mode conflicts with veg or vegan dietary rules");
    error.status = 422;
    throw error;
  }
}

function scoreDiscoveryPreference(restaurant, context) {
  const liked = context.likedCuisines.includes(restaurant.cuisine);
  const recent = context.avoidCuisines.includes(restaurant.cuisine);
  if (context.discoveryMode === "comfort") return liked || recent || restaurant.tags.includes("familiar") ? 4 : 0;
  if (context.discoveryMode === "explore") {
    if (recent) return -4;
    if (restaurant.tags.includes("novel") || !liked) return 4;
  }
  return liked ? 1 : 0;
}

async function complementaryProducts(swiggy, addressId, intent, remainingBudget) {
  if (remainingBudget < 50) return [];
  const query = pairingQuery(intent);
  const products = await swiggy.searchProducts({ addressId, query });
  return (products || [])
    .filter((product) => product.price <= remainingBudget)
    .slice(0, 3)
    .map((product) => ({
      ...product,
      pairingReason: pairingReason(query),
      dataSource: swiggy.mode,
      separateFulfilment: true
    }));
}

function pairingQuery(intent) {
  const tokens = new Set([intent.primaryDish, ...intent.tokens, ...intent.attributes].filter(Boolean));
  const cuisine = intent.cuisines.join(" ").toLowerCase();
  if ([...tokens].some((token) => ["chinese", "chowmein", "noodles", "momos"].includes(token)) || cuisine.includes("chinese")) {
    return "cold-drink";
  }
  if (tokens.has("biryani")) return "raita";
  if ([...tokens].some((token) => ["pizza", "burger"].includes(token))) return "cola";
  if (tokens.has("chaap") || tokens.has("tandoori")) return "mint";
  if ([...tokens].some((token) => ["pasta"].includes(token)) || cuisine.includes("italian")) return "italian";
  if ([...tokens].some((token) => ["fish", "tacos"].includes(token))) return "cooling";
  if (intent.attributes.includes("spicy")) return "cooling";
  if (intent.attributes.includes("healthy") || intent.attributes.includes("light")) return "fruit";
  return "beverage";
}

function pairingReason(query) {
  const reasons = {
    "cold-drink": "A chilled drink balances a salty, spicy Indo-Chinese meal",
    raita: "Cooling curd rounds out a rich biryani",
    cola: "A crisp cola is a familiar match for pizza or burgers",
    mint: "Mint and lemon cut through smoky tandoori flavours",
    italian: "Sparkling water keeps a creamy Italian meal fresh",
    cooling: "A cooling drink softens the heat",
    fruit: "Fresh fruit keeps a lighter meal complete",
    beverage: "An easy drink to complete the meal"
  };
  return reasons[query] || reasons.beverage;
}

function demoDisclosure() {
  return {
    active: true,
    label: "Demo data",
    note: "Restaurant, menu, address, Instamart, and cart information is simulated in fixture mode."
  };
}

async function hydrateCandidateMenus(restaurants, swiggy, addressId) {
  return Promise.all(
    (restaurants || []).slice(0, 12).map(async (restaurant) => {
      if (restaurant.items?.length) return restaurant;
      const menu = await swiggy.getRestaurantMenu({ restaurantId: restaurant.id, addressId });
      return { ...restaurant, items: menu.items || [] };
    })
  );
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
