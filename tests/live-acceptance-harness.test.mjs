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
    [{ get_restaurant_menu: { data: { unexpected: true } } }, "menu-detail", "FAIL", "malformed"],
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
  await withConnection(t, { selectedAddressId: undefined });
  const noAddress = await runLiveAcceptance({ env });
  assert.equal(noAddress.result, "BLOCKED");
  assert.deepEqual(noAddress.stages.filter(stage => stage.status === "BLOCKED").map(stage => stage.stage), ["addresses", "food-search", "menu-detail", "current-cart", "instamart"]);
  await saveSecretSession(`swiggy:${userId}`, { accessToken: null, expiresAt: 0, version: "v2" });
  const expired = await runLiveAcceptance({ env });
  assert.deepEqual([expired.result, expired.stages[0].code], ["BLOCKED", "SWIGGY_REAUTH_REQUIRED"]);
});
