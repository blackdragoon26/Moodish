import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyPlatformRequest } from "../services/agent/src/platform-adapters.mjs";
import { startPlatformOAuth, completePlatformOAuth } from "../services/agent/src/platform-oauth.mjs";
import { verifyGroupAccessToken } from "../services/agent/src/access-token.mjs";
import { createTools } from "../services/agent/src/tools.mjs";
import { createServer } from "../services/agent/src/server.mjs";

function withEnv(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}
const now = () => Math.floor(Date.now() / 1000);
const slackSignature = (secret, timestamp, body) => `v0=${crypto.createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;

test("Slack rejects forged, unsigned and stale requests", async t => {
  withEnv(t, { SLACK_SIGNING_SECRET: "slack-test-secret" });
  const body = "team_id=t1&channel_id=c1&user_id=u1&trigger_id=x&text=lunch";
  const cases = [
    { "x-slack-request-timestamp": String(now()), "x-slack-signature": slackSignature("wrong-secret", now(), body) },
    { "x-slack-request-timestamp": String(now()) },
    { "x-slack-request-timestamp": String(now() - 600), "x-slack-signature": slackSignature("slack-test-secret", now() - 600, body) }
  ];
  for (const headers of cases) await assert.rejects(verifyPlatformRequest("slack", { headers, rawBody: body }), { status: 401 });
  await assert.rejects(verifyPlatformRequest("slack", { headers: cases[0], rawBody: body + "&text=tampered" }), { status: 401 });
});

test("Discord rejects forged and stale requests", async t => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  withEnv(t, { DISCORD_PUBLIC_KEY: publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex") });
  const body = JSON.stringify({ id: "i1", type: 2 });
  const sign = (timestamp, key = privateKey) => crypto.sign(null, Buffer.from(`${timestamp}${body}`), key).toString("hex");
  const other = crypto.generateKeyPairSync("ed25519").privateKey;
  await assert.rejects(verifyPlatformRequest("discord", { headers: { "x-signature-ed25519": sign(now(), other), "x-signature-timestamp": String(now()) }, rawBody: body }), { status: 401 });
  const stale = now() - 30 * 24 * 3600;
  await assert.rejects(verifyPlatformRequest("discord", { headers: { "x-signature-ed25519": sign(stale), "x-signature-timestamp": String(stale) }, rawBody: body }), { status: 401 });
  assert.equal(await verifyPlatformRequest("discord", { headers: { "x-signature-ed25519": sign(now()), "x-signature-timestamp": String(now()) }, rawBody: body }), true);
});

test("a replayed signed Slack command returns the first response and creates no second session", async t => {
  withEnv(t, { SLACK_SIGNING_SECRET: "slack-test-secret" });
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const body = `team_id=t1&channel_id=c1&user_id=U-creator&trigger_id=${crypto.randomUUID()}&text=team+lunch`;
  const send = () => {
    const timestamp = String(now());
    return fetch(`http://127.0.0.1:${server.address().port}/api/platforms/slack/events`, { method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-slack-request-timestamp": timestamp, "x-slack-signature": slackSignature("slack-test-secret", timestamp, body) }, body }).then(r => r.json());
  };
  const first = await send();
  const second = await send();
  assert.deepEqual(second, first, "same session and passcode, not a new one");
});

test("platform creator handoff grants a manager token only to the session's manager on the same platform", async t => {
  withEnv(t, { SLACK_CLIENT_ID: "slack-client", SLACK_CLIENT_SECRET: "slack-secret", DISCORD_CLIENT_ID: "discord-client", DISCORD_CLIENT_SECRET: "discord-secret" });
  const original = globalThis.fetch;
  let slackUser = "U-creator";
  globalThis.fetch = async url => {
    if (String(url).startsWith("https://slack.com/api/oauth.v2.access")) return new Response(JSON.stringify({ ok: true, authed_user: { id: slackUser } }));
    if (String(url).startsWith("https://discord.com/api/v10/oauth2/token")) return new Response(JSON.stringify({ access_token: "d" }));
    if (String(url).startsWith("https://discord.com/api/v10/users/@me")) return new Response(JSON.stringify({ id: "U-creator" }));
    throw new Error(`unexpected ${url}`);
  };
  t.after(() => { globalThis.fetch = original; });
  const session = await createTools().create_group_meal_session({ platform: "slack", creatorId: "U-creator", coManagerIds: ["U-co"] });
  const flow = () => startPlatformOAuth("slack", { sessionId: session.sessionId, redirectUri: "https://moodish.example/cb" }).state;

  const state = flow();
  const granted = await completePlatformOAuth("slack", { code: "c", state });
  assert.equal(verifyGroupAccessToken(granted.accessToken, session.sessionId).actorId, "U-creator");
  await assert.rejects(completePlatformOAuth("slack", { code: "c", state }), { status: 400 }, "state is single use");

  slackUser = "U-co";
  assert.equal((await completePlatformOAuth("slack", { code: "c", state: flow() })).actorId, "U-co");
  slackUser = "U-stranger";
  await assert.rejects(completePlatformOAuth("slack", { code: "c", state: flow() }), { status: 403 });
  // The same user id on another platform is a different identity.
  const discordState = startPlatformOAuth("discord", { sessionId: session.sessionId, redirectUri: "https://moodish.example/cb" }).state;
  await assert.rejects(completePlatformOAuth("discord", { code: "c", state: discordState }), { status: 403 });
  await assert.rejects(completePlatformOAuth("discord", { code: "c", state: flow() }), { status: 400 }, "a Slack state cannot finish a Discord flow");
});
