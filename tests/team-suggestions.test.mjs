import test from "node:test";
import assert from "node:assert/strict";
import { safeTeamSuggestions } from "../services/agent/src/team-suggestions.mjs";
const valid = () => ({
  restaurantName: "Original ranking restaurant",
  foodSources: [{ restaurantName: "Actual fulfilment restaurant" }],
  items: [{ quantity: 2, name: "Veg bowl" }],
  estimatedTotal: 500,
  coverage: {
    totalParticipants: 2,
    satisfiedCount: 2,
    compromiseCount: 0,
    unansweredCount: 0,
    withinBudget: true,
    participants: [
      { status: "satisfied", source: "food" },
      { status: "satisfied", source: "food" },
    ],
  },
});
test("shortlist uses the actual restaurant and exposes only aggregate coverage", () => {
  const option = valid();
  option.coverage.participants[0].participantId = "private-person";
  const result = safeTeamSuggestions([option], 2, 700);
  assert.equal(result[0].restaurant, "Actual fulfilment restaurant");
  assert.ok(!JSON.stringify(result).includes("private-person"));
});
test("shortlist rejects missing coverage, compromises, split fulfilment and current-budget violations", () => {
  const missing = valid();
  missing.coverage.satisfiedCount = 1;
  missing.coverage.participants[1] = {
    status: "unavailable",
    source: "unavailable",
  };
  const compromised = valid();
  compromised.coverage.compromiseCount = 1;
  const split = valid();
  split.foodSources.push({ restaurantName: "Second" });
  assert.deepEqual(
    safeTeamSuggestions([missing, compromised, split, valid()], 2, 400),
    [],
  );
  assert.equal(safeTeamSuggestions([valid(), valid()], 2, 700).length, 1);
});
