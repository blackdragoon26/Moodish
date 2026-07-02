import test from "node:test";
import assert from "node:assert/strict";
import { createTools } from "../services/agent/src/tools.mjs";

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
