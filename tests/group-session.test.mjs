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
  await tools.submit_group_preferences({ sessionId: session.sessionId, participantId: "veg-person", dietMode: "veg", mood: "noodles" });
  await tools.submit_group_preferences({ sessionId: session.sessionId, participantId: "nonveg-person", dietMode: "non_veg", mood: "chicken" });
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
  await tools.submit_group_preferences({ sessionId: created.sessionId, participantId: "p1", mood: "office lunch" });
  const ranked = await tools.rank_group_meal({ sessionId: created.sessionId, actorId: "creator-vote" });
  const optionId = ranked.recommendation.options[0].optionId;
  await tools.vote_group_option({ sessionId: created.sessionId, participantId: "p1", optionId });
  await tools.vote_group_option({ sessionId: created.sessionId, participantId: "p1", optionId });
  const selected = await tools.select_group_option({ sessionId: created.sessionId, actorId: "creator-vote" });

  assert.equal(selected.voteCounts[optionId], 1);
  assert.equal(selected.selectedOptionId, optionId);
  assert.equal(selected.state, "awaiting_creator_confirmation");
});
