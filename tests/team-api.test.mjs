import test from "node:test";
import assert from "node:assert/strict";
import { createWebServer } from "../apps/web/server.mjs";
import { signSessionToken } from "../services/agent/src/auth.mjs";
import crypto from "node:crypto";

test("Teams API binds workspace access to the signed account and ignores supplied actor IDs", async () => {
  const server = createWebServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const owner = crypto.randomUUID(),
    stranger = crypto.randomUUID();
  const request = async (path, id, body) =>
    fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        ...(id
          ? {
              authorization: `Bearer ${signSessionToken({ id, name: "Tester", provider: "google" })}`,
            }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    assert.equal((await request("/api/teams", null)).status, 401);
    const response = await request("/api/teams", owner, {
      name: "Team",
      office: "Private office",
      headcount: 3,
      creatorId: stranger,
    });
    assert.equal(response.status, 201);
    const team = await response.json();
    assert.equal(
      (await request(`/api/teams/${team.id}`, stranger)).status,
      403,
    );
    assert.equal(
      (
        await request(`/api/teams/${team.id}/create-meal`, stranger, {
          actorId: owner,
        })
      ).status,
      403,
    );
    const meal = await (
      await request(`/api/teams/${team.id}/create-meal`, owner, {})
    ).json();
    assert.equal(
      (await request(`/api/teams/${team.id}/meals/${meal.id}`, null)).status,
      401,
    );
    const view = await request(`/api/team-join/${team.id}/${meal.id}`, null, {
      token: meal.shareToken,
    });
    assert.equal(view.status, 200);
    assert.ok(!JSON.stringify(await view.json()).includes("Private office"));
    assert.equal(
      (
        await request(`/api/team-join/${team.id}/${meal.id}`, null, {
          token: "bad",
        })
      ).status,
      403,
    );
    const csrf = await fetch(base + `/api/teams/${team.id}/settings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${signSessionToken({ id: owner })}`,
        origin: "https://evil.example",
      },
      body: JSON.stringify({ office: "changed" }),
    });
    assert.equal(csrf.status, 403);
  } finally {
    server.close();
  }
});
test("Teams demo sessions use unique identities and cannot install real channels", async () => {
  const server = createWebServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const a = await fetch(base + "/api/teams/demo", { method: "POST" }),
      b = await fetch(base + "/api/teams/demo", { method: "POST" });
    assert.equal(a.status, 200);
    assert.notEqual((await a.json()).user.id, (await b.json()).user.id);
    const cookie = a.headers.get("set-cookie").split(";")[0];
    const t = await (
      await fetch(base + "/api/teams", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Preview",
          office: "Office",
          headcount: 2,
        }),
      })
    ).json();
    const denied = await fetch(base + `/api/teams/${t.id}/pair`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ platform: "discord" }),
    });
    assert.equal(denied.status, 403);
  } finally {
    server.close();
  }
});

test("Google sign-in accepts only the explicit teams return route", async () => {
  const { startGoogleOAuth } = await import("../services/agent/src/auth.mjs");
  const prior = {
    id: process.env.GOOGLE_CLIENT_ID,
    secret: process.env.GOOGLE_CLIENT_SECRET,
  };
  process.env.GOOGLE_CLIENT_ID = "test";
  process.env.GOOGLE_CLIENT_SECRET = "test";
  try {
    await assert.rejects(
      startGoogleOAuth("https://moodish.example", {
        browserBinding: "binding",
        returnTo: "https://evil.example",
      }),
      { status: 400 },
    );
    const url = await startGoogleOAuth("https://moodish.example", {
      browserBinding: "binding",
      returnTo: "/teams.html?team=abc&meal=def",
    });
    assert.match(url, /accounts.google.com/);
  } finally {
    if (prior.id === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = prior.id;
    if (prior.secret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = prior.secret;
  }
});
