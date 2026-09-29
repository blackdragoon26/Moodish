import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startLiveApp } from "./helpers/live-app.mjs";
import { saveRecommendation, getSecretSession } from "../services/agent/src/memory.mjs";

const idOf = session => JSON.parse(Buffer.from(session.split(".")[0], "base64url")).id;

async function connectedUser(app, { addressId = "addr-1" } = {}) {
  const session = app.user(`google:cart-${crypto.randomUUID()}`);
  await app.connect(session);
  assert.equal((await app.request("/api/swiggy/address", { body: { addressId }, session })).status, 200);
  return session;
}

async function recommend(app, session) {
  const recommendation = await app.request("/api/recommendations/personal", { body: { mood: "soya chaap", maxBudget: 600, dietMode: "veg" }, session });
  assert.equal(recommendation.status, 200);
  assert.equal(recommendation.body.transparency.dataSource, "live");
  return recommendation.body;
}

async function seeded(session, items, { address = { id: "addr-1", label: "Home", display: "Flat 1, Test Street" } } = {}) {
  const recommendation = { recommendationId: `seeded_${crypto.randomUUID()}`, ownerId: idOf(session), address,
    options: [{ optionId: "option-1", restaurantId: items[0].restaurantId, restaurantName: "Fake Chaap House", items }] };
  await saveRecommendation(recommendation);
  return recommendation;
}

async function review(app, session, recommendation, extra = {}) {
  return app.request("/api/cart/prepare", { body: { recommendationId: recommendation.recommendationId, optionId: recommendation.options[0].optionId, ...extra }, session });
}

function confirmBody(recommendation, prepared, extra = {}) {
  return { recommendationId: recommendation.recommendationId, optionId: recommendation.options[0].optionId, preparationId: prepared.preparationId, confirmed: true, ...extra };
}

test("personal journey: review is read-only, confirmation writes once and reports Swiggy's total", async t => {
  const app = await startLiveApp(t);
  const alice = await connectedUser(app);
  const recommendation = await recommend(app, alice);
  const prepared = await review(app, alice, recommendation);
  assert.equal(prepared.status, 200);
  assert.equal(prepared.body.canConfirm, true);
  assert.equal(prepared.body.dataSource, "live");
  assert.deepEqual(prepared.body.address, { id: "addr-1", label: "Home", display: "Flat 1, Test Street" });
  assert.equal(prepared.body.estimatedItemTotal, 250);
  assert.match(prepared.body.note, /not the final bill/);
  assert.equal(app.fake.writes(), 0, "prepare never mutates");

  const confirmed = await app.request("/api/cart/confirm", { body: confirmBody(recommendation, prepared.body), session: alice });
  assert.equal(confirmed.status, 200);
  assert.equal(app.fake.writes(), 1);
  assert.equal(confirmed.body.foodCart.total, 292, "authoritative total is Swiggy's to_pay, not the item estimate");
  assert.equal(confirmed.body.mutationApplied, true);
  assert.equal(confirmed.body.checkoutBlocked, true);
  const write = app.fake.calls("update_food_cart")[0].args;
  assert.deepEqual(write, { restaurantId: "rest-1", addressId: "addr-1", cartItems: [{ menu_item_id: "dish-1", quantity: 1 }] });

  // A completed retry returns the stored result without another write.
  const retry = await app.request("/api/cart/confirm", { body: confirmBody(recommendation, prepared.body), session: alice });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.foodCart.total, 292);
  assert.equal(app.fake.writes(), 1);
});

test("concurrent confirmations of one review perform exactly one write", async t => {
  const app = await startLiveApp(t);
  const alice = await connectedUser(app);
  const recommendation = await recommend(app, alice);
  const prepared = await review(app, alice, recommendation);
  const results = await Promise.all(Array.from({ length: 5 }, () => app.request("/api/cart/confirm", { body: confirmBody(recommendation, prepared.body), session: alice })));
  assert.deepEqual(results.map(result => result.status), [200, 200, 200, 200, 200]);
  assert.equal(app.fake.writes(), 1);
});

