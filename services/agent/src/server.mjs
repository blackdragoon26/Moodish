import http from "node:http";
import { URL, pathToFileURL } from "node:url";
import { loadLocalEnv } from "./env.mjs";
import { createTools, createToolRuntime } from "./tools.mjs";
import {
  clearTeamHistory,
  deleteTasteMemory,
  getAuditLogs,
  getGroupSession,
  saveGroupSession,
  withAccountLock,
  databaseReady,
  getMealHistory,
  getPlatformEventResponse,
  getTasteProfile,
  savePlatformEventResponse,
  updateTasteProfile
} from "./memory.mjs";
import { platformCommandToSession, verifyPlatformRequest } from "./platform-adapters.mjs";
import { completeSwiggyOAuth, getSwiggyConnectionStatus, getSwiggyCredential, startSwiggyOAuth, disconnectSwiggy, selectSwiggyAddress, exchangeMobileCode } from "./swiggy-auth.mjs";
import { signGroupAccessToken, verifyGroupAccessToken } from "./access-token.mjs";
import { completePlatformOAuth, startPlatformOAuth } from "./platform-oauth.mjs";
import {
  authConfiguration,
  clearAuthCookie,
  completeGoogleOAuth,
  demoUser,
  issueAuthCookie,
  readAuthUser,
  signSessionToken,
  startGoogleOAuth
} from "./auth.mjs";
import { continueMealConversation } from "./conversation.mjs";
import crypto from "node:crypto";
import { realpathSync } from "node:fs";
import { resolvePublicOrigin } from "./public-origin.mjs";
import { DEFAULT_USER_HASH } from "./contracts.mjs";
import { assertRuntimeConfig } from "./config.mjs";
import { LOGIN_ERRORS, loginErrorReason } from "./login-flows.mjs";

// Only these tools are reachable through /mcp. Group tools take caller-supplied
// actor and passcode arguments, so they stay behind the signed group API.
const MCP_PERSONAL_TOOLS = new Set(["plan_personal_meal", "plan_office_lunch", "prepare_cart", "build_confirmed_cart", "update_taste_profile", "record_meal_feedback", "get_taste_memory"]);

loadLocalEnv();


export function createServer() {
  return http.createServer(handleAgentRequest);
}

