import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startLiveApp } from "./helpers/live-app.mjs";
import { createWebServer } from "../apps/web/server.mjs";
import { signSessionToken } from "../services/agent/src/auth.mjs";
import { signGroupAccessToken } from "../services/agent/src/access-token.mjs";
import { updateTasteProfile, getTasteProfile } from "../services/agent/src/memory.mjs";

async function twoConnectedUsers(app) {
  const alice = app.user(`google:alice-${crypto.randomUUID()}`);
  const bob = app.user(`google:bob-${crypto.randomUUID()}`);
  await app.connect(alice, { accessToken: "token-alice" });
  await app.connect(bob, { accessToken: "token-bob" });
  for (const session of [alice, bob]) assert.equal((await app.request("/api/swiggy/address", { body: { addressId: "addr-1" }, session })).status, 200);
  return { alice, bob };
}

for (const sessionHeader of ["cookie", "native"]) {
  test(`two accounts stay isolated through the ${sessionHeader} session path`, async t => {
    const app = await startLiveApp(t);
    const { alice, bob } = await twoConnectedUsers(app);
    const as = (session, path, body) => app.request(path, { body, session, sessionHeader });

    const before = app.fake.calls().length;
    const recommendation = (await as(alice, "/api/recommendations/personal", { mood: "soya chaap", maxBudget: 600, dietMode: "veg" })).body;
    const during = app.fake.calls().slice(before);
    assert.ok(during.length > 0 && during.every(call => call.token === "token-alice"), "Alice's requests use only Alice's credential");
    const bobCallsBefore = app.fake.calls().length;
    const optionId = recommendation.options[0].optionId;
    assert.equal((await as(bob, "/api/cart/prepare", { recommendationId: recommendation.recommendationId, optionId })).status, 404, "Bob cannot review Alice's recommendation");
    assert.equal(app.fake.calls().length, bobCallsBefore, "the refused review made no Swiggy call");

    const prepared = (await as(alice, "/api/cart/prepare", { recommendationId: recommendation.recommendationId, optionId })).body;
    const stolen = await as(bob, "/api/cart/confirm", { recommendationId: recommendation.recommendationId, optionId, preparationId: prepared.preparationId, confirmed: true });
    assert.equal(stolen.status, 404, "Bob cannot confirm Alice's review");
    assert.equal(app.fake.writes(), 0);

    // Bob's own requests use Bob's credential and Bob's saved state.
    await as(bob, "/api/swiggy/addresses");
    assert.equal(app.fake.calls("get_addresses").at(-1).token, "token-bob");
    assert.equal((await as(bob, "/api/swiggy/disconnect", {})).status, 200);
    assert.equal((await as(alice, "/api/swiggy/connection")).body.connected, true, "Bob disconnecting does not affect Alice");
    assert.equal((await as(bob, "/api/profile")).body.userIdHash.startsWith("google:bob-"), true);
    // Alice's review is still confirmable by Alice alone.
    assert.equal((await as(alice, "/api/cart/confirm", { recommendationId: recommendation.recommendationId, optionId, preparationId: prepared.preparationId, confirmed: true })).status, 200);
    assert.equal(app.fake.calls("update_food_cart")[0].token, "token-alice");
  });
}

test("group purchasing operations need both the creator's group token and the purchasing account", async t => {
  const app = await startLiveApp(t);
  const { alice, bob } = await twoConnectedUsers(app);
  const group = (await app.request("/api/group-sessions", { body: { headcount: 2, creatorId: "someone-else", purchaseUserId: "someone-else" }, session: alice })).body;
  const aliceId = JSON.parse(Buffer.from(alice.split(".")[0], "base64url")).id;
  assert.equal(group.creatorId, aliceId, "the creator comes from the signed session, not the body");
  const bobGroupToken = signGroupAccessToken({ sessionId: group.sessionId, actorId: JSON.parse(Buffer.from(bob.split(".")[0], "base64url")).id });
  const otherSessionToken = signGroupAccessToken({ sessionId: "group_other", actorId: aliceId });
  const cases = [
    ["connect", { authorization: `Bearer ${group.accessToken}` }, null, 401, "group token alone"],
    ["connect", { authorization: `Bearer ${group.accessToken}` }, bob, 403, "creator token with another account"],
    ["connect", { authorization: `Bearer ${bobGroupToken}` }, bob, 403, "a participant-level token"],
    ["connect", { authorization: `Bearer ${otherSessionToken}` }, alice, 401, "a token for another session"],
    ["connect", {}, alice, 401, "no group token"]
  ];
  for (const [action, headers, session, status, label] of cases) {
    for (const sessionHeader of ["cookie", "native"]) {
      const result = await app.request(`/api/group-sessions/${group.sessionId}/${action}`, { body: {}, session, sessionHeader, headers });
      assert.equal(result.status, status, `${label} via ${sessionHeader}: ${result.body.error}`);
    }
  }
  assert.equal((await app.request(`/api/group-sessions/${group.sessionId}/connect`, { body: {}, session: alice, headers: { authorization: `Bearer ${group.accessToken}` } })).status, 200);
  for (const action of ["prepare-cart", "confirm-cart"]) {
    for (const [session, status] of [[null, 401], [bob, 403]]) {
      for (const sessionHeader of ["cookie", "native"]) {
        const result = await app.request(`/api/group-sessions/${group.sessionId}/${action}`, { body: { confirmed: true }, session, sessionHeader, headers: { authorization: `Bearer ${group.accessToken}` } });
        assert.equal(result.status, status, `${action} with ${session ? "another account" : "no account"} via ${sessionHeader}`);
      }
    }
  }
  assert.equal(app.fake.writes(), 0);
});