test("a non-empty Swiggy cart is shown but cannot be overwritten or merged", async t => {
  const app = await startLiveApp(t);
  const alice = await connectedUser(app);
  const recommendation = await recommend(app, alice);
  app.fake.setCart({ restaurantId: "rest-1", items: [{ menu_item_id: "dish-2", quantity: 2 }] });
  const prepared = await review(app, alice, recommendation);
  assert.equal(prepared.status, 200);
  assert.equal(prepared.body.canConfirm, false);
  assert.equal(prepared.body.replacesExistingCart, true);
  assert.match(prepared.body.blockedReason, /adds to that cart/);
  assert.equal(prepared.body.existingCart.items[0].itemId, "dish-2");
  const confirmed = await app.request("/api/cart/confirm", { body: confirmBody(recommendation, prepared.body), session: alice });
  assert.equal(confirmed.status, 409);
  assert.equal(app.fake.writes(), 0);
});

test("stale reviews are rejected before any write", async t => {
  const app = await startLiveApp(t);
  const cases = {
    "review expired": async () => { const now = Date.now; Date.now = () => now() + 5 * 60_000 + 1; return () => { Date.now = now; }; },
    "address removed": async () => { app.fake.state.catalog.addresses = app.fake.state.catalog.addresses.filter(a => a.id !== "addr-1"); },
    "address changed": async () => { app.fake.state.catalog.addresses[0].addressLine = "Somewhere else"; },
    "price changed": async () => { app.fake.state.catalog.restaurants["rest-1"].items[0].price = 275; },
    "out of stock": async () => { app.fake.state.catalog.restaurants["rest-1"].items[0].inStock = 0; },
    "cart changed": async () => { app.fake.setCart({ restaurantId: "rest-1", items: [{ menu_item_id: "dish-2", quantity: 1 }] }); },
    "connection changed": async session => { await app.connect(session); }
  };
  for (const [name, change] of Object.entries(cases)) {
    app.fake.state.catalog = (await import("./helpers/fake-swiggy.mjs")).defaultCatalog();
    app.fake.setCart({ restaurantId: null, items: [] });
    const alice = await connectedUser(app);
    const recommendation = await recommend(app, alice);
    const prepared = await review(app, alice, recommendation);
    assert.equal(prepared.body.canConfirm, true, name);
    const undo = await change(alice);
    const confirmed = await app.request("/api/cart/confirm", { body: confirmBody(recommendation, prepared.body), session: alice });
    if (typeof undo === "function") undo();
    assert.equal(confirmed.status, 409, `${name}: ${confirmed.body.error}`);
    assert.match(confirmed.body.error, /again|fresh/i, name);
    assert.equal(app.fake.writes(), 0, `${name} must not write`);
  }
});

test("tampered or mismatched confirmations are refused without a write", async t => {
  const app = await startLiveApp(t);
  const alice = await connectedUser(app);
  const recommendation = await recommend(app, alice);
  const prepared = await review(app, alice, recommendation);
  const attempts = [
    confirmBody(recommendation, prepared.body, { optionId: "rest-1_dish-2" }),
    confirmBody(recommendation, prepared.body, { restaurantId: "rest-other" }),
    confirmBody(recommendation, prepared.body, { addOnProductIds: ["spin-1"] }),
    confirmBody(recommendation, prepared.body, { preparationId: crypto.randomUUID() }),
    confirmBody(recommendation, { preparationId: "../../etc" })
  ];
  for (const body of attempts) {
    const result = await app.request("/api/cart/confirm", { body, session: alice });
    assert.ok([403, 404].includes(result.status), `${JSON.stringify(body)} -> ${result.status}`);
  }
  const unconfirmed = await app.request("/api/cart/confirm", { body: { ...confirmBody(recommendation, prepared.body), confirmed: "true" }, session: alice });
  assert.equal(unconfirmed.status, 409);
  const legacy = await app.request("/api/cart/confirm", { body: { ...confirmBody(recommendation, prepared.body), preparationId: undefined }, session: alice });
  assert.equal(legacy.status, 428, "a client without the review step is told to update");
  assert.equal(app.fake.writes(), 0);
  // The genuine review is still usable after rejected tampering.
  assert.equal((await app.request("/api/cart/confirm", { body: confirmBody(recommendation, prepared.body), session: alice })).status, 200);
  assert.equal(app.fake.writes(), 1);
});

