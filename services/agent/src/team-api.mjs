import crypto from "node:crypto";
import { issueAuthCookie } from "./auth.mjs";
import { databaseReady } from "./memory.mjs";
import { authorizeTeamJob, runTeamJobs } from "./team-jobs.mjs";
import { suggestTeamMeals } from "./team-suggestions.mjs";
import {
  createTeam,
  listTeams,
  readTeam,
  viewTeam,
  mutateTeam,
  acceptTeamInvite,
  mealView,
  mealAction,
  participantAction,
  reportTeam,
} from "./team-service.mjs";
import {
  publishMeal,
  channelReadiness,
  slackInstallStart,
  slackInstallComplete,
  pairChannel,
  verifyWhatsApp,
  whatsappEvents,
  remindMeal,
} from "./team-channels.mjs";
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
export async function handleTeamApi({
  req,
  res,
  url,
  user,
  base,
  readJson,
  readRaw,
  send,
}) {
  if (
    !url.pathname.startsWith("/api/teams") &&
    !url.pathname.startsWith("/api/team-join") &&
    url.pathname !== "/api/platforms/whatsapp/events"
  )
    return false;
  const reply = (data, status = 200) => {
    send(res, status, data);
    return true;
  };
  const signed = () => {
    if (!user || user.id === "demo:moodish")
      throw fail("Sign in to manage an office workspace", 401);
    return user;
  };
  if (process.env.NODE_ENV === "production" && !(await databaseReady()).durable)
    throw fail(
      "Team workspaces require durable PostgreSQL storage in production",
      503,
    );
  if (url.pathname === "/api/teams/demo" && req.method === "POST") {
    if ((process.env.SWIGGY_MODE || "fixture") !== "fixture")
      throw fail("Demo is disabled in live mode", 403);
    const demo = {
      id: `teams-demo:${crypto.randomUUID()}`,
      name: "Workspace preview",
      provider: "demo",
    };
    send(res, 200, { user: demo }, { "set-cookie": issueAuthCookie(demo) });
    return true;
  }
  if (url.pathname === "/api/platforms/whatsapp/events") {
    if (req.method === "GET") {
      if (
        !process.env.WHATSAPP_VERIFY_TOKEN ||
        url.searchParams.get("hub.verify_token") !==
          process.env.WHATSAPP_VERIFY_TOKEN ||
        url.searchParams.get("hub.mode") !== "subscribe"
      )
        throw fail("Invalid verification token", 403);
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(url.searchParams.get("hub.challenge") || "");
      return true;
    }
    if (req.method === "POST") {
      const raw = await readRaw(req);
      verifyWhatsApp(req.headers, raw);
      return reply(await whatsappEvents(JSON.parse(raw), base));
    }
  }
  if (url.pathname === "/api/teams/jobs" && req.method === "POST") {
    authorizeTeamJob(req.headers["x-moodish-jobs-secret"]);
    return reply(await runTeamJobs(base));
  }
  if (url.pathname === "/api/teams/slack/callback" && req.method === "GET") {
    const result = await slackInstallComplete(
      url.searchParams.get("code"),
      url.searchParams.get("state"),
      signed().id,
    );
    res.writeHead(302, { location: `/teams.html?team=${result.teamId}` });
    res.end();
    return true;
  }
  if (url.pathname === "/api/teams/channels" && req.method === "GET")
    return reply({
      channels: channelReadiness(),
      schedulerEnabled: process.env.TEAM_JOBS_ENABLED === "true",
      whatsappNumber: process.env.WHATSAPP_PUBLIC_NUMBER || null,
    });
  const join = url.pathname.match(/^\/api\/team-join\/([\w-]+)\/([\w-]+)$/);
  if (join && req.method === "POST") {
    const b = await readJson(req);
    return reply(
      await participantAction(join[1], join[2], b.token, b.action || "view", b),
    );
  }
  if (url.pathname === "/api/teams") {
    const u = signed();
    if (req.method === "GET") return reply({ teams: await listTeams(u.id) });
    if (req.method === "POST") {
      const t = await createTeam(u, await readJson(req));
      return reply(viewTeam(t, u.id), 201);
    }
  }
  const route = url.pathname.match(
    /^\/api\/teams\/([\w-]+)(?:\/([\w-]+))?(?:\/([\w-]+))?(?:\/([\w-]+))?$/,
  );
  if (route) {
    const [, teamId, action, sessionId, mealCommand] = route,
      u = signed();
    if (req.method === "GET" && !action)
      return reply(viewTeam(await readTeam(teamId), u.id));
    if (req.method === "GET" && action === "report")
      return reply(await reportTeam(teamId, u.id));
    if (req.method === "GET" && action === "meals" && sessionId)
      return reply(await mealView(teamId, sessionId, u.id));
    if (req.method === "POST") {
      const body = await readJson(req);
      if (action === "accept")
        return reply(await acceptTeamInvite(teamId, u.id, body.token));
      if (["slack-install", "pair"].includes(action) && u.provider === "demo")
        throw fail(
          "Use Google sign-in to connect a real workplace channel",
          403,
        );
      if (action === "slack-install")
        return reply(await slackInstallStart(teamId, u.id, base));
      if (action === "pair")
        return reply(await pairChannel(teamId, u.id, body.platform));
      if (action === "meals" && sessionId) {
        if (mealCommand === "publish")
          return reply(
            await publishMeal(teamId, sessionId, u.id, body.platform, base),
          );
        if (mealCommand === "suggest")
          return reply(await suggestTeamMeals(teamId, sessionId, u.id));
        if (mealCommand === "remind")
          return reply(await remindMeal(teamId, sessionId, u.id, base));
        return reply(
          await mealAction(teamId, sessionId, u.id, mealCommand, body),
        );
      }
      return reply(await mutateTeam(teamId, u.id, action, body));
    }
  }
  throw fail("Unknown Teams endpoint", 404);
}
