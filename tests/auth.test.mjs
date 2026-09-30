import test from "node:test";
import assert from "node:assert/strict";
import {
  demoUser,
  issueAuthCookie,
  readAuthUser,
  signSessionToken
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

