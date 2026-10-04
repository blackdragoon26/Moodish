import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  createTeam,
  mutateTeam,
  readTeam,
  participantAction,
  mealAction,
} from "../services/agent/src/team-service.mjs";
import {
  saveSecretSession,
  getSecretSession,
} from "../services/agent/src/memory.mjs";
import { encryptToken } from "../services/agent/src/swiggy-auth.mjs";
import {
  publishMeal,
  verifyWhatsApp,
  whatsappEvents,
  remindMeal,
  pairChannel,
  teamChannelCommand,
  slackInstallStart,
  slackInstallComplete,
} from "../services/agent/src/team-channels.mjs";
import { runTeamJobs } from "../services/agent/src/team-jobs.mjs";
Object.assign(process.env, {
  TOKEN_ENCRYPTION_KEY: "test-team-encryption-long-key-012345678901",
  SLACK_CLIENT_ID: "slack-app",
  SLACK_CLIENT_SECRET: "slack-secret",
  SLACK_SIGNING_SECRET: "signing-secret",
  DISCORD_CLIENT_ID: "123",
  DISCORD_PUBLIC_KEY: "key",
  DISCORD_BOT_TOKEN: "bot-token",
  WHATSAPP_ACCESS_TOKEN: "wa-token",
  WHATSAPP_PHONE_NUMBER_ID: "wa-business",
  WHATSAPP_APP_SECRET: "wa-secret",
  WHATSAPP_VERIFY_TOKEN: "verify",
  WHATSAPP_GRAPH_VERSION: "v25.0",
  WHATSAPP_REMINDER_TEMPLATE: "meal_reminder",
});
const base = "https://moodish.example";
async function setup() {
  const u = { id: crypto.randomUUID() };
  const team = await createTeam(u, {
    name: "Acme",
    office: "Office",
    headcount: 2,
  });
  const s = await mutateTeam(team.id, u.id, "create-meal", {});
  return { u, team, s, phone: "91" + crypto.randomInt(1000000000, 9999999999) };
}
async function connect(f, platform = "discord") {
  const t = await readTeam(f.team.id);
  t.channels = {
    [platform]: {
      channelId: `channel-${f.s.id}`,
      workspaceId: `workspace-${f.team.id}`,
      actorId: "789",
      userId: f.u.id,
      ...(platform === "slack" ? { token: encryptToken("slack-token") } : {}),
    },
  };
  await saveSecretSession(`teams:${t.id}`, t);
  await saveSecretSession(
    `team-channel:${platform}:workspace-${f.team.id}:channel-${f.s.id}`,
    { teamId: t.id },
  );
}
const wa = (f, message, id = crypto.randomUUID(), phone = f.phone) => ({
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: "wa-business" },
            messages: [
              { id, from: phone, type: "text", text: { body: message } },
            ],
          },
        },
      ],
    },
  ],
});
function mockProvider(fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  return () => {
    globalThis.fetch = original;
  };
}

