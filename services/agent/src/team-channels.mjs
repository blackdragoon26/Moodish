import { parseTeamCommand } from "./team-command.mjs";
import crypto from "node:crypto";
import {
  getSecretSession,
  saveSecretSession,
  withAccountLock,
} from "./memory.mjs";
import {
  readTeam,
  requireRole,
  mutateTeam,
  participantAction,
  mealView,
} from "./team-service.mjs";
import { encryptToken, decryptToken } from "./swiggy-auth.mjs";
import {
  newFlowSecrets,
  saveFlow,
  peekFlow,
  claimFlow,
} from "./login-flows.mjs";
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const save = (t) => saveSecretSession(`teams:${t.id}`, t);
export function channelReadiness() {
  return {
    slack: Boolean(
      process.env.SLACK_CLIENT_ID &&
      process.env.SLACK_CLIENT_SECRET &&
      process.env.SLACK_SIGNING_SECRET &&
      process.env.TOKEN_ENCRYPTION_KEY,
    ),
    discord: Boolean(
      process.env.DISCORD_CLIENT_ID &&
      process.env.DISCORD_PUBLIC_KEY &&
      process.env.DISCORD_BOT_TOKEN,
    ),
    whatsapp: Boolean(
      process.env.WHATSAPP_ACCESS_TOKEN &&
      process.env.WHATSAPP_PHONE_NUMBER_ID &&
      process.env.WHATSAPP_APP_SECRET &&
      process.env.WHATSAPP_VERIFY_TOKEN &&
      process.env.WHATSAPP_GRAPH_VERSION &&
      process.env.TOKEN_ENCRYPTION_KEY,
    ),
  };
}
export async function slackInstallStart(teamId, userId, base) {
  const team = await readTeam(teamId);
  requireRole(team, userId, ["owner"]);
  if (!channelReadiness().slack)
    throw fail("Slack installation credentials are not configured", 503);
  const { state } = newFlowSecrets();
  const redirectUri = `${base}/api/teams/slack/callback`;
  await saveFlow("teams-slack", state, {
    teamId,
    userId,
    redirectUri,
    expiresAt: Date.now() + 600000,
  });
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.search = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID,
    scope: "commands,chat:write",
    redirect_uri: redirectUri,
    state,
  }).toString();
  return { url: url.toString() };
}
export async function slackInstallComplete(code, state, userId) {
  const flow = await peekFlow("teams-slack", state);
  if (!flow || flow.userId !== userId || flow.expiresAt <= Date.now())
    throw fail("Installation expired or belongs to another account", 403);
  if (!(await claimFlow("teams-slack", state)))
    throw fail("Installation already consumed", 409);
  const data = await provider("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID,
      client_secret: process.env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: flow.redirectUri,
    }),
  });
  if (!data.team?.id || !data.authed_user?.id || !data.access_token)
    throw fail("Incomplete Slack installation response", 502);
  await withAccountLock(`teams:${flow.teamId}`, async () => {
    const team = await readTeam(flow.teamId);
    requireRole(team, userId, ["owner"]);
    team.channels ||= {};
    const previous = team.channels.slack;
    if (previous?.channelId && previous.workspaceId !== data.team.id) {
      const key = `team-channel:slack:${previous.workspaceId}:${previous.channelId}`;
      await withAccountLock(key, async () => {
        const bound = await getSecretSession(key);
        if (bound?.teamId === team.id) await saveSecretSession(key, null);
      });
    }
    team.channels.slack = {
      ...(previous?.workspaceId === data.team.id ? previous : {}),
      workspaceId: data.team.id,
      actorId: data.authed_user.id,
      token: encryptToken(data.access_token),
    };
    await save(team);
  });
  return { teamId: flow.teamId };
}
export async function pairChannel(teamId, userId, platform) {
  const team = await readTeam(teamId);
  requireRole(team, userId, ["owner"]);
  if (!["slack", "discord"].includes(platform) || !channelReadiness()[platform])
    throw fail("Channel is not configured", 503);
  if (platform === "slack" && !team.channels?.slack)
    throw fail("Install Slack first");
  const token = crypto.randomBytes(24).toString("base64url");
  await saveFlow("team-pair", token, {
    teamId,
    userId,
    platform,
    expiresAt: Date.now() + 600000,
  });
  return {
    command: `/moodish connect ${token}`,
    expiresIn: 600,
    installUrl:
      platform === "discord"
        ? `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(process.env.DISCORD_CLIENT_ID)}&scope=bot%20applications.commands&permissions=3072`
        : undefined,
  };
}
export async function teamChannelCommand(platform, payload, base) {
  const p = platform === "slack" ? new URLSearchParams(payload) : payload;
  const content =
    platform === "slack"
      ? p.get("text")
      : p.data?.options?.find((o) => o.name === "text")?.value;
  const workspaceId = platform === "slack" ? p.get("team_id") : p.guild_id;
  const channelId = platform === "slack" ? p.get("channel_id") : p.channel_id;
  const actorId = platform === "slack" ? p.get("user_id") : p.member?.user?.id;
  if (!workspaceId || !channelId || !actorId)
    throw fail("Use a workspace channel");
  const reply = (text) =>
    platform === "slack"
      ? { response_type: "ephemeral", text }
      : {
          type: 4,
          data: { content: text, flags: 64, allowed_mentions: { parse: [] } },
        };
  const command = String(content || "").trim();
  if (command.startsWith("connect ")) {
    const token = command.slice(8).trim(),
      flow = await peekFlow("team-pair", token);
    if (!flow || flow.platform !== platform || flow.expiresAt <= Date.now())
      throw fail("Connection code expired", 403);
    await withAccountLock(`teams:${flow.teamId}`, async () => {
      const team = await readTeam(flow.teamId);
      requireRole(team, flow.userId, ["owner"]);
      if (
        platform === "slack" &&
        (team.channels?.slack?.workspaceId !== workspaceId ||
          team.channels.slack.actorId !== actorId)
      )
        throw fail(
          "Connect using the Slack account that installed Moodish",
          403,
        );
      await withAccountLock(
        `team-channel:${platform}:${workspaceId}:${channelId}`,
        async () => {
          const bound = await getSecretSession(
            `team-channel:${platform}:${workspaceId}:${channelId}`,
          );
          if (bound && bound.teamId !== team.id)
            throw fail(
              "This channel is already connected to another office. Disconnect it there first.",
              409,
            );
          if (!(await claimFlow("team-pair", token)))
            throw fail("Connection code already used", 409);
          const prior = team.channels?.[platform];
          if (
            prior?.channelId &&
            (prior.channelId !== channelId || prior.workspaceId !== workspaceId)
          ) {
            const priorKey = `team-channel:${platform}:${prior.workspaceId}:${prior.channelId}`;
            await withAccountLock(priorKey, async () => {
              const previous = await getSecretSession(priorKey);
              if (previous?.teamId === team.id)
                await saveSecretSession(priorKey, null);
            });
          }
          team.channels ||= {};
          team.channels[platform] = {
            ...team.channels[platform],
            workspaceId,
            channelId,
            actorId,
            userId: flow.userId,
          };
          await save(team);
          await saveSecretSession(
            `team-channel:${platform}:${workspaceId}:${channelId}`,
            { teamId: team.id },
          );
        },
      );
    });
    return reply(
      "Connected to Moodish for Teams. Run /moodish lunch to open a meal using your saved office settings.",
    );
  }
  const binding = await getSecretSession(
    `team-channel:${platform}:${workspaceId}:${channelId}`,
  );
  if (!binding)
    return command === "lunch"
      ? reply(
          "Connect this channel from your Moodish for Teams workspace before starting lunch.",
        )
      : null;
  const team = await readTeam(binding.teamId),
    connection = team?.channels?.[platform];
  if (
    !connection ||
    connection.channelId !== channelId ||
    connection.workspaceId !== workspaceId
  )
    return reply("This channel connection has been removed.");
  if (connection.actorId !== actorId)
    return reply(
      "Only the workspace connector can start meals here. Ask your organizer for the participation link.",
    );
  const options = parseTeamCommand(command);
  if (!options)
    return reply(
      "Use /moodish lunch. Edit budgets, cutoff and office defaults in Moodish for Teams.",
    );
  const s = await mutateTeam(team.id, connection.userId, "create-meal", {
    ...options,
    publish: true,
  });
  const link = `${base}/teams.html?team=${team.id}&meal=${s.id}#join=${s.shareToken}`;
  const message = `Team lunch · ₹${s.budgetPerPerson} per person · respond by ${new Date(s.deadline).toISOString()}\nJoin or skip privately: ${link}\nOrganizer: ${base}/teams.html?team=${team.id}`;
  return reply(
    `Meal created. The shared status card will publish on the next scheduler run.\n${message}`,
  );
}
export function verifyWhatsApp(headers, raw) {
  if (!channelReadiness().whatsapp)
    throw fail("WhatsApp is not configured", 503);
  const expected = Buffer.from(
      `sha256=${crypto.createHmac("sha256", process.env.WHATSAPP_APP_SECRET).update(raw).digest("hex")}`,
    ),
    given = Buffer.from(headers["x-hub-signature-256"] || "");
  if (
    expected.length !== given.length ||
    !crypto.timingSafeEqual(expected, given)
  )
    throw fail("Invalid WhatsApp signature", 401);
}
async function whatsappSend(phone, body) {
  const version = process.env.WHATSAPP_GRAPH_VERSION;
  if (!/^v\d+\.\d+$/.test(version || ""))
    throw fail("WHATSAPP_GRAPH_VERSION must be configured", 503);
  return provider(
    `https://graph.facebook.com/${version}/${encodeURIComponent(process.env.WHATSAPP_PHONE_NUMBER_ID)}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone,
        ...body,
      }),
    },
  );
}
export async function whatsappEvents(payload, base) {
  for (const entry of payload.entry || [])
    for (const change of entry.changes || []) {
      if (
        change.value?.metadata?.phone_number_id !==
        process.env.WHATSAPP_PHONE_NUMBER_ID
      )
        continue;
      for (const message of change.value?.messages || []) {
        if (
          !message.id ||
          !/^\d{6,20}$/.test(message.from || "") ||
          message.type !== "text"
        )
          continue;
        await withAccountLock(`wa-event:${message.id}`, async () => {
          if (await getSecretSession(`wa-event:${message.id}`)) return;
          const phoneKey = digest(message.from),
            content = String(message.text?.body || "").trim();
          if (content.toUpperCase() === "STOP") {
            await saveSecretSession(`wa-optout:${phoneKey}`, { stopped: true });
          } else {
            const match = content.match(
              /^MEAL ([\w-]+) ([\w-]+) ([\w-]+)( REMIND)?$/,
            );
            if (!match) return;
            const [, teamId, sessionId, token, remind] = match;
            await participantAction(teamId, sessionId, token);
            const privateToken = crypto.randomBytes(24).toString("base64url");
            await withAccountLock(`teams:${teamId}`, async () => {
              const team = await readTeam(teamId),
                s = team.sessions.find((s) => s.id === sessionId);
              s.whatsapp ||= {};
              const old = s.whatsapp[phoneKey];
              if (!old && Object.keys(s.whatsapp).length >= 100)
                throw fail("Subscriber limit reached", 409);
              s.whatsapp[phoneKey] = old || {
                phone: encryptToken(message.from),
                participantToken: encryptToken(privateToken),
                participantHash: digest(privateToken),
                consent: !!remind,
                subscribedAt: Date.now(),
              };
              if (remind) s.whatsapp[phoneKey].consent = true;
              const pt = old
                ? decryptToken(old.participantToken)
                : privateToken;
              if (
                !s.participants[digest(pt)] &&
                Object.keys(s.participants).length >= 100
              )
                throw fail("Response limit reached", 409);
              s.participants[digest(pt)] ||= {
                attendance: "pending",
                name: "",
                muted: false,
              };
              await save(team);
            });
            const t = await readTeam(teamId),
              s = t.sessions.find((s) => s.id === sessionId),
              pt = decryptToken(s.whatsapp[phoneKey].participantToken);
            const link = `${base}/teams.html?team=${teamId}&meal=${sessionId}#join=${token}&participant=${pt}`;
            // This is a direct reply to the user's inbound request, not an unsolicited reminder.
            await saveSecretSession(`wa-event:${message.id}`, {
              at: Date.now(),
              attempted: true,
            });
            try {
              await whatsappSend(message.from, {
                type: "text",
                text: {
                  body: `Your private meal link: ${link}\nReply STOP to opt out of WhatsApp reminders. You can also mute them on the meal page.${remind ? " You opted in to one reminder." : ""}`,
                },
              });
            } catch (error) {
              if (error.definitiveRejection)
                await saveSecretSession(`wa-event:${message.id}`, null);
              throw error;
            }
          }
          await saveSecretSession(`wa-event:${message.id}`, { at: Date.now() });
        });
      }
    }
  return { received: true };
}
export async function remindMeal(teamId, sessionId, userId, base) {
  const team = await readTeam(teamId);
  requireRole(team, userId, ["owner", "organizer"]);
  if (!process.env.WHATSAPP_REMINDER_TEMPLATE)
    throw fail("An approved WhatsApp reminder template is required", 503);
  let sent = 0,
    skipped = 0;
  const snapshot = await mealView(teamId, sessionId, userId);
  if (snapshot.state !== "collecting" || snapshot.deadline <= Date.now())
    throw fail("Responses are closed", 409);
  for (const phoneKey of Object.keys(
    team.sessions.find((s) => s.id === sessionId).whatsapp || {},
  )) {
    await withAccountLock(`teams:${teamId}`, async () => {
      const current = await readTeam(teamId),
        s = current.sessions.find((s) => s.id === sessionId),
        sub = s.whatsapp[phoneKey];
      const p = s.participants[digest(decryptToken(sub.participantToken))];
      if (
        s.state !== "collecting" ||
        Date.now() >= s.deadline ||
        sub.reminderAttempted ||
        !sub.consent ||
        p?.respondedAt ||
        p?.muted ||
        (await getSecretSession(`wa-optout:${phoneKey}`))?.stopped
      ) {
        skipped++;
        return;
      }
      // Mark before sending: ambiguous network failures must not cause duplicate reminders.
      sub.reminderAttempted = Date.now();
      await save(current);
      try {
        await whatsappSend(decryptToken(sub.phone), {
          type: "template",
          template: {
            name: process.env.WHATSAPP_REMINDER_TEMPLATE,
            language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en" },
            components: [
              {
                type: "body",
                parameters: [
                  {
                    type: "text",
                    text: `${base}/teams.html?team=${teamId}&meal=${sessionId}#join=${s.shareToken}&participant=${decryptToken(sub.participantToken)}`,
                  },
                ],
              },
            ],
          },
        });
        sent++;
      } catch (error) {
        if (error.definitiveRejection) {
          delete sub.reminderAttempted;
          await save(current);
        }
        throw error;
      }
    });
  }
  return { sent, skipped };
}
async function provider(url, options) {
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    const error = fail("Channel provider returned an invalid response", 502);
    error.definitiveRejection = response.status >= 400 && response.status < 500;
    throw error;
  }
  if (!response.ok || data.ok === false || data.error) {
    const error = fail(
      "Channel provider rejected the request; check provider configuration",
      502,
    );
    error.definitiveRejection = response.status < 500;
    throw error;
  }
  return data;
}

