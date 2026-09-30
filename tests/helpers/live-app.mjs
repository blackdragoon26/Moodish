import { createWebServer } from "../../apps/web/server.mjs";
import { signSessionToken } from "../../services/agent/src/auth.mjs";
import { installFakeSwiggy } from "./fake-swiggy.mjs";

const LIVE_ENV = {
  SWIGGY_MODE: "live",
  SWIGGY_OAUTH_ENABLED: "true",
  TOKEN_ENCRYPTION_KEY: "test-only-token-encryption-key-0123456789",
  GROUP_SESSION_SIGNING_KEY: "test-only-group-signing-key-0123456789ab",
  MOODISH_PUBLIC_URL: "http://127.0.0.1:8787"
};

// Starts the real web + API server in live mode against the fake Swiggy
// provider. Only the network boundary to Swiggy is simulated.
export async function startLiveApp(t, { env = {}, fake: fakeOptions } = {}) {
  const previous = {};
  for (const [key, value] of Object.entries({ ...LIVE_ENV, ...env })) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const fake = installFakeSwiggy(fakeOptions);
  const server = createWebServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    fake.restore();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const request = async (path, { method, body, session, sessionHeader = "cookie", headers = {} } = {}) => {
    const auth = !session ? {} : sessionHeader === "native" ? { "x-moodish-session": session } : { cookie: `moodish_session=${session}` };
    const response = await fetch(base + path, {
      method: method || (body === undefined ? "GET" : "POST"), redirect: "manual",
      headers: { "content-type": "application/json", ...auth, ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = await response.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    return { status: response.status, body: json, headers: response.headers };
  };

  // Browser Swiggy connection through the real start and callback routes.
  const connect = async (session, { accessToken, deny = false, tamper } = {}) => {
    const start = await fetch(`${base}/api/auth/swiggy/start`, { redirect: "manual", headers: session ? { cookie: `moodish_session=${session}` } : {} });
    const flowCookie = cookieValue(start.headers, "moodish_swiggy_flow");
    const grant = fake.authorize(start.headers.get("location"), { accessToken, deny });
    const query = new URLSearchParams(grant.error ? { state: grant.state, error: grant.error } : { state: grant.state, code: grant.code });
    const callbackRequest = { flowCookie, query, grant, authorizationUrl: start.headers.get("location") };
    if (tamper) tamper(callbackRequest);
    const callback = await fetch(`${base}/api/auth/swiggy/callback?${callbackRequest.query}`, { redirect: "manual",
      headers: callbackRequest.flowCookie ? { cookie: `moodish_swiggy_flow=${callbackRequest.flowCookie}` } : {} });
    return { callback, location: callback.headers.get("location"), session: cookieValue(callback.headers, "moodish_session") || session, ...callbackRequest };
  };

  const user = (id, name = id) => signSessionToken({ id, name, provider: "google" });

  return { base, fake, request, connect, user };
}

export function cookieValue(headers, name) {
  const all = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie") || ""];
  for (const line of all) {
    const first = line.split(";")[0].trim();
    if (first.startsWith(`${name}=`)) return first.slice(name.length + 1) || null;
  }
  return null;
}