test("invalid items, quantities, customizations and multi-restaurant plans are explained, not written", async t => {
  const app = await startLiveApp(t);
  const alice = await connectedUser(app);
  const custom = await seeded(alice, [{ itemId: "dish-custom", name: "Build Your Thali", price: 300, quantity: 1, restaurantId: "rest-1" }]);
  const customized = await review(app, alice, custom);
  assert.equal(customized.status, 422);
  assert.match(customized.body.error, /needs customization/);
  const missing = await review(app, alice, await seeded(alice, [{ itemId: "dish-gone", name: "Soya Chaap", price: 250, quantity: 1, restaurantId: "rest-1" }]));
  assert.equal(missing.status, 409);
  assert.match(missing.body.error, /unavailable/);
  for (const quantity of [0, -1, 1.5, 501, "two", null]) {
    const invalid = await review(app, alice, await seeded(alice, [{ itemId: "dish-1", name: "Soya Chaap", price: 250, quantity, restaurantId: "rest-1" }]));
    assert.equal(invalid.status, 422, `quantity ${JSON.stringify(quantity)}`);
  }
  const split = await seeded(alice, [
    { itemId: "dish-1", name: "Soya Chaap", price: 250, quantity: 1, restaurantId: "rest-1" },
    { itemId: "dish-9", name: "Other", price: 100, quantity: 1, restaurantId: "rest-2" }
  ]);
  const ambiguous = await review(app, alice, split);
  assert.equal(ambiguous.status, 409);
  assert.match(ambiguous.body.error, /Choose one restaurant/);
  assert.equal((await review(app, alice, split, { restaurantId: "rest-3" })).status, 400);
  const chosen = await review(app, alice, split, { restaurantId: "rest-1" });
  assert.equal(chosen.status, 200);
  assert.deepEqual(chosen.body.items.map(item => item.itemId), ["dish-1"]);
  assert.equal((await review(app, alice, custom, { optionId: "not-an-option" })).status, 404);
  assert.equal(app.fake.writes(), 0);
});

test("ambiguous and failed writes are never replayed or reported as success", async t => {
  const app = await startLiveApp(t);
  for (const [fault, expectedStatus] of [["timeout-after-write", 504], ["timeout", 504], ["network", 502], ["success-false", 502], ["isError", 502], [{ http: 500 }, 502]]) {
    app.fake.clearFaults();
    app.fake.setCart({ restaurantId: null, items: [] });
    const alice = await connectedUser(app);
    const recommendation = await recommend(app, alice);
    const prepared = await review(app, alice, recommendation);
    const writesBefore = app.fake.writes();
    app.fake.fault("update_food_cart", fault);
    const failed = await app.request("/api/cart/confirm", { body: confirmBody(recommendation, prepared.body), session: alice });
    assert.equal(failed.status, expectedStatus, `${JSON.stringify(fault)}: ${failed.body.error}`);
    assert.equal(app.fake.writes() - writesBefore, 1, `${JSON.stringify(fault)} is attempted once, never retried`);
    app.fake.clearFaults();
    const retry = await app.request("/api/cart/confirm", { body: confirmBody(recommendation, prepared.body), session: alice });
    assert.equal(retry.status, 409, `${JSON.stringify(fault)} retry`);
    assert.match(retry.body.error, /uncertain result/);
    assert.equal(app.fake.writes() - writesBefore, 1, "no automatic replay");
    const stored = await getSecretSession(`cart-prepare:${prepared.body.preparationId}`);
    assert.equal(stored.state, "uncertain");
    // The read-back after the failure records whether Swiggy has the requested cart.
    assert.equal(stored.matchesRequested, fault === "timeout-after-write");
  }
});

