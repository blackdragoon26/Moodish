import test from "node:test";
import assert from "node:assert/strict";
import { createTools } from "../services/agent/src/tools.mjs";

test("group session keeps private submissions out of public participant view", async () => {
  const tools = createTools();
  const created = await tools.create_group_meal_session({
    creatorId: "manager-1",
    platform: "slack",
    workspaceId: "workspace-1",
    channelId: "channel-1",
    headcount: 3
  });
  const publicView = await tools.submit_group_preferences({
    sessionId: created.sessionId,
    invitePasscode: created.invitePasscode,
    participantId: "person-1",
    dietMode: "veg",
    dietaryRules: "jain",
    allergies: "peanut",
    mood: "chaap"
  });

  assert.equal(publicView.responseCount, 1);
  assert.equal(publicView.aggregate.vegCount, 1);
  assert.equal("submissions" in publicView, false);
  assert.equal(JSON.stringify(publicView).includes("peanut"), false);
});

test("automatic group ranking still requires creator cart confirmation", async () => {
  const tools = createTools();
  const created = await tools.create_group_meal_session({
    creatorId: "creator-auto",
    headcount: 2,
    approvalMode: "automatic",
    vibe: "pizza sharing"
  });
  await tools.submit_group_preferences({
    sessionId: created.sessionId,
    invitePasscode: created.invitePasscode,
    participantId: "p1",
    dietMode: "veg",
    mood: "pizza"
  });
  const ranked = await tools.rank_group_meal({ sessionId: created.sessionId, actorId: "creator-auto" });

  assert.equal(ranked.state, "awaiting_creator_confirmation");
  await assert.rejects(
    () =>
      tools.confirm_group_cart({
        sessionId: created.sessionId,
        actorId: "someone-else",
        confirmed: true
      }),
    /Only the session creator/
  );
  const confirmed = await tools.confirm_group_cart({
    sessionId: created.sessionId,
    actorId: "creator-auto",
    confirmed: true
  });
  assert.equal(confirmed.state, "cart_built");
  assert.equal(confirmed.cart.checkoutBlocked, true);
});

test("mixed-diet group plan reserves both veg and non-veg portions", async () => {
  const tools = createTools();
  const session = await tools.create_group_meal_session({
    creatorId: "mixed-manager",
    headcount: 4,
    budgetPerPerson: 400,
    vibe: "spicy Chinese"
  });
  await tools.submit_group_preferences({
    sessionId: session.sessionId,
    invitePasscode: session.invitePasscode,
    participantId: "veg-person",
    dietMode: "veg",
    mood: "noodles"
  });
  await tools.submit_group_preferences({
    sessionId: session.sessionId,
    invitePasscode: session.invitePasscode,
    participantId: "nonveg-person",
    dietMode: "non_veg",
    mood: "chicken"
  });
  const ranked = await tools.rank_group_meal({ sessionId: session.sessionId, actorId: "mixed-manager" });
  const tags = ranked.recommendation.options[0].items.map((item) => item.tags);
  assert.ok(tags.some((itemTags) => itemTags.includes("non-veg")));
  assert.ok(tags.some((itemTags) => !itemTags.includes("non-veg") && !itemTags.includes("egg")));
  assert.equal(ranked.recommendation.options[0].items.reduce((sum, item) => sum + item.quantity, 0), 4);
});

test("team voting supports one vote per participant and manager selection", async () => {
  const tools = createTools();
  const created = await tools.create_group_meal_session({
    creatorId: "creator-vote",
    headcount: 2,
    approvalMode: "team_vote"
  });
  await tools.submit_group_preferences({
    sessionId: created.sessionId,
    invitePasscode: created.invitePasscode,
    participantId: "p1",
    mood: "office lunch"
  });
  const ranked = await tools.rank_group_meal({ sessionId: created.sessionId, actorId: "creator-vote" });
  const optionId = ranked.recommendation.options[0].optionId;
  await tools.vote_group_option({
    sessionId: created.sessionId,
    invitePasscode: created.invitePasscode,
    participantId: "p1",
    optionId
  });
  await tools.vote_group_option({
    sessionId: created.sessionId,
    invitePasscode: created.invitePasscode,
    participantId: "p1",
    optionId
  });
  const selected = await tools.select_group_option({ sessionId: created.sessionId, actorId: "creator-vote" });

  assert.equal(selected.voteCounts[optionId], 1);
  assert.equal(selected.selectedOptionId, optionId);
  assert.equal(selected.state, "awaiting_creator_confirmation");
});

