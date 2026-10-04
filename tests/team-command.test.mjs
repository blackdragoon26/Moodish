import test from "node:test";
import assert from "node:assert/strict";
import { parseTeamCommand } from "../services/agent/src/team-command.mjs";
const now = Date.parse("2026-10-05T06:00:00Z");
test("chat meal brief extracts people, budget and an explicit India delivery schedule", () => {
  const result = parseTeamCommand(
    "team lunch Friday for 12 ₹350 delivery 1pm",
    now,
  );
  assert.equal(result.headcount, 12);
  assert.equal(result.budgetPerPerson, 350);
  assert.equal(result.deliveryTime, "2026-10-09T07:30:00.000Z");
  assert.equal(result.deadline, "2026-10-09T07:00:00.000Z");
});
test("chat parser requires clarification for ambiguous or past schedules", () => {
  assert.equal(parseTeamCommand("connect code", now), null);
  assert.deepEqual(parseTeamCommand("lunch", now), { vibe: "team lunch" });
  assert.throws(() => parseTeamCommand("lunch Friday ₹350", now), {
    status: 400,
  });
  assert.throws(() => parseTeamCommand("lunch delivery 9am", now), {
    status: 400,
  });
  assert.throws(() => parseTeamCommand("lunch tomorrow delivery 25:00", now), {
    status: 400,
  });
});

test("unsupported scheduling language is rejected rather than ignored", () => {
  for (const command of [
    "lunch delivery noon",
    "lunch at 1pm",
    "lunch around noon",
  ])
    assert.throws(() => parseTeamCommand(command, now), { status: 400 });
});
