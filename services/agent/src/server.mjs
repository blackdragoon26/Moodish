import http from "node:http";
import { URL } from "node:url";
import { loadLocalEnv } from "./env.mjs";
import { createTools } from "./tools.mjs";
import {
  clearTeamHistory,
  deleteTasteMemory,
  getAuditLogs,
  getPlatformEventResponse,
  getTasteProfile,
  savePlatformEventResponse,
  updateTasteProfile
} from "./memory.mjs";
import { platformCommandToSession, verifyPlatformRequest } from "./platform-adapters.mjs";
import { completeSwiggyOAuth, getSwiggyConnectionStatus, startSwiggyOAuth } from "./swiggy-auth.mjs";
import { signGroupAccessToken, verifyGroupAccessToken } from "./access-token.mjs";
import { completePlatformOAuth, startPlatformOAuth } from "./platform-oauth.mjs";
import {
  authConfiguration,
  clearAuthCookie,
  completeGoogleOAuth,
  demoUser,
  issueAuthCookie,
  readAuthUser,
  startGoogleOAuth
} from "./auth.mjs";
import { continueMealConversation } from "./conversation.mjs";
import crypto from "node:crypto";
import { resolvePublicOrigin } from "./public-origin.mjs";

loadLocalEnv();
const tools = createTools();

export function createServer() {
  return http.createServer(handleAgentRequest);
}

