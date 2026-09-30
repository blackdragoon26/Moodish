import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';

const execute = promisify(execFile);
const database = process.env.MOODISH_TEST_DATABASE_URL;
const src = name => JSON.stringify(new URL(`../services/agent/src/${name}`, import.meta.url).href);
const fakeUrl = JSON.stringify(new URL('./helpers/fake-swiggy.mjs', import.meta.url).href);
// Each call is a separate Node process: a separate pool, memory and module state,
// like two app replicas or an app restart. Only PostgreSQL is shared.
const run = async (script, env = {}) => {
  const { stdout } = await execute(process.execPath, ['--input-type=module', '-e', `
    import { saveSecretSession, getSecretSession, takeSecretSession, deleteSecretSession, withAccountLock, saveRecommendation } from ${src('memory.mjs')};
    import { startSwiggyOAuth, completeSwiggyOAuth, getSwiggyConnectionStatus, encryptToken } from ${src('swiggy-auth.mjs')};
    import { createTools, createToolRuntime } from ${src('tools.mjs')};
    import { installFakeSwiggy } from ${fakeUrl};
    ${script}
    process.exit(0);
  `], { env: { ...process.env, DATABASE_URL: database, NODE_ENV: 'test', SWIGGY_MODE: 'live',
    TOKEN_ENCRYPTION_KEY: 'test-only-token-encryption-key-0123456789', MOODISH_RUNTIME_ENV_FILE: '/nonexistent', ...env }, timeout: 30000 });
  return stdout.trim();
};
const json = async (script, env) => JSON.parse((await run(script, env)).split('\n').at(-1));

// A missing database must not look like a pass in CI.
const skip = !database && !process.env.CI;
test('PostgreSQL integration tests have a database in CI', { skip: !process.env.CI }, () => {
  assert.ok(database, 'Set MOODISH_TEST_DATABASE_URL so durable-state tests run');
});

test('PostgreSQL records and advisory locks survive separate app processes', { skip }, async () => {
  const prefix = `integration:${crypto.randomUUID()}`;
  const counter = JSON.stringify(`${prefix}:counter`);
  const single = JSON.stringify(`${prefix}:single`);
  try {
    await run(`await saveSecretSession(${counter}, { count: 0 }); await saveSecretSession(${single}, { once: true });`);
    const increment = `for (let i = 0; i < 8; i++) await withAccountLock(${counter}, async () => {
      const current = await getSecretSession(${counter});
      await new Promise(resolve => setTimeout(resolve, 5));
      await saveSecretSession(${counter}, { count: current.count + 1 });
    });`;
    await Promise.all([run(increment), run(increment)]);
    assert.equal(await run(`console.log((await getSecretSession(${counter})).count);`), '16');
    const consumed = await Promise.all([run(`console.log(Boolean(await takeSecretSession(${single})));`), run(`console.log(Boolean(await takeSecretSession(${single})));`)]);
    assert.deepEqual(consumed.sort(), ['false', 'true']);
    // More operations than pool slots must not deadlock; nested group/cart locks
    // must reuse their connection while writes remain autocommitted before MCP.
    await run(`await Promise.all(Array.from({ length: 15 }, (_, i) => withAccountLock(${counter} + i, () => withAccountLock(${counter} + ':nested:' + i, async () => {
      await saveSecretSession(${counter} + i, { value: i });
      await deleteSecretSession(${counter} + i);
    }))));`);
  } finally {
    await run(`await deleteSecretSession(${counter}); await deleteSecretSession(${single});`);
  }
});

test('a failing locked operation releases its lock and pool connection', { skip }, async () => {
  const key = JSON.stringify(`integration:${crypto.randomUUID()}:failing`);
  // More failures than the default pool size (10): a leaked connection would hang.
  const result = await json(`
    let failures = 0;
    for (let i = 0; i < 25; i++) {
      try { await withAccountLock(${key}, async () => { throw new Error('boom'); }); } catch { failures++; }
    }
    console.log(JSON.stringify({ failures }));`);
  assert.equal(result.failures, 25);
  const started = Date.now();
  assert.equal(await run(`console.log(await withAccountLock(${key}, async () => 'acquired'));`), 'acquired');
  assert.ok(Date.now() - started < 10000, 'another process can take the lock at once');
});

test('an OAuth state is redeemed by exactly one of three app processes', { skip }, async () => {
  const started = await json(`
    const fake = installFakeSwiggy();
    const start = await startSwiggyOAuth({ user: { id: 'pg-oauth-${crypto.randomUUID()}' }, browserBinding: 'browser-1', redirectUri: 'https://moodish.example/api/auth/swiggy/callback' });
    fake.restore();
    console.log(JSON.stringify({ state: new URL(start.authorizationUrl).searchParams.get('state') }));`);
  const redeem = `
    const fake = installFakeSwiggy({ tokenResponse: () => ({ access_token: 'pg-token', expires_in: 3600 }) });
    let ok = false;
    try { await completeSwiggyOAuth({ state: ${JSON.stringify(started.state)}, code: 'code', browserBinding: 'browser-1' }); ok = true; } catch {}
    console.log(JSON.stringify({ ok, tokenCalls: fake.calls('token').length }));`;
  const results = await Promise.all([json(redeem), json(redeem), json(redeem)]);
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal(results.reduce((sum, r) => sum + r.tokenCalls, 0), 1, 'only the winner exchanged the code');
});

