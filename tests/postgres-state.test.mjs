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

test('a native exchange code is redeemed once even when app processes race', { skip }, async () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const userId = `pg-mobile-${crypto.randomUUID()}`;
  const started = await json(`
    const fake = installFakeSwiggy({ tokenResponse: () => ({ access_token: 'pg-mobile-token', expires_in: 3600 }) });
    const start = await startSwiggyOAuth({ user: { id: '${userId}' }, mobileChallenge: '${challenge}', redirectUri: 'https://moodish.example/api/auth/swiggy/callback' });
    const done = await completeSwiggyOAuth({ state: new URL(start.authorizationUrl).searchParams.get('state'), code: 'code' });
    console.log(JSON.stringify({ code: done.exchangeCode, connectedBeforeExchange: (await getSwiggyConnectionStatus('${userId}')).connected }));`);
  assert.equal(started.connectedBeforeExchange, false);
  const redeem = `
    const { exchangeMobileCode } = await import(${src('swiggy-auth.mjs')});
    let ok = false;
    try { await exchangeMobileCode({ code: ${JSON.stringify(started.code)}, verifier: '${verifier}' }); ok = true; } catch {}
    console.log(JSON.stringify({ ok }));`;
  const results = await Promise.all(Array.from({ length: 4 }, () => json(redeem)));
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal((await json(`console.log(JSON.stringify(await getSwiggyConnectionStatus('${userId}')));`)).connected, true);
});