test("group coverage uses Instamart for fruit and carries it into final cart preview", async () => {
  const tools = createTools();
  const created = await tools.create_group_meal_session({
    creatorId: "coverage-manager",
    headcount: 2,
    budgetPerPerson: 400
  });
  await tools.submit_group_preferences({
    sessionId: created.sessionId,
    invitePasscode: created.invitePasscode,
    participantId: "fruit-person",
    dietMode: "veg",
    mood: "fruits"
  });
  await tools.submit_group_preferences({
    sessionId: created.sessionId,
    invitePasscode: created.invitePasscode,
    participantId: "chicken-person",
    dietMode: "non_veg",
    mood: "spicy chicken"
  });

  const ranked = await tools.rank_group_meal({ sessionId: created.sessionId, actorId: "coverage-manager" });
  const top = ranked.recommendation.options[0];
  const fruitCoverage = top.coverage.participants.find((participant) => participant.participantId === "fruit-person");
  assert.equal(top.coverage.satisfiedCount, 2);
  assert.equal(top.coverage.compromiseCount, 0);
  assert.equal(fruitCoverage.source, "instamart");
  assert.match(fruitCoverage.matchedItem, /fruit/i);
  assert.ok(top.instamartItems.some((item) => /fruit/i.test(item.name)));

  const selected = await tools.select_group_option({
    sessionId: created.sessionId,
    actorId: "coverage-manager",
    optionId: top.optionId
  });
  assert.equal(selected.state, "awaiting_creator_confirmation");
  const confirmed = await tools.confirm_group_cart({
    sessionId: created.sessionId,
    actorId: "coverage-manager",
    addOnProductIds: [top.groupAddOns[0].productId],
    confirmed: true
  });
  assert.ok(confirmed.cart.instamartCartPreview.items.some((item) => /fruit/i.test(item.name)));
  assert.ok(confirmed.cart.instamartCartPreview.items.some((item) => item.quantity === 2));
  assert.equal(confirmed.mealMemoryEntry.groupSessionId, created.sessionId);
  assert.equal(confirmed.mealMemoryEntry.headcount, 2);
  assert.ok(confirmed.mealMemoryEntry.addOns.length >= 2);
});

test("group planner discloses a split order when different restaurants are needed for exact coverage", async () => {
  const tools = createTools();
  const created = await tools.create_group_meal_session({
    creatorId: "split-manager",
    headcount: 2,
    budgetPerPerson: 400
  });
  await tools.submit_group_preferences({
    sessionId: created.sessionId,
    invitePasscode: created.invitePasscode,
    participantId: "pizza-person",
    dietMode: "veg",
    mood: "pizza"
  });
  await tools.submit_group_preferences({
    sessionId: created.sessionId,
    invitePasscode: created.invitePasscode,
    participantId: "chicken-person",
    dietMode: "non_veg",
    mood: "chicken"
  });

  const ranked = await tools.rank_group_meal({ sessionId: created.sessionId, actorId: "split-manager" });
  const top = ranked.recommendation.options[0];
  assert.equal(top.coverage.satisfiedCount, 2);
  assert.equal(top.coverage.compromiseCount, 0);
  assert.equal(top.splitOrder, true);
  assert.equal(top.foodSources.length, 2);
  assert.match(top.tradeoffs.join(" "), /multiple food fulfilments/i);
});
