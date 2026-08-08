import test from "node:test";
import assert from "node:assert/strict";
import {
  demoUser,
  issueAuthCookie,
  readAuthUser,
  signSessionToken,
  startGoogleOAuth,
  completeGoogleOAuth
} from "../services/agent/src/auth.mjs";
import { createServer } from "../services/agent/src/server.mjs";

test("readAuthUser accepts a bearer token as an alternative to the session cookie", () => {
  const user = demoUser();
  const token = signSessionToken(user);
  const fromBearer = readAuthUser("", `Bearer ${token}`);
  assert.equal(fromBearer.id, user.id);
  const fromCookie = readAuthUser(`moodish_session=${token}`, "");
  assert.equal(fromCookie.id, user.id);
  assert.equal(readAuthUser("", "Bearer garbage"), null);
  assert.equal(readAuthUser("", ""), null);
});

test("signSessionToken matches the token embedded in issueAuthCookie", () => {
  const user = demoUser();
  const token = signSessionToken(user);
  const cookie = issueAuthCookie(user);
  assert.match(cookie, new RegExp(`moodish_session=${token.replace(/[.]/g, "\\.")};`));
});

test("bootstrap accepts a bearer token from a native client with no cookie support", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const token = signSessionToken(demoUser());
    const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const body = await response.json();
    assert.equal(body.user.id, "demo:moodish");
  } finally {
    server.close();
  }
});

test("mobile Google login redirects to the app's custom URL scheme with a bearer-ready token", async () => {
  const previous = { GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET };
  Object.assign(process.env, { GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return { ok: true, json: async () => ({ access_token: "fake-access-token" }) };
    }
    if (String(url).includes("openidconnect.googleapis.com")) {
      return { ok: true, json: async () => ({ sub: "12345", name: "Ada Lovelace", email: "ada@example.com" }) };
    }
    throw new Error(`Unexpected fetch to ${url}`);
  };
  try {
    const authorizeUrl = new URL(startGoogleOAuth("http://localhost:8787", { mobile: true }));
    const state = authorizeUrl.searchParams.get("state");
    const { mobile, user } = await completeGoogleOAuth({ code: "fake-code", state });
    assert.equal(mobile, true);
    assert.equal(user.id, "google:12345");
    const token = signSessionToken(user);
    assert.equal(readAuthUser("", `Bearer ${token}`).id, "google:12345");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("web Google login (no client=mobile flag) is unaffected and still stays browser/cookie based", async () => {
  const previous = { GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET };
  Object.assign(process.env, { GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret" });
  try {
    const authorizeUrl = new URL(startGoogleOAuth("http://localhost:8787"));
    const state = authorizeUrl.searchParams.get("state");
    assert.ok(state);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
