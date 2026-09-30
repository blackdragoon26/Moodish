import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLiveAcceptance } from "../scripts/live-acceptance.mjs";
import { saveSecretSession } from "../services/agent/src/memory.mjs";
import { encryptToken } from "../services/agent/src/swiggy-auth.mjs";
import { installFakeSwiggy } from "./helpers/fake-swiggy.mjs";

// The harness is exercised against the fake provider only; real live runs are
// manual and opt-in, never part of CI.
const secretToken = "live-secret-access-token-value";
const userId = "google:harness-private-user-id";
const env = { MOODISH_LIVE_ACCEPTANCE: "1", DATABASE_URL: "postgresql://unused", TOKEN_ENCRYPTION_KEY: "test-only-token-encryption-key-0123456789", MOODISH_ACCEPTANCE_USER_ID: userId, MOODISH_ACCEPTANCE_QUERY: "chaap" };

async function withConnection(t, session = {}) {
  const previous = { key: process.env.TOKEN_ENCRYPTION_KEY, mode: process.env.SWIGGY_MODE };
  process.env.TOKEN_ENCRYPTION_KEY = env.TOKEN_ENCRYPTION_KEY;
  const fake = installFakeSwiggy();
  await saveSecretSession(`swiggy:${userId}`, { accessToken: encryptToken(secretToken), expiresAt: Date.now() + 3_600_000, version: "v1", selectedAddressId: "addr-1", ...session });
  t.after(() => {
    fake.restore();
    for (const [key, value] of [["TOKEN_ENCRYPTION_KEY", previous.key], ["SWIGGY_MODE", previous.mode]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  return fake;
}

test("the harness does nothing live unless explicitly opted in and configured", async () => {
  const result = await runLiveAcceptance({ env: { ...env, MOODISH_LIVE_ACCEPTANCE: undefined, DATABASE_URL: undefined } });
  assert.equal(result.result, "BLOCKED");
  assert.deepEqual(result.stages, [{ stage: "configuration", status: "BLOCKED", outcome: "blocked", summary: { missing: ["DATABASE_URL"], optIn: false } }]);
});

test("a healthy account passes every read-only stage without any cart write or leaked value", async t => {
  const fake = await withConnection(t);
  const dir = mkdtempSync(join(tmpdir(), "moodish-shapes-"));
  const result = await runLiveAcceptance({ env, captureShapes: dir });
  assert.equal(result.result, "PASS", JSON.stringify(result.stages));
  assert.deepEqual(result.stages.map(stage => stage.stage), ["connection", "addresses", "food-search", "menu-detail", "current-cart", "instamart"]);
  assert.equal(fake.writes(), 0);
  assert.ok(fake.calls().every(call => ["get_addresses", "search_menu", "get_restaurant_menu", "get_food_cart", "search_products"].includes(call.name)));
  const output = JSON.stringify(result) + readdirSync(dir).map(file => readFileSync(join(dir, file), "utf8")).join("");
  for (const secret of [secretToken, userId, "+910000000001", "Flat 1, Test Street", "Fake Chaap House", "Soya Chaap", "addr-1", "rest-1", "dish-1"]) {
    assert.equal(output.includes(secret), false, `output must not contain ${secret}`);
  }
  const shape = JSON.parse(readFileSync(join(dir, "get_addresses.shape.json"), "utf8"));
  assert.deepEqual(shape.addresses[0], { addressLine: "<string>", addressTag: "<string>", id: "<string>", phoneNumber: "<string>" });
});

test("each stage reports its own outcome", async t => {
  const cases = [
    [{ get_addresses: { http: 401 } }, "addresses", "FAIL", "expired"],
    [{ search_menu: { http: 403 } }, "food-search", "FAIL", "denied"],
    // Search reads each result's menu, so a malformed menu fails the search stage.
    [{ get_restaurant_menu: { data: { unexpected: true } } }, "food-search", "FAIL", "malformed"],
    [{ get_food_cart: "timeout" }, "current-cart", "FAIL", "timeout"],
    [{ search_products: "success-false" }, "instamart", "FAIL", "tool-error"]
  ];
  for (const [faults, stageName, status, outcome] of cases) {
    const fake = await withConnection(t);
    for (const [tool, fault] of Object.entries(faults)) fake.fault(tool, fault);
    const result = await runLiveAcceptance({ env });
    const stage = result.stages.find(entry => entry.stage === stageName);
    assert.deepEqual([stage.status, stage.outcome], [status, outcome], `${stageName}: ${JSON.stringify(stage)}`);
    assert.equal(result.result, "FAIL");
    fake.restore();
  }
  const fake = await withConnection(t);
  fake.state.tools.im.delete("search_products");
  const unavailable = await runLiveAcceptance({ env });
  assert.deepEqual(unavailable.stages.at(-1), { stage: "instamart", status: "FAIL", outcome: "unavailable", code: "SWIGGY_CAPABILITY_UNAVAILABLE", summary: {} });
});

test("missing prerequisites are BLOCKED, never PASS", async t => {
  const fake = await withConnection(t);
  fake.state.catalog.addresses = [];
  const noAddresses = await runLiveAcceptance({ env });
  assert.equal(noAddresses.result, "BLOCKED");
  assert.deepEqual(noAddresses.stages.filter(stage => stage.status === "BLOCKED").map(stage => stage.stage), ["addresses", "food-search", "menu-detail", "current-cart", "instamart"]);
  fake.restore();
  await withConnection(t);
  const unknown = await runLiveAcceptance({ env: { ...env, MOODISH_ACCEPTANCE_ADDRESS_ID: "addr-not-in-account" } });
  assert.deepEqual([unknown.result, unknown.stages[1].code], ["BLOCKED", "ADDRESS_NOT_FOUND"]);
  const noMatch = await runLiveAcceptance({ env: { ...env, MOODISH_ACCEPTANCE_QUERY: "zzzz" } });
  assert.deepEqual([noMatch.result, noMatch.stages[2].status, noMatch.stages[2].code], ["BLOCKED", "BLOCKED", "NO_RESULTS"]);
  await saveSecretSession(`swiggy:${userId}`, { accessToken: null, expiresAt: 0, version: "v2" });
  const expired = await runLiveAcceptance({ env });
  assert.deepEqual([expired.result, expired.stages[0].code], ["BLOCKED", "SWIGGY_REAUTH_REQUIRED"]);
});

test("dishes without usable prices can never PASS", async t => {
  const fake = await withConnection(t);
  for (const item of fake.state.catalog.restaurants["rest-1"].items) delete item.price;
  const result = await runLiveAcceptance({ env });
  assert.equal(result.result, "FAIL");
  const search = result.stages.find(stage => stage.stage === "food-search");
  assert.deepEqual([search.status, search.outcome, search.code], ["FAIL", "unusable", "NO_USABLE_DISHES"]);
  assert.deepEqual([search.summary.rows > 0, search.summary.usable], [true, 0]);
  assert.equal(result.stages.find(stage => stage.stage === "menu-detail").status, "BLOCKED");
});

test("a menu with no priced, in-stock item cannot PASS even when search finds a dish", async t => {
  const fake = await withConnection(t);
  // Search rows stay available; the restaurant's own menu says everything is sold out.
  fake.fault("get_restaurant_menu", { data: { restaurant: { id: "rest-1", name: "Fake Chaap House" }, items: [{ id: "dish-1", name: "Soya Chaap", price: 250, inStock: 0 }, { id: "dish-2", name: "Roti", price: 40, inStock: false }] } });
  const result = await runLiveAcceptance({ env });
  const menu = result.stages.find(stage => stage.stage === "menu-detail");
  assert.equal(result.stages.find(stage => stage.stage === "food-search").status, "PASS");
  assert.deepEqual([menu.status, menu.code, menu.summary.priced, menu.summary.orderable], ["FAIL", "NO_USABLE_ITEMS", 2, 0]);
  assert.equal(result.result, "FAIL");
});

test("addresses are read across pages like the app, whichever address is used", async t => {
  const fake = await withConnection(t, { selectedAddressId: "addr-page-2" });
  fake.fault("get_addresses", ({ args }) => (args.page ?? 1) === 1
    ? { data: { addresses: [{ id: "addr-1", addressLine: "Line 1" }], pagination: { page: 1, hasMore: true } } }
    : { data: { addresses: [{ id: "addr-page-2", addressLine: "Line 2" }], pagination: { page: 2, hasMore: false } } });
  const result = await runLiveAcceptance({ env });
  assert.deepEqual(result.stages[1].summary, { count: 2, source: "app-selected", appSelectionFound: true, displayPresent: true });
  assert.ok(fake.calls("search_menu").every(call => call.args.addressId === "addr-page-2"));
});

test("before live mode, a demo address in the app falls back to the account's first saved address", async t => {
  await withConnection(t, { selectedAddressId: "addr-home" });
  const result = await runLiveAcceptance({ env });
  assert.equal(result.result, "PASS", JSON.stringify(result.stages));
  assert.deepEqual([result.stages[1].summary.source, result.stages[1].summary.appSelectionFound], ["first-saved", false]);
});
