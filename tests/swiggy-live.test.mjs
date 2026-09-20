import test from "node:test";
import assert from "node:assert/strict";
import { completeSwiggyOAuth, startSwiggyOAuth } from "../services/agent/src/swiggy-auth.mjs";
import { createSwiggyGateway } from "../services/agent/src/swiggy-gateway.mjs";

test("Swiggy OAuth uses PKCE/DCR and live gateway propagates addressId", async () => {
  const previousFetch = globalThis.fetch;
  const previousMode = process.env.SWIGGY_MODE;
  const previousKey = process.env.TOKEN_ENCRYPTION_KEY;
  const calls = [];
  process.env.SWIGGY_MODE = "live";
  process.env.TOKEN_ENCRYPTION_KEY = "test-encryption-key";
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/auth/register")) {
      return jsonResponse({ client_id: "client-test" });
    }
    if (String(url).endsWith("/auth/token")) {
      return jsonResponse({ access_token: "token-test", expires_in: 3600, scope: "mcp:tools" });
    }
    if (init.method === "GET") return new Response(null, { status: 405 });
    const body = JSON.parse(init.body);
    const reply = result => jsonResponse({ jsonrpc: "2.0", id: body.id, result });
    if (body.method === "initialize") return reply({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "test", version: "1" } });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "tools/list") return reply({ tools: ["get_addresses", "search_menu", "get_restaurant_menu", "get_food_cart", "update_food_cart"].map(name => ({ name, inputSchema: { type: "object" } })) });
    if (body.params.name === "get_restaurant_menu") return reply({ content: [], structuredContent: { restaurant: { id: "restaurant-live", name: "Live Chaap House", isOpen: true }, items: [] } });
    if (body.params.name === "get_food_cart") {
      assert.equal(body.params.arguments.addressId, "address-live");
      return reply({ content: [], structuredContent: { restaurant: { id: "restaurant-live", name: "Live Chaap House" }, items: [{ menu_item_id: "dish-live", quantity: 1, final_price: 299 }], pricing: { to_pay: 299 } } });
    }
    if (body.params.name === "get_addresses") {
      return jsonResponse({
        jsonrpc: "2.0", id: body.id,
        result: { content: [], structuredContent: { addresses: [{ addressId: "address-live", type: "Home", address: "Live address" }] } }
      });
    }
    if (body.params.name === "search_menu") {
      assert.equal(body.params.arguments.addressId, "address-live");
      return jsonResponse({
        jsonrpc: "2.0", id: body.id,
        result: { content: [],
          structuredContent: {
            items: [
              null, {}, { id: "no-restaurant" }, { restaurant: { id: "no-item" } },
              {
                id: "dish-live",
                name: "Live Soya Chaap",
                price: 299,
                isVeg: true,
                restaurant: {
                  restaurantId: "restaurant-live",
                  restaurantName: "Live Chaap House",
                  cuisine: "North Indian",
                  avgRating: 4.6,
                  distanceKm: 1.1,
                  availabilityStatus: "OPEN"
                }
              }
            ]
          }
        }
      });
    }
    if (body.params.name === "update_food_cart") {
      assert.equal(body.params.arguments.addressId, "address-live");
      assert.equal(body.params.arguments.restaurantId, "restaurant-live");
      assert.deepEqual(body.params.arguments.cartItems, [{ menu_item_id: "dish-live", quantity: 1 }]);
      return jsonResponse({
        jsonrpc: "2.0", id: body.id,
        result: { content: [],
          structuredContent: {
            restaurant: "Live Chaap House",
            items: [{ itemId: "dish-live", name: "Live Soya Chaap", quantity: 1, price: 299 }],
            total: 299
          }
        }
      });
    }
    throw new Error(`Unexpected MCP request: ${body.method} ${body.params?.name || ""}`);
  };

  try {
    const started = await startSwiggyOAuth({
      user: { id: "test-user" }, browserBinding: "test-browser",
      redirectUri: "http://localhost:8787/api/swiggy/oauth/callback"
    });
    const authorize = new URL(started.authorizationUrl);
    assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
    assert.equal(authorize.searchParams.get("client_id"), "client-test");
    await completeSwiggyOAuth({ code: "code-test", state: authorize.searchParams.get("state"), browserBinding: "test-browser" });

    const gateway = createSwiggyGateway({ userId: "test-user" });
    const addresses = await gateway.getAddresses();
    const items = await gateway.searchMenu({ addressId: addresses[0].id, query: "chaap" });
    await gateway.buildFoodCart({
      restaurantId: "restaurant-live",
      addressId: addresses[0].id,
      items: [{ itemId: "dish-live", quantity: 1 }]
    });
    assert.equal(addresses[0].id, "address-live");
    assert.equal(items.length, 1);
    assert.equal(items[0].restaurant.name, "Live Chaap House");
    assert.equal(items[0].tags.includes("veg"), true);
    assert.ok(calls.some((call) => call.url.endsWith("/food")));
    assert.ok(calls.some((call) => JSON.parse(call.init.body || "{}")?.params?.name === "update_food_cart"));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousMode === undefined) delete process.env.SWIGGY_MODE;
    else process.env.SWIGGY_MODE = previousMode;
    if (previousKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = previousKey;
  }
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
