import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startLiveApp } from "./helpers/live-app.mjs";
import { runLiveAcceptance } from "../scripts/live-acceptance.mjs";

// The staged rollout in docs/myprod-deployment.md, through the real routes.
test("staged rollout: connect in fixture mode, pass the live harness, then go live and choose a real address", async t => {
  const app = await startLiveApp(t, { env: { SWIGGY_MODE: "fixture" } });
  const userId = `google:rollout-${crypto.randomUUID()}`;
  const session = app.user(userId);

  // Step 2: OAuth enabled while the app still serves demo data.
  const connected = await app.connect(session);
  assert.equal(connected.location, "/?login=swiggy");
  assert.equal((await app.request("/api/swiggy/connection", { session })).body.connected, true);
  const demoAddresses = (await app.request("/api/swiggy/addresses", { session })).body.addresses;
  assert.deepEqual(demoAddresses.map(address => address.id), ["addr-home"], "fixture mode still shows demo addresses");

  // Step 3: the read-only harness reads the real account without an app-selected address.
  const harness = await runLiveAcceptance({ env: { MOODISH_LIVE_ACCEPTANCE: "1", DATABASE_URL: "postgresql://unused", TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY, MOODISH_ACCEPTANCE_USER_ID: userId, MOODISH_ACCEPTANCE_QUERY: "chaap" } });
  assert.equal(harness.result, "PASS", JSON.stringify(harness.stages));
  assert.equal(harness.stages[1].summary.source, "first-saved");
  assert.equal(app.fake.writes(), 0);
  assert.equal(process.env.SWIGGY_MODE, "fixture", "the harness does not switch the app's mode");

  // Step 4: live mode lists the account's real addresses; choosing one enables live plans.
  process.env.SWIGGY_MODE = "live";
  const real = (await app.request("/api/swiggy/addresses", { session })).body.addresses;
  assert.deepEqual(real.map(address => address.id), ["addr-1", "addr-2"]);
  assert.equal((await app.request("/api/swiggy/address", { body: { addressId: "addr-1" }, session })).status, 200);
  const plan = await app.request("/api/recommendations/personal", { body: { mood: "soya chaap", maxBudget: 600, dietMode: "veg" }, session });
  assert.equal(plan.status, 200);
  assert.equal(plan.body.transparency.dataSource, "live");
});
