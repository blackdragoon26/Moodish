import test from "node:test";
import assert from "node:assert/strict";
import { createTools } from "../services/agent/src/tools.mjs";
import { getMealHistory, getTasteProfile } from "../services/agent/src/memory.mjs";
import { planPersonalMeal } from "../services/agent/src/recommender.mjs";
import { createSwiggyGateway } from "../services/agent/src/swiggy-gateway.mjs";

test("personal planner returns ranked budget-aware options", async () => {
  const tools = createTools();
  const run = await tools.plan_personal_meal({
    budget: 350,
    mood: "curious",
    dietaryRules: "high-protein",
    novelty: 4
  });

  assert.equal(run.mode, "solo");
  assert.ok(run.recommendationId.startsWith("solo_"));
  assert.ok(run.options.length >= 2);
  assert.ok(run.options[0].estimatedTotal <= 400);
  assert.equal(run.safety.requiresCartConfirmation, true);
});

test("personal planner changes shortlist for distinct moods", async () => {
  const tools = createTools();
  const scenarios = [
    {
      request: { budget: 500, mood: "rainy spicy biryani craving", dietaryRules: "", novelty: 4 },
      expectedTop: "Nizam Rain Biryani"
    },
    {
      request: { budget: 450, mood: "light vegan healthy salad", dietaryRules: "vegan", novelty: 3 },
      expectedTop: "Green Fork Deli"
    },
    {
      request: { budget: 350, mood: "sweet dessert chocolate", dietaryRules: "", novelty: 5 },
      expectedTop: "Cocoa Afterhours"
    },
    {
      request: { budget: 450, mood: "high protein post workout chicken", dietaryRules: "high-protein", novelty: 2 },
      expectedTop: "Post Gym Grill"
    },
    {
      request: { budget: 500, mood: "office pizza party", dietaryRules: "", novelty: 4 },
      expectedTop: "Slice Room"
    }
  ];

  const runs = await Promise.all(scenarios.map((scenario) => tools.plan_personal_meal(scenario.request)));
  assert.deepEqual(
    runs.map((run) => run.options[0].restaurantName),
    scenarios.map((scenario) => scenario.expectedTop)
  );
  assert.ok(new Set(runs.map((run) => run.options.map((option) => option.restaurantName).join("|"))).size > 1);
  assert.ok(runs.every((run) => run.options.length >= 1));
});

test("personal planner does not let AI summary contradict top ranked option", async () => {
  const run = await planPersonalMeal({
    request: { budget: 500, mood: "office pizza party", dietaryRules: "", novelty: 4 },
    tasteProfile: await getTasteProfile(),
    swiggy: createSwiggyGateway(),
    ai: {
      summarizeRecommendation: async () => ({
        text: "Millet Monk is the best pick today.",
        trace: { provider: "test", status: "ok", request: {}, responseText: "Millet Monk is the best pick today." }
      })
    }
  });

  assert.equal(run.options[0].restaurantName, "Slice Room");
  assert.match(run.summary, /Slice Room/);
});

test("personal planner overrides AI summary when it mentions a runner-up first", async () => {
  const run = await planPersonalMeal({
    request: { budget: 500, mood: "office pizza party", dietaryRules: "", novelty: 4 },
    tasteProfile: await getTasteProfile(),
    swiggy: createSwiggyGateway(),
    ai: {
      summarizeRecommendation: async () => ({
        text: "Start with Millet Monk, then try Slice Room for pizza.",
        trace: { provider: "test", status: "ok", request: {}, responseText: "Start with Millet Monk, then try Slice Room for pizza." }
      })
    }
  });

  assert.equal(run.options[0].restaurantName, "Slice Room");
  assert.match(run.summary, /^Slice Room/);
  assert.equal(run.transparency.ai.status, "overridden");
});

test("chaap craving prioritizes an exact chaap dish over generic Punjabi branding", async () => {
  const tools = createTools();
  const run = await tools.plan_personal_meal({
    mood: "something very much like chaap chewy tasty",
    maxBudget: 1000,
    dietMode: "both",
    dietaryRules: "none",
    discoveryMode: "explore"
  });

  assert.equal(run.options[0].restaurantName, "Delhi Chaap Junction");
  assert.match(run.options[0].items[0].name, /chaap/i);
  assert.equal(run.options[0].matchType, "exact");
  assert.equal(run.transparency.exactMatch, true);
  assert.deepEqual(run.request.dietaryRules, []);
});

test("maximum budget is a ceiling instead of an expensive-target preference", async () => {
  const tools = createTools();
  const run = await tools.plan_personal_meal({
    mood: "chaap",
    maxBudget: 250,
    dietMode: "veg",
    discoveryMode: "balanced"
  });

  assert.ok(run.options.every((option) => option.estimatedTotal <= 250));
});

test("diet mode is enforced as a hard item constraint", async () => {
  const tools = createTools();
  const veg = await tools.plan_personal_meal({ mood: "chaap", maxBudget: 500, dietMode: "veg" });
  const nonVeg = await tools.plan_personal_meal({ mood: "chicken", maxBudget: 500, dietMode: "non_veg" });

  assert.ok(veg.options.every((option) => option.items.every((item) => !item.tags.includes("non-veg"))));
  assert.ok(nonVeg.options.every((option) => option.items.every((item) => item.tags.includes("non-veg"))));
});

