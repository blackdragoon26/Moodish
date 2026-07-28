import test from "node:test";
import assert from "node:assert/strict";
import { createWebServer } from "../apps/web/server.mjs";

test("group manager APIs require the signed session token returned at creation", async () => {
  const server = createWebServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const createdResponse = await fetch(`http://127.0.0.1:${port}/api/group-sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ creatorId: "web-manager", headcount: 2 })
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.ok(created.accessToken);

    const denied = await fetch(`http://127.0.0.1:${port}/api/group-sessions/${created.sessionId}/rank`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(denied.status, 401);

    const allowed = await fetch(`http://127.0.0.1:${port}/api/group-sessions/${created.sessionId}/rank`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${created.accessToken}`
      },
      body: "{}"
    });
    assert.equal(allowed.status, 200);
    const ranked = await allowed.json();
    assert.equal(ranked.state, "awaiting_manager");
  } finally {
    server.close();
  }
});

test("group invite requires its separate passcode and manager polling sees submissions", async () => {
  const server = createWebServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const createdResponse = await fetch(`http://127.0.0.1:${port}/api/group-sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ creatorId: "polling-manager", headcount: 2 })
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.match(created.invitePasscode, /^[A-Z2-9]{8}$/);

    const missingCode = await fetch(`http://127.0.0.1:${port}/api/group-sessions/${created.sessionId}/preferences`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ participantId: "participant-1", dietMode: "veg" })
    });
    assert.equal(missingCode.status, 401);

    const wrongCode = await fetch(`http://127.0.0.1:${port}/api/group-sessions/${created.sessionId}/access`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invitePasscode: "WRONG222" })
    });
    assert.equal(wrongCode.status, 403);

    const unlocked = await fetch(`http://127.0.0.1:${port}/api/group-sessions/${created.sessionId}/access`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invitePasscode: created.invitePasscode })
    });
    assert.equal(unlocked.status, 200);

    const submitted = await fetch(`http://127.0.0.1:${port}/api/group-sessions/${created.sessionId}/preferences`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        invitePasscode: created.invitePasscode,
        participantId: "participant-1",
        dietMode: "veg"
      })
    });
    assert.equal(submitted.status, 200);

    const managerView = await fetch(`http://127.0.0.1:${port}/api/group-sessions/${created.sessionId}`, {
      headers: { authorization: `Bearer ${created.accessToken}` }
    });
    assert.equal(managerView.status, 200);
    const current = await managerView.json();
    assert.equal(current.responseCount, 1);
    assert.equal(current.aggregate.vegCount, 1);
    assert.equal(JSON.stringify(current).includes(created.invitePasscode), false);
  } finally {
    server.close();
  }
});
