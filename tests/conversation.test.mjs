import test from "node:test";
import assert from "node:assert/strict";
import { continueMealConversation, extractState } from "../services/agent/src/conversation.mjs";
import { createTools } from "../services/agent/src/tools.mjs";

test("conversation asks one compact follow-up when diet and budget are missing", async () => {
  const result = await continueMealConversation({ message: "chewy smoky chaap" }, createTools());
  assert.equal(result.status, "needs_input");
  assert.deepEqual(result.missing, ["diet", "budget"]);
  assert.match(result.reply, /food boundary/i);
  assert.deepEqual(result.quickReplies, ["Veg", "Both", "Non-veg", "Vegan", "Jain"]);
});

test("conversation plans immediately when the person gives all hard constraints", async () => {
  const result = await continueMealConversation(
    { message: "spicy Chinese, non-veg, under ₹450 with a cold drink" },
    createTools()
  );
  assert.equal(result.status, "complete");
  assert.equal(result.state.dietMode, "non_veg");
  assert.equal(result.state.maxBudget, 450);
  assert.equal(result.recommendation.options[0].restaurantName, "Wok & Fizz");
  assert.match(result.recommendation.addOns[0].name, /cola/i);
  assert.match(result.recommendation.addOns[0].pairingReason, /Indo-Chinese/i);
});

test("conversation state merges a short constraint answer into the original craving", () => {
  const first = extractState("chewy chaap");
  const second = extractState("both, under 400", first);
  assert.equal(second.mood, "chewy chaap");
  assert.equal(second.dietMode, "both");
  assert.equal(second.maxBudget, 400);
  assert.equal(second.dietExplicit, true);
  assert.equal(second.budgetExplicit, true);
});

test("standalone veg click is accepted and advances to budget choices", async () => {
  const first = await continueMealConversation({ message: "gulab jamun plus ice cream" }, createTools());
  const second = await continueMealConversation({ message: "Veg", state: first.state }, createTools());
  assert.equal(second.status, "needs_input");
  assert.deepEqual(second.missing, ["budget"]);
  assert.deepEqual(second.quickReplies, ["Under ₹250", "Under ₹400", "Under ₹600", "Under ₹1000"]);
});

test("gulab jamun and ice cream craving returns the genuine combo", async () => {
  const result = await continueMealConversation(
    { message: "comfort food like gulab jamun plus ice cream, veg, under ₹300" },
    createTools()
  );
  assert.equal(result.status, "complete");
  assert.equal(result.recommendation.options[0].restaurantName, "Mithai & Melt");
  assert.match(result.recommendation.options[0].items[0].name, /Gulab Jamun.*Ice Cream/i);
  assert.equal(result.recommendation.options[0].matchType, "exact");
});

test("explicit beverage edit keeps the restaurant first and falls back to Instamart", async () => {
  const tools = createTools();
  const first = await continueMealConversation(
    { message: "spicy Chinese, non-veg, under ₹450" },
    tools
  );
  const edited = await continueMealConversation(
    { message: "hmm not bad, add some beverage too", state: first.state },
    tools
  );

  assert.equal(edited.state.addOnIntent, "beverage");
  assert.equal(edited.recommendation.options[0].restaurantName, "Wok & Fizz");
  assert.deepEqual(edited.recommendation.options[0].items.map((item) => item.name), ["Smoky Chicken Hakka Noodles"]);
  assert.match(edited.recommendation.addOns[0].name, /cola/i);
  assert.equal(edited.recommendation.transparency.instamart.restaurantFirstSatisfied, false);
});

test("explicit beverage request uses the selected restaurant before Instamart", async () => {
  const result = await continueMealConversation(
    { message: "dosa and a beverage, veg, under ₹400" },
    createTools()
  );

  assert.equal(result.recommendation.options[0].restaurantName, "Dosa District");
  assert.match(result.recommendation.options[0].items[1].name, /coffee/i);
  assert.equal(result.recommendation.addOns.length, 0);
  assert.equal(result.recommendation.transparency.instamart.restaurantFirstSatisfied, true);
});