test("fixture recommendations carry an unavoidable demo disclosure", async () => {
  const tools = createTools();
  const run = await tools.plan_personal_meal({ mood: "chaap", maxBudget: 500 });
  assert.equal(run.demo.active, true);
  assert.equal(run.transparency.dataSource, "fixture");
  assert.ok(run.options.every((option) => option.dataSource === "fixture"));
});

test("personal planner treats vegan as a hard menu constraint", async () => {
  const tools = createTools();
  const run = await tools.plan_personal_meal({
    budget: 300,
    mood: "light vegan healthy salad",
    dietaryRules: "vegan",
    novelty: 3
  });

  assert.ok(run.options.length > 0);
  assert.ok(run.options.every((option) => option.items.every((item) => item.tags.includes("vegan"))));
});

test("office planner handles team constraints and Instamart add-ons", async () => {
  const tools = createTools();
  const run = await tools.plan_office_lunch({
    headcount: 6,
    budgetPerPerson: 250,
    dietaryRules: "veg, high-protein",
    cuisineAvoidList: "North Indian"
  });

  assert.equal(run.mode, "office");
  assert.equal(run.request.totalBudget, 1500);
  assert.ok(run.options[0].addOns.length > 0);
  assert.ok(run.options.every((option) => option.items.every((item) => item.quantity === 6)));
  assert.ok(run.options.every((option) => option.estimatedTotal <= 1500));
  assert.equal(run.safety.groupPaymentSupported, false);
});

test("cart build is blocked without explicit confirmation", async () => {
  const tools = createTools();
  const run = await tools.plan_personal_meal({ budget: 350 });

  await assert.rejects(
    () => tools.build_confirmed_cart({ recommendationId: run.recommendationId, confirmed: false }),
    /Explicit confirmation/
  );
});

test("confirmed cart carries safety metadata and disables checkout", async () => {
  const tools = createTools();
  const run = await tools.plan_personal_meal({ budget: 350 });
  const cart = await tools.build_confirmed_cart({
    recommendationId: run.recommendationId,
    optionId: run.options[0].optionId,
    confirmed: true
  });

  assert.equal(cart.explicitConfirmationCaptured, true);
  assert.equal(cart.checkoutBlocked, true);
  assert.ok(cart.total > 0);
});

test("selected Instamart pairings are carried into a separate cart preview", async () => {
  const tools = createTools();
  const userIdHash = "instamart-memory-user";
  const run = await tools.plan_personal_meal({
    userIdHash,
    mood: "spicy Chinese noodles with a cold drink",
    maxBudget: 500,
    dietMode: "both",
    includeInstamartAddOns: true
  });
  const selectedAddOn = run.addOns[0];

  assert.ok(selectedAddOn);

  const cart = await tools.build_confirmed_cart({
    userIdHash,
    recommendationId: run.recommendationId,
    optionId: run.options[0].optionId,
    addOnProductIds: [selectedAddOn.productId, "not-a-real-product"],
    confirmed: true
  });

  assert.equal(cart.foodCart.fulfilment, "Swiggy Food");
  assert.ok(cart.foodCart.total > 0);
  assert.deepEqual(cart.instamartCartPreview.items.map((item) => item.productId), [selectedAddOn.productId]);
  assert.equal(cart.instamartCartPreview.total, selectedAddOn.price);
  assert.equal(cart.instamartCartPreview.separateFulfilment, true);
  assert.equal(cart.instamartCartPreview.mutationApplied, false);
  assert.equal(cart.checkoutBlocked, true);
  const history = await getMealHistory(userIdHash);
  assert.equal(history[0].addOns[0].name, selectedAddOn.name);
  assert.equal(history[0].instamartTotal, selectedAddOn.price);
});

test("confirmed personal carts become user-scoped meal context", async () => {
  const tools = createTools();
  const userIdHash = "memory-test-user";
  const run = await tools.plan_personal_meal({
    userIdHash,
    mood: "rainy spicy biryani",
    maxBudget: 500,
    dietMode: "both"
  });
  const cart = await tools.build_confirmed_cart({
    userIdHash,
    recommendationId: run.recommendationId,
    optionId: run.options[0].optionId,
    confirmed: true
  });
  const history = await getMealHistory(userIdHash);
  const profile = await getTasteProfile(userIdHash);

  assert.equal(history[0].recommendationId, run.recommendationId);
  assert.equal(history[0].restaurantName, run.options[0].restaurantName);
  assert.equal(cart.mealMemoryEntry.userIdHash, userIdHash);
  assert.equal(profile.recentMeals[0].recommendationId, run.recommendationId);
  assert.equal(profile.weeklyCuisineHistory[0], run.options[0].cuisine);

  await tools.build_confirmed_cart({
    userIdHash,
    recommendationId: run.recommendationId,
    optionId: run.options[0].optionId,
    confirmed: true
  });
  assert.equal((await getMealHistory(userIdHash)).length, 1);
});