export async function handleAgentRequest(req, res) {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    const authUser = readAuthUser(req.headers.cookie, req.headers["x-moodish-session"] ? `Bearer ${req.headers["x-moodish-session"]}` : req.headers.authorization);
    const live = process.env.SWIGGY_MODE === "live";
    const runtime = createToolRuntime({ userId: authUser?.id });
    const tools = createTools(runtime);
    const requireUser = () => { if (!authUser) throw Object.assign(new Error("Sign in to Moodish first"), { status: 401 }); return authUser; };
    const personal = async body => {
      if (live) requireUser();
      const connection = await getSwiggyConnectionStatus(authUser?.id);
      // Personal data is keyed only by the signed session. Without one, requests
      // share the anonymous demo profile and can never name another account.
      return { ...body, userIdHash: authUser?.id || DEFAULT_USER_HASH, addressId: body.addressId || connection.selectedAddressId || undefined };
    };
    if (req.method === "POST" && req.headers.origin && req.headers.origin !== resolvePublicOrigin(req)) {
      throw Object.assign(new Error("Cross-origin browser requests are not accepted"), { status: 403 });
    }
    if (req.method === "OPTIONS") return send(res, 204, {});
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, healthPayload());
    }
    // Readiness includes storage; /health stays a cheap liveness check.
    if (req.method === "GET" && url.pathname === "/health/ready") {
      try { return send(res, 200, { ...healthPayload(), storage: await databaseReady() }); }
      catch { return send(res, 503, { ...healthPayload(), ok: false, storage: { durable: true, reachable: false } }); }
    }
    if (req.method === "GET" && url.pathname === "/api/bootstrap") {
      const user = readAuthUser(req.headers.cookie, req.headers.authorization);
      return send(res, 200, {
        config: authConfiguration(),
        user,
        mealMemory: user ? await getMealHistory(user.id, 6) : [],
        health: healthPayload()
      });
    }
    if (req.method === "GET" && url.pathname === "/api/auth/config") {
      return send(res, 200, authConfiguration());
    }
    if (req.method === "GET" && url.pathname === "/api/auth/me") {
      return send(res, 200, { user: readAuthUser(req.headers.cookie, req.headers.authorization) });
    }
    if (req.method === "POST" && url.pathname === "/api/auth/demo") {
      if (!authConfiguration().demo) throw Object.assign(new Error("Demo login is disabled in live mode"), { status: 403 });
      const user = demoUser();
      return send(res, 200, { user }, { "set-cookie": issueAuthCookie(user) });
    }
    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      return send(res, 200, { loggedOut: true }, { "set-cookie": clearAuthCookie() });
    }
    if (req.method === "GET" && url.pathname === "/api/auth/google/start") {
      const mobile = url.searchParams.get("client") === "mobile";
      const browserBinding = mobile ? undefined : crypto.randomBytes(32).toString("base64url");
      let location;
      try {
        // Native clients send a PKCE challenge; older app builds without one are
        // told to update instead of receiving a token in the callback URL.
        location = await startGoogleOAuth(resolvePublicOrigin(req), { mobileChallenge: mobile ? url.searchParams.get("challenge") || "" : undefined, browserBinding });
      } catch (error) {
        if (error.flowKind === "mobile") return redirect(res, `moodish://auth-callback?error=${loginErrorReason(error)}`);
        throw error;
      }
      return redirect(res, location, browserBinding ? { "set-cookie": googleFlowCookie(browserBinding, 600) } : {});
    }
    if (req.method === "GET" && url.pathname === "/api/auth/google/callback") {
      let completed;
      try {
        completed = await completeGoogleOAuth({ code: url.searchParams.get("code"), state: url.searchParams.get("state"),
          denied: url.searchParams.get("error"), browserBinding: readCookie(req, "moodish_google_flow") });
      } catch (error) {
        const reason = loginErrorReason(error);
        if (error.flowKind === "mobile") return redirect(res, `moodish://auth-callback?error=${reason}`);
        const clear = reason === LOGIN_ERRORS.BROWSER_MISMATCH ? {} : { "set-cookie": googleFlowCookie("", 0) };
        return redirect(res, `/?login_error=${reason}`, clear);
      }
      if (completed.mobile) return redirect(res, `moodish://auth-callback?code=${encodeURIComponent(completed.exchangeCode)}`);
      return redirect(res, "/?login=google", { "set-cookie": [issueAuthCookie(completed.user), googleFlowCookie("", 0)] });
    }
    if ((req.method === "GET" && url.pathname === "/api/auth/swiggy/start") ||
        (req.method === "POST" && url.pathname === "/api/swiggy/oauth/start")) {
      if (!authConfiguration().swiggy) throw Object.assign(new Error("Swiggy login is not enabled on this deployment"), { status: 503 });
      const body = req.method === "POST" ? await readJson(req) : {};
      const browserBinding = body.mobileChallenge ? undefined : crypto.randomBytes(32).toString("base64url");
      const user = authUser || { id: `swiggy:${crypto.randomUUID()}`, name: "Swiggy member", provider: "swiggy" };
      const started = await startSwiggyOAuth({ user, browserBinding, mobileChallenge: body.mobileChallenge,
        redirectUri: `${resolvePublicOrigin(req)}/api/auth/swiggy/callback` });
      const headers = browserBinding ? { "set-cookie": flowCookie(browserBinding, 600) } : {};
      return req.method === "GET" ? redirect(res, started.authorizationUrl, headers) : send(res, 200, started, headers);
    }
    if (req.method === "GET" && ["/api/auth/swiggy/callback", "/api/swiggy/oauth/callback"].includes(url.pathname)) {
      let connected;
      try {
        connected = await completeSwiggyOAuth({ code: url.searchParams.get("code"), state: url.searchParams.get("state"),
          denied: url.searchParams.get("error"), browserBinding: readCookie(req, "moodish_swiggy_flow") });
      } catch (error) {
        // Send people back to the app that started the flow with a short reason.
        // No provider error text, code or state is reflected.
        const reason = loginErrorReason(error);
        if (error.flowKind === "mobile") return redirect(res, `moodish://auth-callback?error=${reason}`);
        const clear = reason === LOGIN_ERRORS.BROWSER_MISMATCH ? {} : { "set-cookie": flowCookie("", 0) };
        return redirect(res, `/?swiggy_error=${reason}`, clear);
      }
      if (connected.exchangeCode) return redirect(res, `moodish://auth-callback?code=${encodeURIComponent(connected.exchangeCode)}`);
      return redirect(res, "/?login=swiggy", { "set-cookie": [issueAuthCookie(connected.user), flowCookie("", 0)] });
    }
    if (req.method === "POST" && url.pathname === "/api/auth/mobile/exchange") {
      const user = await exchangeMobileCode(await readJson(req));
      return send(res, 200, { user, token: signSessionToken(user) });
    }
    if (req.method === "GET" && url.pathname === "/api/profile") {
      if (live) requireUser();
      return send(res, 200, await getTasteProfile(authUser?.id || DEFAULT_USER_HASH));
    }
    if (req.method === "GET" && url.pathname === "/api/swiggy/connection") {
      return send(res, 200, await getSwiggyConnectionStatus(requireUser().id));
    }
    if (req.method === "POST" && url.pathname === "/api/swiggy/disconnect") {
      await disconnectSwiggy(requireUser().id);
      return send(res, 200, { connected: false });
    }
    if (req.method === "GET" && url.pathname === "/api/swiggy/addresses") {
      requireUser();
      return send(res, 200, { addresses: await runtime.swiggy.getAddresses() });
    }
    if (req.method === "POST" && url.pathname === "/api/swiggy/address") {
      const user = requireUser();
      const { addressId } = await readJson(req);
      const credential = live ? await getSwiggyCredential(user.id) : null;
      if (live && !credential) throw Object.assign(new Error("Connect or reconnect Swiggy first"), { status: 401 });
      const addresses = await runtime.swiggy.getAddresses();
      if (!addresses.some(a => a.id === addressId)) throw Object.assign(new Error("Choose one of your saved Swiggy addresses"), { status: 422 });
      await selectSwiggyAddress(user.id, addressId, credential?.version);
      return send(res, 200, await getSwiggyConnectionStatus(user.id));
    }
    if (req.method === "POST" && url.pathname === "/api/profile") {
      const body = await readJson(req);
      return send(res, 200, await updateTasteProfile((await personal(body)).userIdHash, body.patch || body));
    }
    if (req.method === "POST" && url.pathname === "/api/recommendations/personal") {
      return send(res, 200, await tools.plan_personal_meal(await personal(await readJson(req))));
    }
    if (req.method === "POST" && url.pathname === "/api/planner/chat") {
      const body = await readJson(req);
      return send(
        res,
        200,
        await continueMealConversation(
          await personal(body),
          tools
        )
      );
    }
    if (req.method === "POST" && url.pathname === "/api/recommendations/office") {
      return send(res, 200, await tools.plan_office_lunch(await personal(await readJson(req))));
    }
    if (req.method === "POST" && ["/api/cart/prepare", "/api/cart/confirm"].includes(url.pathname)) {
      const body = await personal(await readJson(req));
      return send(res, 200, await tools[url.pathname.endsWith("prepare") ? "prepare_cart" : "build_confirmed_cart"](body));
    }
    if (req.method === "POST" && url.pathname === "/api/feedback") {
      return send(res, 200, await tools.record_meal_feedback(await personal(await readJson(req))));
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
        const started = await startPlatformOAuth(platform, {
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
      if (live) requireUser();
      const scoped = await personal(body);
      const session = await tools.create_group_meal_session({ ...body, platform: "web", creatorId: authUser?.id || body.creatorId,
        purchaseUserId: authUser?.id, addressId: scoped.addressId });
      return send(res, 201, {
        ...session,
        accessToken: signGroupAccessToken({ sessionId: session.sessionId, actorId: session.creatorId })
      });
    }
    const groupMatch = url.pathname.match(/^\/api\/group-sessions\/([^/]+)(?:\/([^/]+))?$/);
    if (groupMatch) {
      const [, sessionId, action] = groupMatch;

      if (req.method === "POST" && action === "connect") {
        const identity = requireGroupIdentity(req, sessionId);
        const user = requireUser();
        await withAccountLock(`group:${sessionId}`, async () => {
          const stored = await getGroupSession(sessionId);
          if (!stored || identity.actorId !== stored.creatorId || (stored.purchaseUserId && stored.purchaseUserId !== user.id)) throw Object.assign(new Error("Only the original creator can connect the purchasing account"), { status: 403 });
          if (stored.state !== "collecting") throw Object.assign(new Error("Connect before ranking the group meal"), { status: 409 });
          const connection = await getSwiggyConnectionStatus(user.id);
          if (!connection.connected || !connection.selectedAddressId) throw Object.assign(new Error("Connect Swiggy and choose a delivery address first"), { status: 422 });
          await saveGroupSession({ ...stored, purchaseUserId: user.id, addressId: connection.selectedAddressId });
        });
        return send(res, 200, { connected: true });
      }
      if (req.method === "GET" && !action) {
        const identity = optionalGroupIdentity(req, sessionId);
        return send(
          res,
          200,
          await withAccountLock(`group:${sessionId}`, () => tools.get_group_meal_session({ sessionId, actorId: identity?.actorId }))
        );
      }
      if (req.method === "POST") {
        const body = { ...(await readJson(req)), sessionId };
        const actions = {
          access: "verify_group_invite_access",
          preferences: "submit_group_preferences",
          rank: "rank_group_meal",
          vote: "vote_group_option",
          select: "select_group_option",
          "confirm-cart": "confirm_group_cart",
          "prepare-cart": "prepare_group_cart",
          cancel: "cancel_group_meal_session"
        };
        const toolName = actions[action];
        if (toolName) {
          if (["preferences", "vote"].includes(action)) {
            body.bypassInvitePasscode = Boolean(optionalGroupIdentity(req, sessionId));
          }
          if (["rank", "select", "prepare-cart", "confirm-cart", "cancel"].includes(action)) {
            body.actorId = requireGroupIdentity(req, sessionId).actorId;
          }
          return send(res, 200, await withAccountLock(`group:${sessionId}`, async () => {
            const stored = await getGroupSession(sessionId);
            if (live && ["prepare-cart", "confirm-cart"].includes(action)) {
              const user = requireUser();
              if (!stored || user.id !== stored.purchaseUserId) {
                throw Object.assign(new Error("Sign in as the group purchasing account to review or confirm its cart"), { status: 403 });
              }
            }
            return createTools(createToolRuntime({ userId: stored?.purchaseUserId }))[toolName](body);
          }, { longRunning: ["rank", "prepare-cart", "confirm-cart"].includes(action) }));
        }
      }
    }
    if (req.method === "GET" && url.pathname === "/api/audit") {
      if (live) throw Object.assign(new Error("Global audit access is disabled"), { status: 403 });
      return send(res, 200, { logs: await getAuditLogs() });
    }
    if (req.method === "POST" && url.pathname === "/api/privacy/delete-taste-memory") {
      const body = await readJson(req);
      return send(res, 200, await deleteTasteMemory((await personal(body)).userIdHash));
    }
    if (req.method === "POST" && url.pathname === "/api/privacy/clear-team-history") {
      const body = await readJson(req);
      if (live) throw Object.assign(new Error("Team history deletion needs verified workspace administration"), { status: 403 });
      return send(res, 200, await clearTeamHistory(body.teamId));
    }
    if (req.method === "POST" && url.pathname === "/mcp") {
      const message = await readJson(req);
      if (message.method === "tools/call" && !MCP_PERSONAL_TOOLS.has(message.params?.name)) throw Object.assign(new Error("Use the authenticated group API for group operations"), { status: 403 });
      message.params = { ...message.params, arguments: await personal(message.params?.arguments || {}) };
      return send(res, 200, await handleJsonRpc(message, tools));
    }
    return send(res, 404, { error: "Not found" });
  } catch (error) {
    // Unexpected failures (database, bugs) are logged, not described to clients.
    if (!error.status) {
      console.error(`[Moodish] ${req.method} ${String(req.url).split("?")[0]} failed: ${error.name}: ${error.message}`);
      return send(res, 500, { error: "Moodish hit an unexpected problem. Please try again." });
    }
    return send(res, error.status, { error: error.message, details: error.details });
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

async function handleJsonRpc(message, tools) {
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
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-moodish-session",
    ...extraHeaders
  });
  res.end(status === 204 ? "" : JSON.stringify(payload, null, 2));
}

function redirect(res, location, extraHeaders = {}) {
  res.writeHead(302, { location, ...extraHeaders });
  res.end();
}

function healthPayload() {
  return {
    ok: true,
    service: "moodish-agent",
    swiggyMode: process.env.SWIGGY_MODE || "fixture",
    aiProvider: process.env.AI_PROVIDER || "mock"
  };
}

async function readJson(req) {
  const raw = await readRaw(req);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error("Request body must be valid JSON"), { status: 400 }); }
}

async function readRaw(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { assertRuntimeConfig(); } catch (error) { console.error(error.message); process.exit(1); }
  const port = Number(process.env.MOODISH_PORT || 8786);
  createServer().listen(port, "127.0.0.1", () => {
    console.log(`Moodish agent listening on http://127.0.0.1:${port}`);
  });
}

function readCookie(req, name) { return String(req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1); }
function loginFlowCookie(name, path, value, age) { return `${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${age}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`; }
function googleFlowCookie(value, age) { return loginFlowCookie("moodish_google_flow", "/api/auth/google", value, age); }
function flowCookie(value, age) { return loginFlowCookie("moodish_swiggy_flow", "/", value, age); }