test("participants cannot read private preferences or act as managers", async t => {
  const app = await startLiveApp(t);
  const { alice } = await twoConnectedUsers(app);
  const group = (await app.request("/api/group-sessions", { body: { headcount: 3 }, session: alice })).body;
  const submit = (participantId, allergies) => app.request(`/api/group-sessions/${group.sessionId}/preferences`, { body: { participantId, invitePasscode: group.invitePasscode, allergies, dietaryRules: ["jain"], mood: "private mood text" } });
  assert.equal((await submit("participant-a", ["private-peanut"])).status, 200);
  const view = await submit("participant-b", ["private-sesame"]);
  const serialized = JSON.stringify(view.body);
  for (const secret of ["private-peanut", "private-sesame", "participant-a", "private mood text", "invitePasscodeHash"]) assert.equal(serialized.includes(secret), false, secret);
  assert.equal(view.body.aggregate.allergySubmissionCount, 2);
  assert.equal((await app.request(`/api/group-sessions/${group.sessionId}/preferences`, { body: { participantId: "x", invitePasscode: "WRONGCODE" } })).status, 403);
  assert.equal((await app.request(`/api/group-sessions/${group.sessionId}/preferences`, { body: { participantId: "x", bypassInvitePasscode: true } })).status, 401, "the client cannot skip the passcode");
  const publicView = await app.request(`/api/group-sessions/${group.sessionId}`);
  assert.equal(JSON.stringify(publicView.body).includes("private-peanut"), false);
  for (const action of ["rank", "select", "cancel"]) {
    assert.equal((await app.request(`/api/group-sessions/${group.sessionId}/${action}`, { body: { actorId: group.creatorId } })).status, 401, `${action} needs a manager token`);
  }
  const managerView = await app.request(`/api/group-sessions/${group.sessionId}`, { headers: { authorization: `Bearer ${group.accessToken}` } });
  assert.equal(managerView.body.submissions.length, 2, "the creator can see submissions");
});

test("fixture mode: /mcp cannot reach group tools and requests cannot name another account", async t => {
  const previous = { SWIGGY_MODE: process.env.SWIGGY_MODE };
  process.env.SWIGGY_MODE = "fixture";
  const server = createWebServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (previous.SWIGGY_MODE === undefined) delete process.env.SWIGGY_MODE; else process.env.SWIGGY_MODE = previous.SWIGGY_MODE;
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body, headers = {}) => {
    const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const demo = signSessionToken({ id: "demo:moodish", name: "Guest", provider: "demo" });
  const group = (await post("/api/group-sessions", { headcount: 2 }, { cookie: `moodish_session=${demo}` })).body;
  await post(`/api/group-sessions/${group.sessionId}/preferences`, { participantId: "p1", invitePasscode: group.invitePasscode, allergies: ["fixture-private-allergy"] });
  for (const [name, args] of [
    ["get_group_meal_session", { sessionId: group.sessionId, actorId: "demo:moodish" }],
    ["submit_group_preferences", { sessionId: group.sessionId, participantId: "intruder", bypassInvitePasscode: true }],
    ["confirm_group_cart", { sessionId: group.sessionId, actorId: "demo:moodish", confirmed: true }]
  ]) {
    const result = await post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
    assert.equal(result.status, 403, name);
    assert.equal(JSON.stringify(result.body).includes("fixture-private-allergy"), false);
  }

  const victim = `google:victim-${crypto.randomUUID()}`;
  await updateTasteProfile(victim, { likedCuisines: ["victim-private"] });
  const read = await fetch(`${base}/api/profile?userIdHash=${encodeURIComponent(victim)}`);
  assert.equal(JSON.stringify(await read.json()).includes("victim-private"), false);
  const deleted = await post("/api/privacy/delete-taste-memory", { userIdHash: victim });
  assert.notEqual(deleted.body.userIdHash, victim);
  const overwritten = await post("/api/profile", { userIdHash: victim, patch: { likedCuisines: ["attacker"] } });
  assert.notEqual(overwritten.body.userIdHash, victim);
  const exported = await post("/mcp", { method: "tools/call", params: { name: "get_taste_memory", arguments: { userIdHash: victim } } });
  assert.equal(JSON.stringify(exported.body).includes("victim-private"), false);
  assert.deepEqual((await getTasteProfile(victim)).likedCuisines, ["victim-private"], "the victim's data is untouched");
  // A signed-in user still reaches their own data.
  const own = await fetch(`${base}/api/profile`, { headers: { cookie: `moodish_session=${signSessionToken({ id: victim, name: "Victim" })}` } });
  assert.deepEqual((await own.json()).likedCuisines, ["victim-private"]);
});