test("publication updates one message, omits private preferences, and handles explicit rejection", async () => {
  const f = await setup();
  await connect(f);
  let calls = [];
  let reject = true;
  const restore = mockProvider(async (url, o) => {
    calls.push({ url: String(url), ...o });
    if (reject)
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
      });
    return new Response(JSON.stringify({ id: "message-1" }));
  });
  try {
    await assert.rejects(
      publishMeal(f.team.id, f.s.id, f.u.id, "discord", base),
      { status: 502 },
    );
    reject = false;
    await publishMeal(f.team.id, f.s.id, f.u.id, "discord", base);
    await participantAction(f.team.id, f.s.id, f.s.shareToken, "respond", {
      name: "Private name",
      attendance: "join",
      allergies: "Private allergy",
    });
    await publishMeal(f.team.id, f.s.id, f.u.id, "discord", base);
    assert.equal(calls[2].method, "PATCH");
    assert.match(calls[2].url, /message-1$/);
    assert.ok(!calls[2].body.includes("Private"));
    const before = calls.length;
    await publishMeal(f.team.id, f.s.id, f.u.id, "discord", base);
    assert.equal(calls.length, before);
  } finally {
    restore();
  }
});
test("uncertain initial publication never blindly retries", async () => {
  const f = await setup();
  await connect(f);
  let calls = 0;
  const restore = mockProvider(async () => {
    calls++;
    throw Error("network outcome unknown");
  });
  try {
    await assert.rejects(
      publishMeal(f.team.id, f.s.id, f.u.id, "discord", base),
    );
    await assert.rejects(
      publishMeal(f.team.id, f.s.id, f.u.id, "discord", base),
      { status: 409 },
    );
    assert.equal(calls, 1);
  } finally {
    restore();
  }
});
test("weekly scheduler publishes fresh invitations and updates cancelled status", async () => {
  const f = await setup();
  await connect(f);
  await mutateTeam(f.team.id, f.u.id, "schedule", {
    nextRun: new Date(Date.now() + 10000).toISOString(),
  });
  const t = await readTeam(f.team.id);
  t.schedule.nextRun = Date.now() - 1000;
  await saveSecretSession(`teams:${t.id}`, t);
  const calls = [];
  const restore = mockProvider(async (url, o) => {
    calls.push(o);
    return new Response(JSON.stringify({ id: "scheduled-message" }));
  });
  try {
    await runTeamJobs(base, { teamIds: [t.id] });
    const after = await readTeam(t.id),
      s = after.sessions[0];
    assert.equal(s.state, "collecting");
    assert.equal(s.channelMessages.discord.id, "scheduled-message");
    const changed = await readTeam(t.id);
    changed.sessions[0].creatorId = "removed-organizer";
    await saveSecretSession(`teams:${t.id}`, changed);
    await mealAction(t.id, s.id, f.u.id, "cancel");
    await runTeamJobs(base, { teamIds: [t.id] });
    assert.ok(
      calls.some((c) => c.method === "PATCH" && c.body.includes("cancelled")),
    );
  } finally {
    restore();
  }
});
test("WhatsApp verifies raw signatures, replies once, sends only consented pending reminders and respects STOP", async () => {
  const f = await setup();
  const command = `MEAL ${f.team.id} ${f.s.id} ${f.s.shareToken} REMIND`;
  const payload = wa(f, command, "event1-" + f.s.id),
    raw = JSON.stringify(payload);
  const signature = `sha256=${crypto.createHmac("sha256", "wa-secret").update(raw).digest("hex")}`;
  assert.equal(
    verifyWhatsApp({ "x-hub-signature-256": signature }, raw),
    undefined,
  );
  assert.throws(
    () => verifyWhatsApp({ "x-hub-signature-256": signature }, raw + " "),
    { status: 401 },
  );
  let sent = [];
  const restore = mockProvider(async (url, o) => {
    sent.push(JSON.parse(o.body));
    return new Response(JSON.stringify({ messages: [{ id: "wa-result" }] }));
  });
  try {
    await whatsappEvents(payload, base);
    await whatsappEvents(payload, base);
    assert.equal(sent.length, 1);
    const link = sent[0].text.body.match(/https:\/\/\S+/)[0],
      hashParams = new URLSearchParams(new URL(link).hash.slice(1));
    const pt = hashParams.get("participant");
    assert.ok(pt);
    const a = await remindMeal(f.team.id, f.s.id, f.u.id, base);
    assert.equal(a.sent, 1);
    assert.equal(sent[1].type, "template");
    await remindMeal(f.team.id, f.s.id, f.u.id, base);
    assert.equal(sent.length, 2);
    await whatsappEvents(wa(f, "STOP"), base);
    assert.equal(
      (
        await getSecretSession(
          `wa-optout:${crypto.createHash("sha256").update(f.phone).digest("hex")}`,
        )
      ).stopped,
      true,
    );
    const t = await readTeam(f.team.id);
    for (const sub of Object.values(t.sessions[0].whatsapp))
      delete sub.reminderAttempted;
    await saveSecretSession(`teams:${t.id}`, t);
    await remindMeal(f.team.id, f.s.id, f.u.id, base);
    assert.equal(sent.length, 2);
    await participantAction(f.team.id, f.s.id, f.s.shareToken, "respond", {
      participantToken: pt,
      name: "Me",
      attendance: "skip",
    });
    await mealAction(f.team.id, f.s.id, f.u.id, "cancel");
    await participantAction(f.team.id, f.s.id, f.s.shareToken, "forget", {
      participantToken: pt,
    });
    assert.equal(
      Object.keys((await readTeam(t.id)).sessions[0].whatsapp).length,
      0,
    );
  } finally {
    restore();
  }
});
test("a WhatsApp request without reminder consent and a participant who responded receive no reminders", async () => {
  const f = await setup();
  let sent = [];
  const restore = mockProvider(async (url, o) => {
    sent.push(JSON.parse(o.body));
    return new Response(JSON.stringify({ messages: [{ id: "wa" }] }));
  });
  try {
    await whatsappEvents(
      wa(
        f,
        `MEAL ${f.team.id} ${f.s.id} ${f.s.shareToken}`,
        "no-consent-" + f.s.id,
        "919999999999",
      ),
      base,
    );
    assert.equal((await remindMeal(f.team.id, f.s.id, f.u.id, base)).sent, 0);
    const fragment = new URLSearchParams(
      new URL(sent[0].text.body.match(/https:\/\/\S+/)[0]).hash.slice(1),
    );
    await participantAction(f.team.id, f.s.id, f.s.shareToken, "respond", {
      participantToken: fragment.get("participant"),
      name: "Me",
      attendance: "join",
    });
    const t = await readTeam(f.team.id);
    for (const sub of Object.values(t.sessions[0].whatsapp)) sub.consent = true;
    await saveSecretSession(`teams:${t.id}`, t);
    assert.equal((await remindMeal(f.team.id, f.s.id, f.u.id, base)).sent, 0);
  } finally {
    restore();
  }
});
test("channel pairing is consumed once and a different office cannot take over a connected channel", async () => {
  const f = await setup();
  const pairing = await pairChannel(f.team.id, f.u.id, "discord");
  const text = pairing.command.replace("/moodish ", "");
  const payload = {
    guild_id: "guild" + f.s.id,
    channel_id: "channel" + f.s.id,
    member: { user: { id: "actor" } },
    data: { options: [{ name: "text", value: text }] },
  };
  const connected = await teamChannelCommand("discord", payload, base);
  assert.equal(connected.data.flags, 64);
  await assert.rejects(teamChannelCommand("discord", payload, base), {
    status: 403,
  });
  const other = await setup();
  const pair2 = await pairChannel(other.team.id, other.u.id, "discord");
  payload.data.options[0].value = pair2.command.replace("/moodish ", "");
  await assert.rejects(teamChannelCommand("discord", payload, base), {
    status: 409,
  });
  payload.data.options[0].value = "lunch";
  const lunch = await teamChannelCommand("discord", payload, base);
  assert.equal(lunch.data.flags, 64);
  assert.ok(
    (await readTeam(f.team.id)).sessions[0].publishTo.includes("discord"),
  );
});
test("Slack OAuth installation binds state to owner and never returns the bot token", async () => {
  const f = await setup();
  const start = await slackInstallStart(f.team.id, f.u.id, base);
  const state = new URL(start.url).searchParams.get("state");
  await assert.rejects(slackInstallComplete("code", state, "other-user"), {
    status: 403,
  });
  const restore = mockProvider(
    async () =>
      new Response(
        JSON.stringify({
          ok: true,
          team: { id: "T1" },
          authed_user: { id: "U1" },
          access_token: "sensitive-bot-token",
        }),
      ),
  );
  try {
    const result = await slackInstallComplete("code", state, f.u.id);
    assert.ok(!JSON.stringify(result).includes("sensitive"));
    const stored = (await readTeam(f.team.id)).channels.slack;
    assert.notEqual(stored.token, "sensitive-bot-token");
    await assert.rejects(slackInstallComplete("code", state, f.u.id), {
      status: 403,
    });
  } finally {
    restore();
  }
});

