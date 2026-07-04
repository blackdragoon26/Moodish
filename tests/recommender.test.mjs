import test from "node:test";
import assert from "node:assert/strict";
import { createTools } from "../services/agent/src/tools.mjs";
import { getTasteProfile } from "../services/agent/src/memory.mjs";
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
  assert.ok(runs.every((run) => run.options.length >= 3));
});

test("personal planner does not let AI summary contradict top ranked option", async () => {
  const run = await planPersonalMeal({
    request: { budget: 500, mood: "office pizza party", dietaryRules: "", novelty: 4 },
    tasteProfile: getTasteProfile(),
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