export async function handleAgentRequest(req, res) {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "OPTIONS") return send(res, 204, {});
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, {
        ok: true,
        service: "moodish-agent",
        swiggyMode: process.env.SWIGGY_MODE || "fixture",
        aiProvider: process.env.AI_PROVIDER || "mock"
      });
    }
    if (req.method === "GET" && url.pathname === "/api/auth/config") {
      return send(res, 200, authConfiguration());
    }
    if (req.method === "GET" && url.pathname === "/api/auth/me") {
      return send(res, 200, { user: readAuthUser(req.headers.cookie) });
    }
    if (req.method === "POST" && url.pathname === "/api/auth/demo") {
      const user = demoUser();
      return send(res, 200, { user }, { "set-cookie": issueAuthCookie(user) });
    }
    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      return send(res, 200, { loggedOut: true }, { "set-cookie": clearAuthCookie() });
    }
    if (req.method === "GET" && url.pathname === "/api/auth/google/start") {
      return redirect(res, startGoogleOAuth(resolvePublicOrigin(req)));
    }
    if (req.method === "GET" && url.pathname === "/api/auth/google/callback") {
      const user = await completeGoogleOAuth({
        code: url.searchParams.get("code"),
        state: url.searchParams.get("state")
      });
      return redirect(res, "/?login=google", { "set-cookie": issueAuthCookie(user) });
    }
    if (req.method === "GET" && url.pathname === "/api/auth/swiggy/start") {
      const sessionId = `auth_${crypto.randomUUID()}`;
      const started = await startSwiggyOAuth({
        sessionId,
        redirectUri: `${resolvePublicOrigin(req)}/api/auth/swiggy/callback`
      });
      return redirect(res, started.authorizationUrl);
    }
    if (req.method === "GET" && url.pathname === "/api/auth/swiggy/callback") {
      const connected = await completeSwiggyOAuth({
        code: url.searchParams.get("code"),
        state: url.searchParams.get("state")
      });
      const user = { id: `swiggy:${connected.sessionId}`, name: "Swiggy member", provider: "swiggy" };
      return redirect(res, "/?login=swiggy", { "set-cookie": issueAuthCookie(user) });
    }
    if (req.method === "GET" && url.pathname === "/api/profile") {
      return send(res, 200, await getTasteProfile(url.searchParams.get("userIdHash") || undefined));
    }
    if (req.method === "GET" && url.pathname === "/api/swiggy/connection") {
      return send(res, 200, await getSwiggyConnectionStatus(url.searchParams.get("sessionId") || undefined));
    }
    if (req.method === "POST" && url.pathname === "/api/swiggy/oauth/start") {
      const body = await readJson(req);
      return send(
        res,
        200,
        await startSwiggyOAuth({
          ...body,
          redirectUri: body.redirectUri || `${resolvePublicOrigin(req)}/api/swiggy/oauth/callback`
        })
      );
    }
    if (req.method === "GET" && url.pathname === "/api/swiggy/oauth/callback") {
      return send(
        res,
        200,
        await completeSwiggyOAuth({ code: url.searchParams.get("code"), state: url.searchParams.get("state") })
      );
    }
    if (req.method === "POST" && url.pathname === "/api/profile") {
      const body = await readJson(req);
      return send(res, 200, await updateTasteProfile(body.userIdHash, body.patch || body));
    }
    if (req.method === "POST" && url.pathname === "/api/recommendations/personal") {
      return send(res, 200, await tools.plan_personal_meal(await readJson(req)));
    }
    if (req.method === "POST" && url.pathname === "/api/planner/chat") {
      const body = await readJson(req);
      const authUser = readAuthUser(req.headers.cookie);
      return send(
        res,
        200,
        await continueMealConversation(
          { ...body, userIdHash: body.userIdHash || authUser?.id || undefined },
          tools
        )
      );
    }
    if (req.method === "POST" && url.pathname === "/api/recommendations/office") {
      return send(res, 200, await tools.plan_office_lunch(await readJson(req)));
    }
    if (req.method === "POST" && url.pathname === "/api/cart/confirm") {
      return send(res, 200, await tools.build_confirmed_cart(await readJson(req)));
    }
    if (req.method === "POST" && url.pathname === "/api/feedback") {
      return send(res, 200, await tools.record_meal_feedback(await readJson(req)));
    }
    const platformMatch = url.pathname.match(/^\/api\/platforms\/(slack|teams|discord)\/events$/);
    if (req.method === "POST" && platformMatch) {
      const platform = platformMatch[1];
      const rawBody = await readRaw(req);
      await verifyPlatformRequest(platform, { headers: req.headers, rawBody });
      const payload = platform === "slack" ? rawBody : JSON.parse(rawBody || "{}");
      const command = platformCommandToSession(platform, payload, resolvePublicOrigin(req));
      if (command.ping) return send(res, 200, command.response());
      const cachedResponse = await getPlatformEventResponse(command.dedupeKey);
      if (cachedResponse) return send(res, 200, cachedResponse);
      const session = await tools.create_group_meal_session(command.args);
      const response = command.response(session);
      await savePlatformEventResponse(command.dedupeKey, response);
      return send(res, 200, response);
    }
    const platformOauthMatch = url.pathname.match(/^\/api\/platforms\/(slack|teams|discord)\/oauth\/(start|callback)$/);
    if (req.method === "GET" && platformOauthMatch) {
      const [, platform, action] = platformOauthMatch;
      if (action === "start") {
        const started = startPlatformOAuth(platform, {
          sessionId: url.searchParams.get("sessionId"),
          redirectUri: `${resolvePublicOrigin(req)}/api/platforms/${platform}/oauth/callback`
        });
        res.writeHead(302, { location: started.authorizationUrl });
        return res.end();
      }
      const completed = await completePlatformOAuth(platform, {
        code: url.searchParams.get("code"),
        state: url.searchParams.get("state")
      });
      const destination = `/?group=${encodeURIComponent(completed.sessionId)}#access_token=${encodeURIComponent(completed.accessToken)}`;
      res.writeHead(302, { location: destination });
      return res.end();
    }
    if (req.method === "POST" && url.pathname === "/api/group-sessions") {
      const body = await readJson(req);
      if (body.platform && body.platform !== "web") {
        const error = new Error("Slack, Teams, and Discord sessions must be created through their verified bot webhook");
        error.status = 400;
        throw error;
      }
      const session = await tools.create_group_meal_session({ ...body, platform: "web" });
      return send(res, 201, {
        ...session,
        accessToken: signGroupAccessToken({ sessionId: session.sessionId, actorId: session.creatorId })
      });
    }
    const groupMatch = url.pathname.match(/^\/api\/group-sessions\/([^/]+)(?:\/([^/]+))?$/);
    if (groupMatch) {
      const [, sessionId, action] = groupMatch;
      if (req.method === "GET" && !action) {
        const identity = optionalGroupIdentity(req, sessionId);
        return send(
          res,
          200,
          await tools.get_group_meal_session({ sessionId, actorId: identity?.actorId })
        );
      }
      if (req.method === "POST") {
        const body = { ...(await readJson(req)), sessionId };
        const actions = {
          preferences: "submit_group_preferences",
          rank: "rank_group_meal",
          vote: "vote_group_option",
          select: "select_group_option",
          "confirm-cart": "confirm_group_cart",
          cancel: "cancel_group_meal_session"
        };
        const toolName = actions[action];
        if (toolName) {
          if (["rank", "select", "confirm-cart", "cancel"].includes(action)) {
            body.actorId = requireGroupIdentity(req, sessionId).actorId;
          }
          return send(res, 200, await tools[toolName](body));
        }
      }
    }
    if (req.method === "GET" && url.pathname === "/api/audit") {
      return send(res, 200, { logs: await getAuditLogs() });
    }
    if (req.method === "POST" && url.pathname === "/api/privacy/delete-taste-memory") {
      const body = await readJson(req);
      return send(res, 200, await deleteTasteMemory(body.userIdHash));
    }
    if (req.method === "POST" && url.pathname === "/api/privacy/clear-team-history") {
      const body = await readJson(req);
      return send(res, 200, await clearTeamHistory(body.teamId));
    }
    if (req.method === "POST" && url.pathname === "/mcp") {
      return send(res, 200, await handleJsonRpc(await readJson(req)));
    }
    return send(res, 404, { error: "Not found" });
  } catch (error) {
    return send(res, error.status || 500, { error: error.message, details: error.details });
  }
}

