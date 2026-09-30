#!/usr/bin/env node
// Read-only live acceptance checks against Swiggy for one connected Moodish
// account. Runs inside the server trust boundary: it reads the account's
// encrypted connection from the app database and calls Swiggy through the same
// allowlisted adapter the app uses. It never updates a cart, never prints
// tokens, and summarizes responses as counts, flags and codes only.
//
//   MOODISH_LIVE_ACCEPTANCE=1 DATABASE_URL=... TOKEN_ENCRYPTION_KEY=... \
//   MOODISH_ACCEPTANCE_USER_ID=google:... node scripts/live-acceptance.mjs [--out report.json] [--capture-shapes dir]
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import crypto from "node:crypto";

const READ_ONLY_TOOLS = new Set(["get_addresses", "search_menu", "get_restaurant_menu", "get_food_cart", "search_products"]);

export async function runLiveAcceptance({ env = process.env, captureShapes } = {}) {
  const stages = [];
  const record = (stage, status, outcome, summary = {}, code) => {
    stages.push({ stage, status, outcome, ...(code ? { code } : {}), summary });
    return status === "PASS";
  };
  const missing = ["DATABASE_URL", "TOKEN_ENCRYPTION_KEY", "MOODISH_ACCEPTANCE_USER_ID"].filter(name => !env[name]);
  if (env.MOODISH_LIVE_ACCEPTANCE !== "1" || missing.length) {
    record("configuration", "BLOCKED", "blocked", { missing, optIn: env.MOODISH_LIVE_ACCEPTANCE === "1" });
    return report(stages, env);
  }
  process.env.SWIGGY_MODE = "live";
  const { getSwiggyConnectionStatus } = await import("../services/agent/src/swiggy-auth.mjs");
  const { createLiveCaller } = await import("../services/agent/src/swiggy-client.mjs");
  const gatewayModule = await import("../services/agent/src/swiggy-gateway.mjs");
  const userId = env.MOODISH_ACCEPTANCE_USER_ID;
  const live = createLiveCaller(userId);
  const call = async (name, args) => {
    if (!READ_ONLY_TOOLS.has(name)) throw new Error(`Live acceptance never calls ${name}`);
    const data = await live(name === "search_products" ? "im" : "food", name, args);
    if (captureShapes) writeShape(captureShapes, name, data);
    return data;
  };
  const stage = async (name, fn) => {
    try { return record(name, "PASS", "success", await fn()); }
    catch (error) { return record(name, error.blocked ? "BLOCKED" : "FAIL", outcomeOf(error), error.blocked ? { reason: error.message } : {}, error.code); }
  };
  const blocked = message => Object.assign(new Error(message), { blocked: true });

  let connection;
  await stage("connection", async () => {
    connection = await getSwiggyConnectionStatus(userId);
    if (!connection.connected) throw Object.assign(blocked(connection.requiresReauthentication ? "Swiggy authorization expired; reconnect in Moodish" : "Connect Swiggy in Moodish first"),
      { code: connection.requiresReauthentication ? "SWIGGY_REAUTH_REQUIRED" : "NOT_CONNECTED" });
    return { connected: true, hasSelectedAddress: Boolean(connection.selectedAddressId) };
  });
  if (!connection?.connected) return report(stages, env);

  let addressId;
  await stage("addresses", async () => {
    const addresses = gatewayModule.normalizeAddresses(await call("get_addresses", {}));
    const selected = addresses.find(address => address.id === connection.selectedAddressId);
    if (!connection.selectedAddressId) throw blocked("Choose a saved delivery address in Moodish");
    if (!selected) throw Object.assign(blocked("The selected address is no longer in the Swiggy account"), { code: "ADDRESS_NOT_FOUND" });
    addressId = selected.id;
    return { count: addresses.length, selectedPresent: true, displayPresent: Boolean(selected.display) };
  });

  let restaurantId;
  const query = env.MOODISH_ACCEPTANCE_QUERY || "biryani";
  await stage("food-search", async () => {
    if (!addressId) throw blocked("Needs a selected address");
    const items = gatewayModule.normalizeMenuSearch(await call("search_menu", { addressId, query }));
    restaurantId = items[0]?.restaurant?.id;
    return {
      results: items.length, restaurants: new Set(items.map(item => item.restaurant.id)).size,
      priced: items.filter(item => Number.isFinite(item.price)).length,
      needsCustomization: items.filter(item => item.hasVariants === true || item.variantsV2?.length || item.variations?.length).length,
      vegFlagged: items.filter(item => item.tags.includes("veg") || item.tags.includes("non-veg")).length
    };
  });

  await stage("menu-detail", async () => {
    if (!restaurantId) throw blocked("Needs a restaurant from food search");
    const menu = gatewayModule.normalizeRestaurantMenu(await call("get_restaurant_menu", { addressId, restaurantId }), { restaurantId });
    return { items: menu.items.length, priced: menu.items.filter(item => Number.isFinite(item.price)).length,
      inStockKnown: menu.items.filter(item => item.inStock !== undefined).length, restaurantPresent: Boolean(menu.restaurant) };
  });

  await stage("current-cart", async () => {
    if (!addressId) throw blocked("Needs a selected address");
    const cart = gatewayModule.normalizeFoodCart(await call("get_food_cart", { addressId }));
    return { items: cart.items.length, empty: cart.items.length === 0, totalPresent: Number.isFinite(cart.total),
      authoritativeTotal: cart.pricing?.to_pay !== undefined, sameRestaurantAsSearch: Boolean(restaurantId) && cart.restaurantId === restaurantId };
  });

  await stage("instamart", async () => {
    if (!addressId) throw blocked("Needs a selected address");
    const products = gatewayModule.normalizeProducts(await call("search_products", { addressId, query: env.MOODISH_ACCEPTANCE_INSTAMART_QUERY || "soda" }));
    return { products: products.length, priced: products.filter(product => Number.isFinite(product.price)).length };
  });
  return report(stages, env);
}