test('app processes starting together on an empty database create the schema once without errors', { skip }, async () => {
  const pg = (await import('pg')).default;
  const admin = new pg.Client({ connectionString: database });
  await admin.connect();
  const name = `moodish_fresh_${crypto.randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const fresh = new URL(database);
  fresh.pathname = `/${name}`;
  try {
    const start = `await saveSecretSession('fresh:' + process.pid, { ok: true }); console.log(JSON.stringify({ ok: true }));`;
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => json(start, { DATABASE_URL: fresh.toString() })));
    assert.deepEqual(results.map(result => result.status === 'fulfilled' ? 'ok' : String(result.reason?.stderr || result.reason).split('\n').find(line => /error/i.test(line)) || 'failed'), Array(8).fill('ok'));
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  }
});

test('a Google login started on one app process finishes on another, once', { skip }, async () => {
  const google = `globalThis.fetch = async url => new Response(JSON.stringify(String(url).includes('/token') ? { access_token: 'g' } : { sub: 'pg-google', name: 'PG' }));
    process.env.GOOGLE_CLIENT_ID = 'c'; process.env.GOOGLE_CLIENT_SECRET = 's';
    const auth = await import(${src('auth.mjs')});`;
  const started = await json(`${google}
    const url = await auth.startGoogleOAuth('https://moodish.example', { browserBinding: 'browser-1' });
    console.log(JSON.stringify({ state: new URL(url).searchParams.get('state') }));`);
  const finish = `${google}
    let ok = false; try { ok = (await auth.completeGoogleOAuth({ code: 'c', state: ${JSON.stringify(started.state)}, browserBinding: 'browser-1' })).user.id === 'google:pg-google'; } catch {}
    console.log(JSON.stringify({ ok }));`;
  const results = await Promise.all([json(finish), json(finish)]);
  assert.equal(results.filter(result => result.ok).length, 1);
});

test('expired flow records older than a day are pruned from PostgreSQL', { skip }, async () => {
  const key = `mobile:prune-${crypto.randomUUID()}`;
  const cart = `cart-prepare:prune-${crypto.randomUUID()}`;
  await run(`await saveSecretSession('${key}', { expiresAt: 0 }); await saveSecretSession('${cart}', { state: 'uncertain' });`);
  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString: database });
  await client.connect();
  await client.query("UPDATE moodish_secret_sessions SET updated_at = NOW() - INTERVAL '2 days' WHERE session_key = ANY($1)", [[key, cart]]);
  await client.end();
  await run(`const { pruneExpiredFlows } = await import(${src('memory.mjs')}); await pruneExpiredFlows();`);
  assert.equal(await run(`console.log(Boolean(await getSecretSession('${key}')))`), 'false');
  assert.equal(await run(`console.log(Boolean(await getSecretSession('${cart}')))`), 'true', 'cart attempt markers are never pruned');
});

test('with PostgreSQL, login flows and other secret records are not also kept in process memory', { skip }, async () => {
  const count = await run(`
    const { localSecretSessionCount, saveSecretSession: save, takeSecretSession: take } = await import(${src('memory.mjs')});
    for (let i = 0; i < 200; i++) await save('google-flow:leak-' + i + '-' + process.pid, { expiresAt: Date.now() + 600000 });
    await save('swiggy:leak-' + process.pid, { version: 'v1' });
    for (let i = 0; i < 200; i++) await take('google-flow:leak-' + i + '-' + process.pid);
    await take('swiggy:leak-' + process.pid);
    console.log(localSecretSessionCount());`);
  assert.equal(count, '0');
});

test('a busy account lock answers with a retry message instead of waiting forever', { skip }, async () => {
  const key = JSON.stringify(`integration:${crypto.randomUUID()}:busy`);
  const holder = run(`await withAccountLock(${key}, () => new Promise(resolve => setTimeout(resolve, 3000)));`);
  await new Promise(resolve => setTimeout(resolve, 500));
  const started = Date.now();
  const waiter = await json(`
    let status = 200, message = '';
    try { await withAccountLock(${key}, async () => {}); } catch (error) { status = error.status; message = error.message; }
    console.log(JSON.stringify({ status, message }));`, { MOODISH_LOCK_WAIT_MS: '400' });
  assert.equal(waiter.status, 409);
  assert.match(waiter.message, /updating this right now/);
  assert.ok(Date.now() - started < 2500, 'the waiter gave up before the holder finished');
  await holder;
});

test('slow account locks leave database connections free for other requests', { skip }, async () => {
  // More slow locks than the default pool of 10: without the cap they would hold
  // every connection and ordinary queries would queue behind them.
  const result = await json(`
    const locks = Array.from({ length: 12 }, (_, i) => withAccountLock('integration:slow:' + i + ':' + process.pid, () => new Promise(resolve => setTimeout(resolve, 1500)), { longRunning: true }).catch(() => {}));
    await new Promise(resolve => setTimeout(resolve, 150));
    const started = Date.now();
    await getSecretSession('integration:unrelated');
    const unrelatedMs = Date.now() - started;
    await Promise.all(locks);
    console.log(JSON.stringify({ unrelatedMs }));`, { MOODISH_LOCK_WAIT_MS: '5000' });
  assert.ok(result.unrelatedMs < 1000, `an unrelated query waited ${result.unrelatedMs}ms`);
});

test('waiting for a free lock slot is bounded too', { skip }, async () => {
  const result = await json(`
    const first = withAccountLock('integration:slot:a:' + process.pid, () => new Promise(resolve => setTimeout(resolve, 1500)), { longRunning: true });
    await new Promise(resolve => setTimeout(resolve, 100));
    let status = 200;
    try { await withAccountLock('integration:slot:b:' + process.pid, async () => {}, { longRunning: true }); } catch (error) { status = error.status; }
    // A quick lock (a participant's vote, say) is never capped behind long ones.
    const quickStarted = Date.now();
    const quick = await withAccountLock('integration:slot:quick:' + process.pid, async () => 'quick');
    const quickMs = Date.now() - quickStarted;
    await first;
    const afterwards = await withAccountLock('integration:slot:c:' + process.pid, async () => 'ok', { longRunning: true });
    console.log(JSON.stringify({ status, afterwards, quick, quickFast: quickMs < 500 }));`, { DATABASE_POOL_MAX: '3', MOODISH_LOCK_WAIT_MS: '300' });
  assert.deepEqual(result, { status: 503, afterwards: 'ok', quick: 'quick', quickFast: true });
});

test('callers waiting on a busy lock do not hold connections other requests need', { skip }, async () => {
  const result = await json(`
    const key = 'integration:contended:' + process.pid;
    const order = [];
    // Start the waiters only once the holder is inside its lock, not after a guessed delay.
    let entered; const holderIn = new Promise(resolve => { entered = resolve; });
    const holder = withAccountLock(key, async () => { entered(); await new Promise(resolve => setTimeout(resolve, 1800)); order.push('holder'); }, { longRunning: true });
    await holderIn;
    const waiters = [1, 2].map(n => withAccountLock(key, async () => { order.push('waiter'); }));
    await new Promise(resolve => setTimeout(resolve, 200));
    const started = Date.now();
    await getSecretSession('integration:unrelated:' + process.pid);
    const unrelatedMs = Date.now() - started;
    await Promise.all([holder, ...waiters]);
    console.log(JSON.stringify({ unrelatedFast: unrelatedMs < 500, unrelatedMs, order }));`, { DATABASE_POOL_MAX: '3', MOODISH_LOCK_WAIT_MS: '5000' });
  assert.deepEqual([result.unrelatedFast, result.order], [true, ['holder', 'waiter', 'waiter']], `unrelated query waited ${result.unrelatedMs}ms`);
});

test('a lock waiter whose connection arrives after its deadline gives up instead of running late', { skip }, async () => {
  // Pool of 3, all busy: a long lock on the key plus two other locks. The
  // waiter's connection only frees up after its 300 ms deadline has passed.
  const result = await json(`
    const key = 'integration:late:' + process.pid;
    let entered; const holderIn = new Promise(resolve => { entered = resolve; });
    const holder = withAccountLock(key, async () => { entered(); await new Promise(resolve => setTimeout(resolve, 700)); }, { longRunning: true });
    await holderIn;
    const busy = ['b', 'c'].map(k => withAccountLock('integration:late:' + k + ':' + process.pid, () => new Promise(resolve => setTimeout(resolve, 1500))));
    await new Promise(resolve => setTimeout(resolve, 100));
    const started = Date.now();
    let outcome = 'ran';
    try { await withAccountLock(key, async () => {}); } catch (error) { outcome = error.status; }
    const waitedMs = Date.now() - started;
    await Promise.all([holder, ...busy]);
    console.log(JSON.stringify({ outcome, prompt: waitedMs < 550, waitedMs }));`, { DATABASE_POOL_MAX: '3', MOODISH_LOCK_WAIT_MS: '300' });
  assert.deepEqual([result.outcome, result.prompt], [409, true], `waited ${result.waitedMs}ms`);
});
