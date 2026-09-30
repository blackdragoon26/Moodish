import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unwrapMcpResult } from "../services/agent/src/swiggy-client.mjs";
import { normalizeAddresses, normalizeFoodCart, normalizeMenuSearch, normalizeProducts, normalizeRestaurantMenu, createSwiggyGateway } from "../services/agent/src/swiggy-gateway.mjs";
import { saveSecretSession } from "../services/agent/src/memory.mjs";
import { encryptToken } from "../services/agent/src/swiggy-auth.mjs";
import { installFakeSwiggy } from "./helpers/fake-swiggy.mjs";

const shapes = JSON.parse(readFileSync(new URL("./fixtures/swiggy-documented-shapes.json", import.meta.url)));
// Tool results arrive as MCP text content; unwrap exactly as the live client does.
const unwrap = payload => unwrapMcpResult({ result: { content: [{ type: "text", text: JSON.stringify(payload) }] } });

test("addresses map the documented fields and never carry phone numbers", () => {
  const addresses = normalizeAddresses(unwrap(shapes.get_addresses));
  assert.deepEqual(addresses, [
    { id: "addr-a", label: "Home", display: "Synthetic line A" },
    { id: "addr-b", label: "Saved address", display: "Synthetic line B" }
  ]);
  assert.equal(JSON.stringify(addresses).includes("+91"), false);
});

test("menu search keeps valid dishes, flags customization, and drops rows without ids", () => {
  const items = normalizeMenuSearch(unwrap(shapes.search_menu));
  assert.deepEqual(items.map(item => item.itemId), ["item-a", "item-b", "item-c"]);
  assert.equal(items[0].restaurant.id, "rest-a");
  assert.equal(items[0].restaurant.name, "Synthetic Kitchen");
  assert.deepEqual(items[0].tags, ["veg"]);
  assert.equal(items[1].hasVariants, true);
  assert.equal(items[1].addons[0].minAddons, 1);
  assert.equal(items[2].inStock, false);
});

test("restaurant menu reads the flat documented item list", () => {
  const menu = normalizeRestaurantMenu(unwrap(shapes.get_restaurant_menu), { restaurantId: "rest-a" });
  assert.deepEqual(menu.items.map(item => [item.itemId, item.inStock]), [["item-a", 1], ["item-c", 0]]);
  assert.equal(menu.restaurant.name, "Synthetic Kitchen");
});

test("food cart uses Swiggy's to_pay as the total and accepts the documented empty cart", () => {
  const cart = normalizeFoodCart(unwrap(shapes.get_food_cart));
  assert.equal(cart.restaurantId, "rest-a");
  assert.equal(cart.total, 539);
  assert.deepEqual(cart.items.map(item => [item.itemId, item.quantity, item.price]), [["item-a", 2, 480]]);
  const empty = normalizeFoodCart(unwrap(shapes.get_food_cart_empty));
  assert.deepEqual([empty.restaurantId, empty.items, empty.total], ["", [], 0]);
  assert.throws(() => normalizeFoodCart({ items: [{ menu_item_id: "x", quantity: "many" }], pricing: { to_pay: 1 } }), /valid quantity/);
  assert.throws(() => normalizeFoodCart({ items: [{ menu_item_id: "x", quantity: 1 }] }), /total is missing/);
});

test("Instamart keeps only in-stock SKU variations with a spin id", () => {
  const products = normalizeProducts(unwrap(shapes.search_products));
  assert.deepEqual(products.map(product => [product.productId, product.price]), [["spin-a1", 35]]);
  assert.equal(products[0].name, "Synthetic Lime Soda · 300 ml");
});

test("a row with a malformed optional field is dropped without losing valid rows", () => {
  const valid = { menu_item_id: "ok", name: "Valid", price: 100, restaurant_id: "r1", restaurant_name: "R" };
  assert.deepEqual(normalizeMenuSearch({ items: [{ ...valid, menu_item_id: "bad", tags: 17 }, valid] }).map(item => item.itemId), ["ok"]);
  assert.deepEqual(normalizeMenuSearch({ items: [{ ...valid, menu_item_id: "bad", restaurant: { id: "r2", cuisines: "Thai" } }, valid] }).map(item => item.itemId), ["ok"]);
  assert.deepEqual(normalizeRestaurantMenu({ items: [{ id: "bad", price: 5, tags: { a: 1 } }, { id: "ok", price: 5 }] }, { restaurantId: "r" }).items.map(item => item.itemId), ["ok"]);
  assert.deepEqual(normalizeProducts({ products: [{ productId: "bad", price: 5, tags: "x" }, { productId: "bad2", variations: "x" }, { productId: "ok", price: 5 }] }).map(product => product.productId), ["ok"]);
  assert.throws(() => normalizeMenuSearch({ items: [{ ...valid, tags: 17 }] }), { code: "SWIGGY_MALFORMED_RESPONSE" }, "all rows malformed is an explicit error");
});

