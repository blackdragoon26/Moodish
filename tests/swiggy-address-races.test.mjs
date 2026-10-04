import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startLiveApp } from "./helpers/live-app.mjs";
import { getSecretSession, saveSecretSession } from "../services/agent/src/memory.mjs";
import { disconnectSwiggy, selectSwiggyAddress } from "../services/agent/src/swiggy-auth.mjs";

test("an address update racing with disconnect never recreates the connection", async () => {
  const userId = `address-race-${crypto.randomUUID()}`;
  await saveSecretSession(`swiggy:${userId}`, { accessToken: "synthetic", expiresAt: Date.now() + 3600000, version: "v1" });
  await Promise.allSettled([selectSwiggyAddress(userId, "addr-1"), disconnectSwiggy(userId)]);
  assert.equal(await getSecretSession(`swiggy:${userId}`), undefined);
});

for (const action of ["disconnect", "reconnect"]) {
  test(`address validation cannot apply to a connection changed by ${action}`, async t => {
    const app = await startLiveApp(t);
    const session = app.user(`google:address-${crypto.randomUUID()}`);
    await app.connect(session);
    let entered, release;
    const validating = new Promise(resolve => { entered = resolve; });
    const resume = new Promise(resolve => { release = resolve; });
    app.fake.fault("get_addresses", async () => {
      entered();
      await resume;
      return { data: { addresses: app.fake.state.catalog.addresses } };
    });
    const selection = app.request("/api/swiggy/address", { session, body: { addressId: "addr-1" } });
    await validating;
    try {
      if (action === "disconnect") await app.request("/api/swiggy/disconnect", { session, body: {} });
      else await app.connect(session);
    } finally { release(); }
    const result = await selection;
    assert.equal(result.status, 409, JSON.stringify(result.body));
    const status = (await app.request("/api/swiggy/connection", { session })).body;
    assert.equal(status.connected, action === "reconnect");
    assert.equal(status.selectedAddressId, null);
  });
}
