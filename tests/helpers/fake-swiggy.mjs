import crypto from "node:crypto";

// Deterministic stand-in for Swiggy's OAuth and MCP endpoints. Responses follow
// the documented envelopes (checked September 30, 2026): tool results carry
// `{ success, data }` JSON text, and update_food_cart adds to the current cart.
// Tests install it over globalThis.fetch, so the real MCP SDK client, auth
// module and gateway run unchanged.

export const FOOD_TOOLS = ["get_addresses", "search_menu", "search_restaurants", "get_restaurant_menu", "get_food_cart", "update_food_cart"];

export function defaultCatalog() {
  return {
    addresses: [
      { id: "addr-1", addressLine: "Flat 1, Test Street", phoneNumber: "+910000000001", addressTag: "Home" },
      { id: "addr-2", addressLine: "Floor 2, Test Tower", phoneNumber: "+910000000002", addressCategory: "Work" }
    ],
    restaurants: {
      "rest-1": {
        restaurant: { id: "rest-1", name: "Fake Chaap House", cuisines: ["North Indian"], avgRating: 4.5, isOpen: true },
        items: [
          { id: "dish-1", name: "Soya Chaap", price: 250, inStock: 1, isVeg: true, hasVariants: false, hasAddons: false, categories: ["Mains"] },
          { id: "dish-2", name: "Butter Roti", price: 40, inStock: 1, isVeg: true, hasVariants: false, hasAddons: false, categories: ["Breads"] },
          { id: "dish-custom", name: "Build Your Thali", price: 300, inStock: 1, isVeg: true, hasVariants: true, hasAddons: true, categories: ["Mains"] }
        ]
      }
    },
    products: [
      { productId: "prod-1", displayName: "Lime Soda", inStock: true, isAvail: true,
        variations: [{ spinId: "spin-1", displayName: "Lime Soda", quantityDescription: "300 ml", isInStockAndAvailable: true, price: { mrp: 40, offerPrice: 35 } }] }
    ]
  };
}

export function installFakeSwiggy(options = {}) {
  const catalog = options.catalog || defaultCatalog();
  const state = {
    catalog,
    cart: { restaurantId: null, items: [] },
    faults: {},
    calls: [],
    tokens: [],
    registered: 0,
    codes: new Map(),
    issued: 0,
    tokenResponse: options.tokenResponse || null,
    tools: { food: new Set(options.foodTools || FOOD_TOOLS), im: new Set(options.imTools || ["search_products"]) },
    schemas: options.schemas || {}
  };
  const original = globalThis.fetch;
  const passthrough = options.passthrough || (url => /^https?:\/\/(127\.0\.0\.1|localhost)/.test(String(url)));

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (passthrough(url)) return original(input, init);
    if (url === "https://mcp.swiggy.com/auth/register") {
      state.registered += 1;
      return json({ client_id: `client-${state.registered}` });
    }
    if (url === "https://mcp.swiggy.com/auth/token") {
      const fault = state.faults["auth/token"];
      if (fault) return applyHttpFault(fault);
      const request = JSON.parse(init.body || "{}");
      state.calls.push({ server: "auth", name: "token", args: { grant_type: request.grant_type, client_id: request.client_id } });
      if (state.tokenResponse) return json(state.tokenResponse(request));
      // Behaves like an OAuth 2.1 server: codes are single use and bound to the
      // client, redirect URI and PKCE challenge they were issued for.
      const grant = state.codes.get(request.code);
      state.codes.delete(request.code);
      const verifierHash = crypto.createHash("sha256").update(String(request.code_verifier || "")).digest("base64url");
      if (!grant || grant.clientId !== request.client_id || grant.redirectUri !== request.redirect_uri || grant.challenge !== verifierHash) {
        return json({ error: "invalid_grant" }, 400);
      }
      return json({ access_token: grant.accessToken, expires_in: grant.expiresIn, scope: "mcp:tools" });
    }
    const server = url.match(/^https:\/\/mcp\.swiggy\.com\/(food|im)$/)?.[1];
    if (!server) throw new Error(`Unexpected outbound request in test: ${url}`);
    if ((init.method || "GET") !== "POST") return new Response(null, { status: 405 });
    const auth = new Headers(init.headers).get("authorization") || "";
    const body = JSON.parse(init.body);
    const reply = result => json({ jsonrpc: "2.0", id: body.id, result });
    if (body.method === "initialize") {
      return reply({ protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake-swiggy", version: "1" } });
    }
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "tools/list") {
      return reply({ tools: [...state.tools[server]].map(name => ({ name, inputSchema: state.schemas[name] || { type: "object" } })) });
    }
    if (body.method !== "tools/call") throw new Error(`Unexpected MCP method ${body.method}`);
    const { name, arguments: args = {} } = body.params;
    state.calls.push({ server, name, args, token: auth.replace(/^Bearer /, "") });
    state.tokens.push(auth.replace(/^Bearer /, ""));
    const fault = typeof state.faults[name] === "function" ? state.faults[name]({ args, state }) : state.faults[name];
    if (fault) {
      const faulted = applyToolFault(fault, reply, name, args, state);
      if (faulted) return faulted;
    }
    return reply(textResult({ success: true, data: handleTool(name, args, state) }));
  };

  return {
    state,
    // Plays the user approving consent at Swiggy: returns the callback query
    // Moodish would receive for this authorization URL.
    authorize(authorizationUrl, { accessToken, expiresIn = 3600, deny = false } = {}) {
      const url = new URL(authorizationUrl);
      const params = url.searchParams;
      if (deny) return { state: params.get("state"), error: "access_denied" };
      if (params.get("code_challenge_method") !== "S256") throw new Error("authorize without S256");
      const code = `code-${++state.issued}`;
      state.codes.set(code, { clientId: params.get("client_id"), redirectUri: params.get("redirect_uri"), challenge: params.get("code_challenge"),
        accessToken: accessToken || `swiggy-token-${state.issued}`, expiresIn });
      return { state: params.get("state"), code, redirectUri: params.get("redirect_uri") };
    },
    calls: name => state.calls.filter(call => !name || call.name === name),
    writes: () => state.calls.filter(call => call.name === "update_food_cart").length,
    fault(name, value) { state.faults[name] = value; },
    clearFaults() { state.faults = {}; },
    setCart(cart) { state.cart = cart; },
    restore() { globalThis.fetch = original; }
  };
}

