import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../services/agent/src/server.mjs";
import { signSessionToken } from "../services/agent/src/auth.mjs";

async function groupApp(t) {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body, headers = {}) => {
    const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const creator = signSessionToken({ id: `demo:participants-${Math.random()}`, name: "Creator" });
  const group = (await call("/api/group-sessions", { headcount: 3, approvalMode: "team_vote" }, { cookie: `moodish_session=${creator}` })).body;
  return { call, group };
}

test("a participant name can only be changed by the device that first used it", async t => {
  const { call, group } = await groupApp(t);
  const path = `/api/group-sessions/${group.sessionId}/preferences`;
  const first = await call(path, { participantId: "Asha", invitePasscode: group.invitePasscode, mood: "biryani", allergies: ["peanut"] });
  assert.equal(first.status, 200);
  assert.ok(first.body.participantToken, "the first answer gets a private token");

  // Someone else with the passcode types the same name.
  const impostor = await call(path, { participantId: "Asha", invitePasscode: group.invitePasscode, mood: "salad", allergies: [] });
  assert.equal(impostor.status, 403);
  assert.match(impostor.body.error, /already used/);
  const wrongToken = await call(path, { participantId: "Asha", invitePasscode: group.invitePasscode, participantToken: "guess", mood: "salad" });
  assert.equal(wrongToken.status, 403);

  // The original participant can still edit, and gets no new token.
  const edit = await call(path, { participantId: "Asha", invitePasscode: group.invitePasscode, participantToken: first.body.participantToken, mood: "spicy biryani", allergies: ["peanut"] });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.participantToken, undefined);

  const manager = await call(`/api/group-sessions/${group.sessionId}`, null, { authorization: `Bearer ${group.accessToken}` });
  const asha = manager.body.submissions.find(submission => submission.participantId === "Asha");
  assert.equal(asha.mood, "spicy biryani", "the impostor's answer was never saved");
  assert.equal(JSON.stringify(manager.body).includes(first.body.participantToken), false, "tokens never appear in session views");
  assert.equal(JSON.stringify(manager.body).includes("participantKeys"), false);
  assert.equal(manager.body.responseCount, 1);
});

test("votes are bound to the same name token, and managers can still add teammates' answers", async t => {
  const { call, group } = await groupApp(t);
  const managerHeaders = { authorization: `Bearer ${group.accessToken}` };
  // A manager fills in answers for teammates without per-name tokens.
  for (const participantId of ["Ben", "Chen"]) {
    const added = await call(`/api/group-sessions/${group.sessionId}/preferences`, { participantId, mood: "noodles" }, managerHeaders);
    assert.equal(added.status, 200);
    assert.equal(added.body.participantToken, undefined);
  }
  // A name the manager entered cannot be claimed by someone with the passcode.
  const claim = await call(`/api/group-sessions/${group.sessionId}/preferences`, { participantId: "Ben", invitePasscode: group.invitePasscode, mood: "salad" });
  assert.equal(claim.status, 403);
  assert.match(claim.body.error, /ask the organiser/);
  const dia = await call(`/api/group-sessions/${group.sessionId}/preferences`, { participantId: "Dia", invitePasscode: group.invitePasscode, mood: "pizza" });
  const ranked = await call(`/api/group-sessions/${group.sessionId}/rank`, {}, managerHeaders);
  assert.equal(ranked.status, 200, ranked.body.error);
  const optionId = ranked.body.recommendation.options[0].optionId;
  const vote = path => call(`/api/group-sessions/${group.sessionId}/vote`, path);
  assert.equal((await vote({ participantId: "Dia", optionId, invitePasscode: group.invitePasscode })).status, 403, "someone else cannot vote as Dia");
  assert.equal((await vote({ participantId: "Dia", optionId, invitePasscode: group.invitePasscode, participantToken: dia.body.participantToken })).status, 200);
  const fresh = await vote({ participantId: "Eli", optionId, invitePasscode: group.invitePasscode });
  assert.equal(fresh.status, 200);
  assert.ok(fresh.body.participantToken, "a first vote under a new name also gets a token");
});

test("answers saved before participant tokens existed can only be changed by a manager", async t => {
  const { call, group } = await groupApp(t);
  const { getGroupSession, saveGroupSession } = await import("../services/agent/src/memory.mjs");
  await call(`/api/group-sessions/${group.sessionId}/preferences`, { participantId: "Farah", invitePasscode: group.invitePasscode, mood: "dosa" });
  // Simulate a session stored by the previous release: answers, but no tokens.
  const stored = await getGroupSession(group.sessionId);
  delete stored.participantKeys;
  await saveGroupSession(stored);
  const takeover = await call(`/api/group-sessions/${group.sessionId}/preferences`, { participantId: "Farah", invitePasscode: group.invitePasscode, mood: "salad" });
  assert.equal(takeover.status, 403);
  const managerEdit = await call(`/api/group-sessions/${group.sessionId}/preferences`, { participantId: "Farah", mood: "masala dosa" }, { authorization: `Bearer ${group.accessToken}` });
  assert.equal(managerEdit.status, 200);
  const fresh = await call(`/api/group-sessions/${group.sessionId}/preferences`, { participantId: "Gita", invitePasscode: group.invitePasscode, mood: "idli" });
  assert.ok(fresh.body.participantToken, "brand-new names still get a token");
});
