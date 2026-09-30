import test from "node:test";
import assert from "node:assert/strict";
import { saveSecretSession, getSecretSession, pruneExpiredFlows } from "../services/agent/src/memory.mjs";

test("expired login and exchange records are pruned; cart reviews and connections are kept", { skip: Boolean(process.env.DATABASE_URL) && "PostgreSQL storage is covered by postgres-state" }, async () => {
  const old = Date.now() - 2 * 86_400_000;
  const keys = { "google-flow:stale": old, "platform-flow:stale": old, "swiggy-flow:stale": old, "mobile:stale": old, "mobile:fresh": Date.now() + 60_000 };
  for (const [key, expiresAt] of Object.entries(keys)) await saveSecretSession(key, { expiresAt });
  await saveSecretSession("cart-prepare:old", { state: "uncertain", expiresAt: old });
  await saveSecretSession("swiggy:someone", { expiresAt: old, version: "v1" });
  assert.ok(await pruneExpiredFlows(Date.now() + 7_200_000) >= 4);
  for (const key of ["google-flow:stale", "platform-flow:stale", "swiggy-flow:stale", "mobile:stale"]) assert.equal(await getSecretSession(key), undefined, key);
  for (const key of ["mobile:fresh", "cart-prepare:old", "swiggy:someone"]) assert.ok(await getSecretSession(key), key);
  assert.equal(await pruneExpiredFlows(Date.now() + 7_200_000 + 1000), 0, "at most once an hour");
});