function outcomeOf(error) {
  if (error.blocked) return "blocked";
  return {
    SWIGGY_REAUTH_REQUIRED: "expired", SWIGGY_ACCESS_DENIED: "denied", SWIGGY_CAPABILITY_UNAVAILABLE: "unavailable",
    SWIGGY_MALFORMED_RESPONSE: "malformed", SWIGGY_TIMEOUT: "timeout", SWIGGY_SCHEMA_MISMATCH: "unavailable",
    SWIGGY_TOOL_ERROR: "tool-error", SWIGGY_RATE_LIMITED: "unavailable", SWIGGY_UNAVAILABLE: "unavailable"
  }[error.code] || "error";
}

function report(stages, env) {
  const failed = stages.some(stage => stage.status === "FAIL");
  const blocked = stages.some(stage => stage.status === "BLOCKED");
  return {
    kind: "moodish-live-acceptance", readOnly: true, ranAt: new Date().toISOString(),
    // Identifies the account for the operator without printing its id.
    accountFingerprint: env.MOODISH_ACCEPTANCE_USER_ID ? crypto.createHash("sha256").update(env.MOODISH_ACCEPTANCE_USER_ID).digest("hex").slice(0, 12) : null,
    result: failed ? "FAIL" : blocked ? "BLOCKED" : "PASS",
    stages
  };
}

// Records structure only: key names and value types, with arrays cut to two
// entries. No strings, numbers or identifiers are written.
function writeShape(dir, name, data) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.shape.json`), `${JSON.stringify(shapeOf(data), null, 2)}\n`);
}
export function shapeOf(value, depth = 0) {
  if (depth > 8) return "<deep>";
  if (Array.isArray(value)) return value.slice(0, 2).map(item => shapeOf(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, shapeOf(value[key], depth + 1)]));
  return value === null ? "<null>" : `<${typeof value}>`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  const result = await runLiveAcceptance({ captureShapes: option("--capture-shapes") });
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (option("--out")) writeFileSync(option("--out"), text);
  process.stdout.write(text);
  process.exit(result.result === "PASS" ? 0 : result.result === "BLOCKED" ? 2 : 1);
}