function requireGroupIdentity(req, sessionId) {
  const identity = optionalGroupIdentity(req, sessionId);
  if (!identity) return verifyGroupAccessToken("", sessionId);
  return identity;
}

function optionalGroupIdentity(req, sessionId) {
  const authorization = req.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) return null;
  return verifyGroupAccessToken(authorization.slice(7), sessionId);
}

async function handleJsonRpc(message) {
  if (message.method !== "tools/call") {
    return { jsonrpc: "2.0", id: message.id ?? null, error: { code: -32601, message: "Only tools/call is supported" } };
  }
  const name = message.params?.name;
  const args = message.params?.arguments || {};
  if (!tools[name]) {
    return { jsonrpc: "2.0", id: message.id ?? null, error: { code: -32601, message: `Unknown tool ${name}` } };
  }
  try {
    const data = await tools[name](args);
    return { jsonrpc: "2.0", id: message.id ?? null, result: { success: true, data } };
  } catch (error) {
    return { jsonrpc: "2.0", id: message.id ?? null, result: { success: false, error: { message: error.message } } };
  }
}

function send(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    ...extraHeaders
  });
  res.end(status === 204 ? "" : JSON.stringify(payload, null, 2));
}

function redirect(res, location, extraHeaders = {}) {
  res.writeHead(302, { location, ...extraHeaders });
  res.end();
}

async function readJson(req) {
  const raw = await readRaw(req);
  if (!raw) return {};
  return JSON.parse(raw);
}

async function readRaw(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.MOODISH_PORT || 8786);
  createServer().listen(port, "127.0.0.1", () => {
    console.log(`Moodish agent listening on http://127.0.0.1:${port}`);
  });
}