async function preparedLiveCart(userId) {
  return json(`
    installFakeSwiggy();
    await saveSecretSession('swiggy:${userId}', { accessToken: encryptToken('pg-token'), expiresAt: Date.now() + 3600000, version: 'v1', selectedAddressId: 'addr-1' });
    const tools = createTools(createToolRuntime({ userId: '${userId}' }));
    const recommendation = await tools.plan_personal_meal({ userIdHash: '${userId}', mood: 'soya chaap', maxBudget: 600, dietMode: 'veg', addressId: 'addr-1' });
    const option = recommendation.options[0];
    const review = await tools.prepare_cart({ userIdHash: '${userId}', recommendationId: recommendation.recommendationId, optionId: option.optionId });
    console.log(JSON.stringify({ recommendationId: recommendation.recommendationId, optionId: option.optionId, preparationId: review.preparationId }));`);
}
const confirmIn = (userId, prepared) => `
  const fake = installFakeSwiggy();
  const tools = createTools(createToolRuntime({ userId: '${userId}' }));
  let status = 200, error = null;
  try { await tools.build_confirmed_cart({ userIdHash: '${userId}', ...${JSON.stringify(prepared)}, confirmed: true }); }
  catch (e) { status = e.status || 500; error = e.message; }
  console.log(JSON.stringify({ status, error, writes: fake.writes() }));`;

test('two app processes confirming one review write the Swiggy cart once', { skip }, async () => {
  const userId = `pg-cart-${crypto.randomUUID()}`;
  const prepared = await preparedLiveCart(userId);
  const results = await Promise.all([json(confirmIn(userId, prepared)), json(confirmIn(userId, prepared))]);
  assert.deepEqual(results.map(r => r.status), [200, 200], JSON.stringify(results));
  assert.equal(results.reduce((sum, r) => sum + r.writes, 0), 1);
  const state = await run(`console.log((await getSecretSession('cart-prepare:${prepared.preparationId}')).state);`);
  assert.equal(state, 'done');
});

test('connection state survives a restart and a reconnect invalidates older reviews', { skip }, async () => {
  const userId = `pg-restart-${crypto.randomUUID()}`;
  const prepared = await preparedLiveCart(userId);
  const status = await json(`console.log(JSON.stringify(await getSwiggyConnectionStatus('${userId}')));`);
  assert.deepEqual([status.connected, status.selectedAddressId], [true, 'addr-1']);
  await run(`const s = await getSecretSession('swiggy:${userId}'); await saveSecretSession('swiggy:${userId}', { ...s, accessToken: encryptToken('pg-token-2'), version: 'v2' });`);
  const result = await json(confirmIn(userId, prepared));
  assert.equal(result.status, 409);
  assert.match(result.error, /connection changed/);
  assert.equal(result.writes, 0);
});

test('an attempt interrupted mid-write stays blocked after restart', { skip }, async () => {
  const userId = `pg-crash-${crypto.randomUUID()}`;
  const prepared = await preparedLiveCart(userId);
  // Simulate a process that died after marking the attempt but before recording
  // the outcome. The durable marker must stop any automatic second write.
  await run(`const key = 'cart-prepare:${prepared.preparationId}'; await saveSecretSession(key, { ...(await getSecretSession(key)), state: 'attempting' });`);
  const result = await json(confirmIn(userId, prepared));
  assert.equal(result.status, 409);
  assert.match(result.error, /uncertain result/);
  assert.equal(result.writes, 0);
});

test('a 401 for an older credential cannot expire a reconnect made by another process', { skip }, async () => {
  const userId = `pg-expire-${crypto.randomUUID()}`;
  await run(`await saveSecretSession('swiggy:${userId}', { accessToken: encryptToken('new'), expiresAt: Date.now() + 3600000, version: 'v2', selectedAddressId: 'addr-1' });`);
  const result = await json(`
    const { expireSwiggyConnection } = await import(${src('swiggy-auth.mjs')});
    const stale = await expireSwiggyConnection('${userId}', 'v1');
    const afterStale = await getSwiggyConnectionStatus('${userId}');
    const current = await expireSwiggyConnection('${userId}', 'v2');
    const afterCurrent = await getSwiggyConnectionStatus('${userId}');
    console.log(JSON.stringify({ stale, afterStale: afterStale.connected, current, afterCurrent: afterCurrent.state, address: afterCurrent.selectedAddressId }));`);
  assert.deepEqual(result, { stale: false, afterStale: true, current: true, afterCurrent: 'expired', address: 'addr-1' });
});
