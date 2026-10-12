import test from "node:test";
import assert from "node:assert/strict";
import { teamDecisionBrief } from "../services/agent/src/team-decision.mjs";
const now = 2000000;
const team = { defaults: { budgetPerPerson: 300, maxTotal: 1000 } };
const meal = () => ({
  state: "review",
  budgetPerPerson: 350,
  capacity: 20,
  deadline: now - 1,
  participants: {
    private: { attendance: "join", name: "Secret", allergies: "peanut" },
    second: { attendance: "join" },
    waiting: { attendance: "pending" },
  },
  choices: [
    { id: "a", restaurant: "A", total: 500, verifiedAt: now - 1 },
    { id: "b", restaurant: "B", total: 400, verifiedAt: now - 900001 },
  ],
});
test("brief uses actual attendance and current caps without leaking preferences or inventing nonresponders", () => {
  const brief = teamDecisionBrief(team, meal(), now);
  assert.equal(brief.currentSpendCap, 600);
  assert.equal(brief.pending, 1);
  assert.equal(brief.lowestCheckedChoiceId, "a");
  assert.equal(brief.options[0].perPerson, 250);
  assert.equal(brief.options[0].remainingBudget, 100);
  assert.ok(!JSON.stringify(brief).includes("peanut"));
  assert.ok(!JSON.stringify(brief).includes("Secret"));
});
test("over-budget, stale, future and non-review choices cannot become recommendations", () => {
  const s = meal();
  s.choices[0].total = 700;
  assert.equal(teamDecisionBrief(team, s, now).lowestCheckedChoiceId, null);
  s.choices[0].total = 500;
  s.choices[0].verifiedAt = now + 1;
  assert.equal(teamDecisionBrief(team, s, now).lowestCheckedChoiceId, null);
  s.choices[0].verifiedAt = now;
  s.state = "collecting";
  assert.equal(teamDecisionBrief(team, s, now).lowestCheckedChoiceId, null);
  s.participants = {};
  const brief = teamDecisionBrief(team, s, now);
  assert.equal(brief.currentSpendCap, 0);
  assert.equal(brief.options[0].perPerson, null);
});

test("cancelled empty meals direct the organizer to a fresh invitation", () => {
  const s = meal();
  s.state = "cancelled";
  s.participants = {};
  assert.match(
    teamDecisionBrief(team, s, now).nextAction,
    /cancelled.*fresh invitation/,
  );
});
