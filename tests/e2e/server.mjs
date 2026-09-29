// Browser-test server: the real Moodish web app and API, with only the Swiggy
// network boundary replaced by the fake provider. /__e2e routes exist only in
// this test process; they let a spec sign in, play Swiggy consent, and inject
// upstream faults.
import http from "node:http";
import { installFakeSwiggy, defaultCatalog } from "../helpers/fake-swiggy.mjs";

const port = Number(process.env.E2E_PORT || 8791);
const mode = process.env.E2E_MODE || "live";
Object.assign(process.env, {
  SWIGGY_MODE: mode, SWIGGY_OAUTH_ENABLED: mode === "live" ? "true" : "false",
  TOKEN_ENCRYPTION_KEY: "e2e-only-token-encryption-key-0123456789",
  GROUP_SESSION_SIGNING_KEY: "e2e-only-group-signing-key-0123456789ab",
  MOODISH_PUBLIC_URL: `http://127.0.0.1:${port}`, AI_PROVIDER: "mock", MOODISH_RUNTIME_ENV_FILE: "/nonexistent"
});
delete process.env.DATABASE_URL;

const fake = installFakeSwiggy();
const { createWebServer } = await import("../../apps/web/server.mjs");
const { signSessionToken } = await import("../../services/agent/src/auth.mjs");
const app = createWebServer();
const appHandler = app.listeners("request")[0];
let delays = {};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (!url.pathname.startsWith("/__e2e/")) return appHandler(req, res);
  const body = req.method === "POST" ? JSON.parse(await new Promise(resolve => { let raw = ""; req.on("data", c => { raw += c; }); req.on("end", () => resolve(raw || "{}")); })) : {};
  const reply = (value, status = 200, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(value)); };
  switch (url.pathname) {
    case "/__e2e/session": {
      const token = signSessionToken({ id: url.searchParams.get("id"), name: url.searchParams.get("name") || "E2E Tester", provider: "google" });
      res.writeHead(302, { location: "/", "set-cookie": `moodish_session=${token}; Path=/; HttpOnly; SameSite=Lax` });
      return res.end();
    }
    case "/__e2e/authorize": {
      const grant = fake.authorize(body.authorizationUrl, { deny: body.deny });
      const query = new URLSearchParams(grant.error ? { state: grant.state, error: grant.error } : { state: grant.state, code: grant.code });
      return reply({ callback: `/api/auth/swiggy/callback?${query}` });
    }
    case "/__e2e/reset":
      fake.clearFaults(); delays = {};
      fake.state.catalog = defaultCatalog();
      fake.setCart({ restaurantId: null, items: [] });
      fake.state.calls.length = 0;
      return reply({ ok: true });
    case "/__e2e/fault":
      if (body.delayMs) {
        delays[body.tool] = body.delayMs;
        fake.fault(body.tool, () => new Promise(resolve => setTimeout(() => resolve(null), delays[body.tool])));
      } else fake.fault(body.tool, body.fault);
      return reply({ ok: true });
    case "/__e2e/cart":
      fake.setCart(body.cart);
      return reply({ ok: true });
    case "/__e2e/price":
      fake.state.catalog.restaurants["rest-1"].items.find(item => item.id === body.itemId).price = body.price;
      return reply({ ok: true });
    case "/__e2e/search-empty":
      fake.fault("search_menu", { data: { items: [], hasMore: false, totalItems: 0 } });
      fake.fault("search_restaurants", { data: { restaurants: [] } });
      return reply({ ok: true });
    case "/__e2e/state":
      return reply({ writes: fake.writes(), tokenExchanges: fake.calls("token").length, prepares: fake.calls("get_food_cart").length, cart: fake.state.cart });
    default:
      return reply({ error: "unknown e2e route" }, 404);
  }
});
server.listen(port, "127.0.0.1", () => console.log(`e2e ${mode} server on ${port}`));
