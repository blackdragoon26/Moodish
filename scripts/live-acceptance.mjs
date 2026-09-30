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
  const { getSwiggyConnectionStatus } = await import("../services/agent/src/swiggy-auth.mjs");
  const { createReadOnlyLiveGateway } = await import("../services/agent/src/swiggy-gateway.mjs");
  const userId = env.MOODISH_ACCEPTANCE_USER_ID;
  // The app's own gateway: same pagination, normalization and usability filters,
  // with writes refused. Raw results are seen only as row counts and shapes.
  const rawRows = {};
  const gateway = createReadOnlyLiveGateway({ userId, observe: (name, data) => {
    rawRows[name] = rowCount(data);
    if (captureShapes) writeShape(captureShapes, name, data);
  } });
  const stage = async (name, fn) => {
    try { return record(name, "PASS", "success", await fn()); }
    catch (error) {
      const status = error.blocked ? "BLOCKED" : "FAIL";
      return record(name, status, outcomeOf(error), error.summary || (error.blocked ? { reason: error.message } : {}), error.code);
    }
  };
  const blocked = (message, code) => Object.assign(new Error(message), { blocked: true, code });
  const unusable = (message, code, summary) => Object.assign(new Error(message), { code, unusable: true, summary });

  let connection;
  await stage("connection", async () => {
    connection = await getSwiggyConnectionStatus(userId);
    if (!connection.connected) throw blocked(connection.requiresReauthentication ? "Swiggy authorization expired; reconnect in Moodish" : "Connect Swiggy in Moodish first",
      connection.requiresReauthentication ? "SWIGGY_REAUTH_REQUIRED" : "NOT_CONNECTED");
    return { connected: true, appHasSelectedAddress: Boolean(connection.selectedAddressId) };
  });
  if (!connection?.connected) return report(stages, env);

  // Uses MOODISH_ACCEPTANCE_ADDRESS_ID if given, else the address chosen in the
  // app when it exists in the account, else the first saved address. This works
  // before live mode, when the app may still hold a demo address.
  let addressId;
  await stage("addresses", async () => {
    const addresses = await gateway.getAddresses();
    if (!addresses.length) throw blocked("The Swiggy account has no saved addresses", "NO_SAVED_ADDRESSES");
    const configured = env.MOODISH_ACCEPTANCE_ADDRESS_ID;
    const appSelected = addresses.find(address => address.id === connection.selectedAddressId);
    let chosen, source;
    if (configured) {
      chosen = addresses.find(address => address.id === configured);
      if (!chosen) throw blocked("MOODISH_ACCEPTANCE_ADDRESS_ID is not one of the account's saved addresses", "ADDRESS_NOT_FOUND");
      source = "configured";
    } else if (appSelected) { chosen = appSelected; source = "app-selected"; }
    else { chosen = addresses[0]; source = "first-saved"; }
    addressId = chosen.id;
    return { count: addresses.length, source, appSelectionFound: Boolean(appSelected), displayPresent: Boolean(chosen.display) };
  });

  let restaurantId;
  const query = env.MOODISH_ACCEPTANCE_QUERY || "biryani";
  await stage("food-search", async () => {
    if (!addressId) throw blocked("Needs a saved address", "PREREQUISITE");
    const usable = await gateway.searchMenu({ addressId, query });
    const summary = { rows: rawRows.search_menu ?? 0, usable: usable.length, restaurants: new Set(usable.map(item => item.restaurant.id)).size,
      needsCustomization: usable.filter(item => item.hasVariants === true || item.variantsV2?.length || item.variations?.length).length,
      vegFlagged: usable.filter(item => item.tags.includes("veg") || item.tags.includes("non-veg")).length };
    if (!summary.rows) throw Object.assign(blocked("No dishes matched the query; set MOODISH_ACCEPTANCE_QUERY", "NO_RESULTS"), { summary });
    if (!usable.length) throw unusable("Search returned dishes, but none had a price and stock the app can use", "NO_USABLE_DISHES", summary);
    restaurantId = usable[0].restaurant.id;
    return summary;
  });

  await stage("menu-detail", async () => {
    if (!restaurantId) throw blocked("Needs a usable dish from food search", "PREREQUISITE");
    const menu = await gateway.getRestaurantMenu({ restaurantId, addressId });
    const summary = { items: menu.items.length, priced: menu.items.filter(item => Number.isFinite(item.price)).length,
      inStockKnown: menu.items.filter(item => item.inStock !== undefined).length, restaurantPresent: Boolean(menu.restaurant) };
    if (!summary.priced) throw unusable("The restaurant menu has no priced items", "NO_USABLE_ITEMS", summary);
    return summary;
  });

  await stage("current-cart", async () => {
    if (!addressId) throw blocked("Needs a saved address", "PREREQUISITE");
    const cart = await gateway.getFoodCart({ addressId });
    return { items: cart.items.length, empty: cart.items.length === 0, totalPresent: Number.isFinite(cart.total),
      authoritativeTotal: cart.pricing?.to_pay !== undefined, sameRestaurantAsSearch: Boolean(restaurantId) && cart.restaurantId === restaurantId };
  });

  await stage("instamart", async () => {
    if (!addressId) throw blocked("Needs a saved address", "PREREQUISITE");
    const products = await gateway.searchProducts({ addressId, query: env.MOODISH_ACCEPTANCE_INSTAMART_QUERY || "soda" });
    // The app keeps Food working when Instamart fails; the harness still reports it.
    const warning = gateway.warnings.find(entry => entry.service === "instamart");
    if (warning) throw Object.assign(new Error(warning.message), { code: warning.code });
    const summary = { rows: rawRows.search_products ?? 0, products: products.length, priced: products.filter(product => Number.isFinite(product.price)).length };
    if (!summary.rows) throw Object.assign(blocked("No products matched; set MOODISH_ACCEPTANCE_INSTAMART_QUERY", "NO_RESULTS"), { summary });
    if (!summary.priced) throw unusable("Instamart returned products, but none were in stock with a price", "NO_USABLE_PRODUCTS", summary);
    return summary;
  });
  return report(stages, env);
}

function rowCount(data) {
  if (Array.isArray(data)) return data.length;
  for (const key of ["items", "menuItems", "results", "products", "addresses", "restaurants"]) if (Array.isArray(data?.[key])) return data[key].length;
  return 0;
}

function outcomeOf(error) {
  if (error.blocked) return "blocked";
  if (error.unusable) return "unusable";
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