test("a read-back that differs from the review is an error, not a success", async t => {
  const app = await startLiveApp(t);
  const alice = await connectedUser(app);
  const recommendation = await recommend(app, alice);
  const prepared = await review(app, alice, recommendation);
  let reads = 0;
  app.fake.fault("get_food_cart", () => (++reads > 1 ? { data: { restaurant: { id: "rest-1" }, items: [{ menu_item_id: "dish-1", quantity: 3, final_price: 750 }], pricing: { to_pay: 792 } } } : null));
  const confirmed = await app.request("/api/cart/confirm", { body: confirmBody(recommendation, prepared.body), session: alice });
  assert.equal(confirmed.status, 409);
  assert.match(confirmed.body.error, /different cart contents/);
  assert.equal(app.fake.writes(), 1);
  assert.equal((await getSecretSession(`cart-prepare:${prepared.body.preparationId}`)).state, "uncertain");
});

test("group journey: only the purchasing creator reviews and confirms, once", async t => {
  const app = await startLiveApp(t);
  const creator = await connectedUser(app);
  const created = await app.request("/api/group-sessions", { body: { headcount: 2, budgetPerPerson: 400, approvalMode: "manager_decides", coManagerIds: ["google:co-manager"] }, session: creator });
  assert.equal(created.status, 201);
  const group = created.body;
  const groupCall = (action, body, session, headers = {}) => app.request(`/api/group-sessions/${group.sessionId}/${action}`, { body, session, headers: { authorization: `Bearer ${group.accessToken}`, ...headers } });
  const { signGroupAccessToken } = await import("../services/agent/src/access-token.mjs");
  const coToken = signGroupAccessToken({ sessionId: group.sessionId, actorId: "google:co-manager" });
  await app.request(`/api/group-sessions/${group.sessionId}/preferences`, { body: { participantId: "p1", invitePasscode: group.invitePasscode, mood: "soya chaap", dietMode: "veg", allergies: ["private-allergy"] } });
  assert.equal((await groupCall("connect", {}, creator)).status, 200);
  const ranked = await app.request(`/api/group-sessions/${group.sessionId}/rank`, { body: {}, headers: { authorization: `Bearer ${coToken}` } });
  assert.equal(ranked.status, 200, ranked.body.error);
  const optionId = ranked.body.recommendation.options[0].optionId;
  assert.equal((await app.request(`/api/group-sessions/${group.sessionId}/select`, { body: { optionId }, headers: { authorization: `Bearer ${coToken}` } })).status, 200, "co-managers can select");

  const coManagerUser = app.user("google:co-manager");
  for (const action of ["prepare-cart", "confirm-cart"]) {
    const asCoManager = await app.request(`/api/group-sessions/${group.sessionId}/${action}`, { body: { confirmed: true }, session: coManagerUser, headers: { authorization: `Bearer ${coToken}` } });
    assert.equal(asCoManager.status, 403, `co-manager ${action}`);
  }
  const restaurantId = ranked.body.recommendation.options[0].items[0].restaurantId || ranked.body.recommendation.options[0].restaurantId;
  const prepared = await groupCall("prepare-cart", { restaurantId }, creator);
  assert.equal(prepared.status, 200, prepared.body.error);
  assert.equal(app.fake.writes(), 0);
  const confirm = () => groupCall("confirm-cart", { confirmed: true, restaurantId, preparationId: prepared.body.preparationId }, creator);
  const [first, second] = await Promise.all([confirm(), confirm()]);
  assert.deepEqual([first.status, second.status], [200, 200]);
  assert.equal(first.body.state, "cart_built");
  assert.equal(app.fake.writes(), 1);
  assert.equal((await confirm()).status, 200, "a completed retry returns the stored group result");
  assert.equal(app.fake.writes(), 1);
  // Participants never see private preferences.
  const publicView = await app.request(`/api/group-sessions/${group.sessionId}`);
  assert.equal(JSON.stringify(publicView.body).includes("private-allergy"), false);
  assert.equal(publicView.body.creatorId, undefined);
});
