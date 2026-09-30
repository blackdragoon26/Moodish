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

test("a failed PostgreSQL sweep is retried instead of waiting an hour", async () => {
  // A listener that drops every connection makes each sweep fail.
  const net = await import("node:net");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  let attempts = 0;
  const server = net.createServer(socket => { attempts += 1; socket.destroy(); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const memory = new URL("../services/agent/src/memory.mjs", import.meta.url).href;
    await promisify(execFile)(process.execPath, ["--input-type=module", "-e", `import { pruneExpiredFlows } from ${JSON.stringify(memory)};
      for (let i = 0; i < 3; i++) await pruneExpiredFlows(Date.now() + i).catch(() => {});`],
      { env: { PATH: process.env.PATH, DATABASE_URL: `postgresql://u:p@127.0.0.1:${server.address().port}/db`, MOODISH_RUNTIME_ENV_FILE: "/nonexistent" }, timeout: 20000 });
    assert.equal(attempts, 3);
  } finally { server.close(); }
});