// Once published, update the same message. Unknown send outcomes are not retried
// automatically: doing so could create duplicate public invitations.
export async function publishMeal(teamId, sessionId, userId, platform, base) {
  return withAccountLock(
    `teams:${teamId}`,
    async () => {
      const team = await readTeam(teamId);
      requireRole(team, userId, ["owner", "organizer"]);
      const connection = team.channels?.[platform],
        s = team.sessions.find((s) => s.id === sessionId);
      if (
        !s ||
        !connection?.channelId ||
        !["slack", "discord"].includes(platform)
      )
        throw fail("Connect the destination channel first", 409);
      const binding = await getSecretSession(
        `team-channel:${platform}:${connection.workspaceId}:${connection.channelId}`,
      );
      if (binding?.teamId !== team.id)
        throw fail("This channel is no longer assigned to this workspace", 409);
      const content = channelStatusContent(teamId, s, base);
      s.channelMessages ||= {};
      const previous = s.channelMessages[platform];
      if (previous?.contentHash === digest(content)) return { updated: false };
      if (previous?.attempted && !previous.id)
        throw fail(
          "Previous publish outcome is unknown. Inspect the channel before trying another invitation.",
          409,
        );
      if (!previous) {
        s.channelMessages[platform] = {
          attempted: Date.now(),
          channelId: connection.channelId,
        };
        await save(team);
      }
      if (previous?.channelId && previous.channelId !== connection.channelId)
        throw fail(
          "The channel changed after publication. Use the existing invitation or start a new meal.",
          409,
        );
      let result;
      try {
        if (platform === "slack") {
          result = await provider(
            `https://slack.com/api/${previous?.id ? "chat.update" : "chat.postMessage"}`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${decryptToken(connection.token)}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                channel: connection.channelId,
                ...(previous?.id ? { ts: previous.id } : {}),
                text: content,
                unfurl_links: false,
                unfurl_media: false,
                blocks: [
                  {
                    type: "section",
                    text: { type: "plain_text", text: content },
                  },
                ],
              }),
            },
          );
        } else
          result = await provider(
            `https://discord.com/api/v10/channels/${connection.channelId}/messages${previous?.id ? "/" + previous.id : ""}`,
            {
              method: previous?.id ? "PATCH" : "POST",
              headers: {
                authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                content,
                allowed_mentions: { parse: [] },
              }),
            },
          );
      } catch (error) {
        if (error.definitiveRejection && !previous) {
          delete s.channelMessages[platform];
          await save(team);
        }
        throw error;
      }
      const messageId = platform === "slack" ? result.ts : result.id;
      if (!messageId)
        throw fail("Provider did not confirm the message identifier", 502);
      s.channelMessages[platform] = {
        id: messageId,
        channelId: connection.channelId,
        contentHash: digest(content),
      };
      await save(team);
      return { updated: !!previous, published: true };
    },
    { longRunning: true },
  );
}

export function channelStatusContent(teamId, s, base) {
  const joined = Object.values(s.participants).filter(
    (p) => p.attendance === "join",
  ).length;
  return `Team meal · ${joined}/${s.capacity} joining · ₹${s.budgetPerPerson} each · ${s.state === "collecting" && Date.now() >= s.deadline ? "responses closed" : s.state.replaceAll("_", " ")}\nCutoff: ${new Date(s.deadline).toISOString()}\nJoin / skip privately: ${base}/teams.html?team=${teamId}&meal=${s.id}#join=${s.shareToken}`;
}
export function needsChannelUpdate(teamId, s, platform, base) {
  return (
    s.channelMessages?.[platform]?.contentHash !==
    digest(channelStatusContent(teamId, s, base))
  );
}
