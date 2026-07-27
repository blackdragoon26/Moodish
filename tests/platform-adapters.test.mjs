import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { platformCommandToSession, verifyPlatformRequest } from "../services/agent/src/platform-adapters.mjs";

test("Slack requests require a valid signing-secret signature", async () => {
  const previous = process.env.SLACK_SIGNING_SECRET;
  process.env.SLACK_SIGNING_SECRET = "slack-test-secret";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = "team_id=t1&channel_id=c1&user_id=u1&trigger_id=trigger1&text=team+lunch";
  const signature = `v0=${crypto
    .createHmac("sha256", process.env.SLACK_SIGNING_SECRET)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest("hex")}`;
  try {
    await verifyPlatformRequest("slack", {
      headers: { "x-slack-request-timestamp": timestamp, "x-slack-signature": signature },
      rawBody
    });
    const command = platformCommandToSession("slack", rawBody, "https://moodish.example");
    assert.equal(command.args.creatorId, "u1");
    assert.equal(command.dedupeKey, "slack:trigger1");
  } finally {
    if (previous === undefined) delete process.env.SLACK_SIGNING_SECRET;
    else process.env.SLACK_SIGNING_SECRET = previous;
  }
});

test("Discord requests require Ed25519 verification and map to the shared session contract", async () => {
  const previous = process.env.DISCORD_PUBLIC_KEY;
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const rawPublic = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  process.env.DISCORD_PUBLIC_KEY = rawPublic;
  const timestamp = String(Date.now());
  const payload = {
    id: "interaction-1",
    type: 2,
    guild_id: "guild-1",
    channel_id: "channel-1",
    member: { user: { id: "user-1" } },
    data: { options: [{ name: "vibe", value: "chaap party" }] }
  };
  const rawBody = JSON.stringify(payload);
  const signature = crypto.sign(null, Buffer.from(`${timestamp}${rawBody}`), privateKey).toString("hex");
  try {
    await verifyPlatformRequest("discord", {
      headers: { "x-signature-ed25519": signature, "x-signature-timestamp": timestamp },
      rawBody
    });
    const command = platformCommandToSession("discord", payload, "https://moodish.example");
    assert.equal(command.args.vibe, "chaap party");
    assert.equal(command.dedupeKey, "discord:interaction-1");
  } finally {
    if (previous === undefined) delete process.env.DISCORD_PUBLIC_KEY;
    else process.env.DISCORD_PUBLIC_KEY = previous;
  }
});

test("Slack, Teams, and Discord commands share the same group-session fields", () => {
  const slack = platformCommandToSession(
    "slack",
    "team_id=t&channel_id=c&user_id=u&trigger_id=x&text=lunch",
    "https://moodish.example"
  );
  const teams = platformCommandToSession(
    "teams",
    {
      id: "a",
      text: "Moodish lunch",
      channelData: { tenant: { id: "t" } },
      conversation: { id: "c" },
      from: { id: "u" }
    },
    "https://moodish.example"
  );
  const discord = platformCommandToSession(
    "discord",
    { id: "i", guild_id: "t", channel_id: "c", member: { user: { id: "u" } }, data: {} },
    "https://moodish.example"
  );
  for (const adapter of [slack, teams, discord]) {
    assert.equal(adapter.args.workspaceId, "t");
    assert.equal(adapter.args.channelId, "c");
    assert.equal(adapter.args.creatorId, "u");
  }
});