test("unrecognized or entirely malformed payloads are errors, not empty results", () => {
  for (const [normalize, data] of [
    [normalizeAddresses, { unexpected: [] }],
    [normalizeAddresses, "text"],
    [normalizeMenuSearch, { data: { items: [] } }],
    [normalizeMenuSearch, { items: [{ name: "no ids" }, null] }],
    [data => normalizeRestaurantMenu(data, { restaurantId: "r" }), { menu: {} }],
    [normalizeProducts, { products: [{ displayName: "no ids", price: 5 }] }]
  ]) {
    assert.throws(() => normalize(data), error => error.code === "SWIGGY_MALFORMED_RESPONSE", JSON.stringify(data));
  }
  assert.deepEqual(normalizeAddresses({ addresses: [] }), [], "a genuinely empty list stays empty");
  assert.throws(() => unwrap(shapes.error_envelope), error => error.code === "SWIGGY_TOOL_ERROR");
});

async function liveGatewayWith(t, faults = {}) {
  const previous = { mode: process.env.SWIGGY_MODE, key: process.env.TOKEN_ENCRYPTION_KEY };
  process.env.SWIGGY_MODE = "live";
  process.env.TOKEN_ENCRYPTION_KEY = "test-only-token-encryption-key-0123456789";
  const fake = installFakeSwiggy();
  for (const [name, fault] of Object.entries(faults)) fake.fault(name, fault);
  const userId = `contract-${Math.random()}`;
  await saveSecretSession(`swiggy:${userId}`, { accessToken: encryptToken("contract-token"), expiresAt: Date.now() + 3_600_000, version: "v1" });
  t.after(() => {
    fake.restore();
    if (previous.mode === undefined) delete process.env.SWIGGY_MODE; else process.env.SWIGGY_MODE = previous.mode;
    if (previous.key === undefined) delete process.env.TOKEN_ENCRYPTION_KEY; else process.env.TOKEN_ENCRYPTION_KEY = previous.key;
  });
  return { fake, gateway: createSwiggyGateway({ userId }) };
}

test("each upstream failure has a distinct code, and only transient read failures are retried", async t => {
  const cases = [
    ["timeout", "SWIGGY_TIMEOUT", 504, 2],
    ["network", "SWIGGY_UNAVAILABLE", 502, 2],
    [{ http: 503 }, "SWIGGY_UNAVAILABLE", 502, 2],
    [{ http: 429 }, "SWIGGY_RATE_LIMITED", 429, 2],
    [{ http: 403 }, "SWIGGY_ACCESS_DENIED", 403, 1],
    ["isError", "SWIGGY_TOOL_ERROR", 502, 1],
    ["success-false", "SWIGGY_TOOL_ERROR", 502, 1],
    ["unreadable", "SWIGGY_MALFORMED_RESPONSE", 502, 1],
    ["empty-content", "SWIGGY_MALFORMED_RESPONSE", 502, 1],
    [{ data: { surprise: true } }, "SWIGGY_MALFORMED_RESPONSE", 502, 1],
    [{ http: 401 }, "SWIGGY_REAUTH_REQUIRED", 401, 1]
  ];
  for (const [fault, code, status, attempts] of cases) {
    const { fake, gateway } = await liveGatewayWith(t, { get_addresses: fault });
    await assert.rejects(gateway.getAddresses(), error => error.code === code && error.status === status, JSON.stringify(fault));
    assert.equal(fake.calls("get_addresses").length, attempts, `${JSON.stringify(fault)} attempts`);
    fake.restore();
  }
});

test("missing tools and schema drift are reported before any call", async t => {
  const { fake, gateway } = await liveGatewayWith(t);
  fake.state.tools.food.delete("get_food_cart");
  await assert.rejects(gateway.getFoodCart({ addressId: "addr-1" }), { code: "SWIGGY_CAPABILITY_UNAVAILABLE" });
  fake.state.schemas.search_menu = { type: "object", required: ["addressId", "query"], properties: { addressId: { type: "string" }, query: { type: "string" } }, additionalProperties: false };
  await assert.rejects(gateway.searchMenu({ addressId: "addr-1", query: "x", unexpected: 1 }), { code: "SWIGGY_SCHEMA_MISMATCH" });
  assert.equal(fake.calls("search_menu").length, 0);
});

test("Instamart failure leaves Food usable with a warning; Food failure is never replaced by fixture data", async t => {
  const { fake, gateway } = await liveGatewayWith(t, { search_products: "timeout" });
  assert.deepEqual(await gateway.searchProducts({ addressId: "addr-1", query: "soda" }), []);
  assert.deepEqual(gateway.warnings.map(warning => [warning.service, warning.code]), [["instamart", "SWIGGY_TIMEOUT"]]);
  fake.fault("search_menu", { data: { items: [] } });
  const empty = await gateway.searchMenu({ addressId: "addr-1", query: "chaap" });
  assert.deepEqual(empty, [], "no fixture restaurants appear in live results");
  fake.fault("search_menu", "timeout");
  await assert.rejects(gateway.searchMenu({ addressId: "addr-1", query: "chaap" }), { code: "SWIGGY_TIMEOUT" });
});

test("addresses are read across pages up to a bound", async t => {
  const { fake, gateway } = await liveGatewayWith(t);
  let page = 0;
  fake.fault("get_addresses", ({ args }) => {
    page += 1;
    assert.equal(args.page ?? 1, page);
    return { data: { addresses: [{ id: `addr-p${page}`, addressLine: `Line ${page}` }], pagination: { page, hasMore: true } } };
  });
  const addresses = await gateway.getAddresses();
  assert.equal(addresses.length, 5);
  assert.equal(fake.calls("get_addresses").length, 5);
});