function handleTool(name, args, state) {
  const { catalog } = state;
  if (name === "get_addresses") return { addresses: catalog.addresses, pagination: { page: 1, pageSize: 10, total: catalog.addresses.length, totalPages: 1, hasMore: false } };
  if (name === "get_restaurant_menu") {
    const menu = catalog.restaurants[args.restaurantId];
    if (!menu) return { restaurant: null, items: [], categoryLabels: [], totalItems: 0 };
    return { restaurant: menu.restaurant, items: menu.items, categoryLabels: [], totalItems: menu.items.length };
  }
  if (name === "search_menu") {
    const query = String(args.query || "").toLowerCase();
    const items = Object.values(catalog.restaurants)
      .filter(menu => !args.restaurantIdOfAddedItem || menu.restaurant.id === args.restaurantIdOfAddedItem)
      .flatMap(menu => menu.items.map(item => ({
        menu_item_id: item.id, name: item.name, price: item.price, isVeg: item.isVeg, inStock: item.inStock !== 0,
        hasVariants: item.hasVariants, hasAddons: item.hasAddons, restaurant_id: menu.restaurant.id, restaurant_name: menu.restaurant.name,
        ...(item.hasVariants ? { variantsV2: [{ id: "v1", name: "Size", price: 0, groupId: "g1", inStock: true }] } : {}),
        ...(item.hasAddons ? { addons: [{ groupId: "a1", groupName: "Pick one", minAddons: 1, maxAddons: 1, choices: [] }] } : {})
      })))
      .filter(item => !query || query.split(/\s+/).some(token => item.name.toLowerCase().includes(token)));
    return { items, hasMore: false, totalItems: items.length };
  }
  if (name === "search_restaurants") return { restaurants: Object.values(catalog.restaurants).map(menu => menu.restaurant) };
  if (name === "get_food_cart") return cartPayload(state, args.addressId);
  if (name === "update_food_cart") {
    // Documented behaviour: adds or updates the listed items in the existing cart.
    if (state.cart.restaurantId && state.cart.restaurantId !== args.restaurantId) state.cart = { restaurantId: null, items: [] };
    state.cart.restaurantId = args.restaurantId;
    for (const wanted of args.cartItems) {
      const existing = state.cart.items.find(item => item.menu_item_id === wanted.menu_item_id);
      if (existing) existing.quantity = wanted.quantity;
      else state.cart.items.push({ menu_item_id: wanted.menu_item_id, quantity: wanted.quantity });
    }
    state.cart.items = state.cart.items.filter(item => item.quantity > 0);
    return cartPayload(state, args.addressId);
  }
  if (name === "search_products") return { products: state.catalog.products, nextOffset: "" };
  throw new Error(`Unhandled fake tool ${name}`);
}

function cartPayload(state, addressId) {
  const menu = state.cart.restaurantId ? state.catalog.restaurants[state.cart.restaurantId] : null;
  const items = state.cart.items.map(entry => {
    const item = menu?.items.find(candidate => candidate.id === entry.menu_item_id) || { name: "Unknown", price: 0 };
    return { menu_item_id: entry.menu_item_id, name: item.name, quantity: entry.quantity, final_price: item.price * entry.quantity, in_stock: true, is_veg: true };
  });
  const itemTotal = items.reduce((sum, item) => sum + item.final_price, 0);
  return {
    cart_id: items.length ? "cart-1" : "", restaurant: menu ? { id: menu.restaurant.id, name: menu.restaurant.name, area: "Test" } : null,
    items, item_count: items.length, addressId,
    pricing: { item_total: itemTotal, delivery_charge: items.length ? 30 : 0, taxes_and_charges: items.length ? 12 : 0, to_pay: items.length ? itemTotal + 42 : 0 },
    offers: { coupon_applied: null, coupon_discount: 0, free_delivery_applied: false }
  };
}

function applyToolFault(fault, reply, name, args, state) {
  if (fault === "timeout") return Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));
  if (fault === "network") return Promise.reject(new TypeError("fetch failed"));
  if (fault === "timeout-after-write") {
    if (name === "update_food_cart") handleTool(name, args, state);
    return Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));
  }
  if (fault === "isError") return reply({ isError: true, content: [{ type: "text", text: "tool failed" }] });
  if (fault === "success-false") return reply(textResult({ success: false, error: { message: "upstream refused" } }));
  if (fault === "unreadable") return reply({ content: [{ type: "text", text: "<html>not json</html>" }] });
  if (fault === "empty-content") return reply({ content: [] });
  if (fault?.data !== undefined) return reply(textResult({ success: true, data: fault.data }));
  if (fault?.http) return applyHttpFault(fault);
  return null;
}

function applyHttpFault(fault) {
  const status = typeof fault === "number" ? fault : fault.http;
  return new Response(JSON.stringify({ error: "fault" }), { status, headers: { "content-type": "application/json" } });
}

function textResult(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
