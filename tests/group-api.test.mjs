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