test("concurrent channel pairing assigns exactly one workspace and replacement releases the old channel", async () => {
  const a = await setup(),
    b = await setup();
  const codes = await Promise.all([
    pairChannel(a.team.id, a.u.id, "discord"),
    pairChannel(b.team.id, b.u.id, "discord"),
  ]);
  const guild = "race-guild-" + a.s.id,
    channel = "race-channel-" + a.s.id;
  const payload = (command, c = channel) => ({
    guild_id: guild,
    channel_id: c,
    member: { user: { id: "actor" } },
    data: {
      options: [{ name: "text", value: command.replace("/moodish ", "") }],
    },
  });
  const results = await Promise.allSettled(
    codes.map((c) => teamChannelCommand("discord", payload(c.command), base)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const winner = results[0].status === "fulfilled" ? a : b,
    loser = winner === a ? b : a;
  const fresh = await pairChannel(winner.team.id, winner.u.id, "discord");
  await teamChannelCommand(
    "discord",
    payload(fresh.command, channel + "-new"),
    base,
  );
  await mutateTeam(winner.team.id, winner.u.id, "disconnect", {
    platform: "discord",
  });
  const next = await pairChannel(loser.team.id, loser.u.id, "discord");
  await teamChannelCommand("discord", payload(next.command), base);
  assert.equal(
    (await getSecretSession(`team-channel:discord:${guild}:${channel}`)).teamId,
    loser.team.id,
  );
});
