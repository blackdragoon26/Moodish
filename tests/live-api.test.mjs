import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../services/agent/src/server.mjs';
import { signSessionToken } from '../services/agent/src/auth.mjs';
import { saveSecretSession, updateTasteProfile, getGroupSession } from '../services/agent/src/memory.mjs';
import { encryptToken } from '../services/agent/src/swiggy-auth.mjs';

test('live APIs enforce signed identity for profile, cart, MCP and group creation', async t => {
  const previous = { mode: process.env.SWIGGY_MODE, key: process.env.TOKEN_ENCRYPTION_KEY };
  process.env.SWIGGY_MODE = 'live'; process.env.TOKEN_ENCRYPTION_KEY = 'test-only-key';
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries({ SWIGGY_MODE: previous.mode, TOKEN_ENCRYPTION_KEY: previous.key })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = signSessionToken({ id: 'api-alice', name: 'Alice' });
  const request = (path, body, authenticated = true) => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  await updateTasteProfile('api-bob', { likedCuisines: ['private-bob-data'] });
  await saveSecretSession('swiggy:api-bob', { accessToken: encryptToken('bob-token'), expiresAt: Date.now() + 3600000 });
  assert.equal((await request('/api/profile?userIdHash=api-bob', undefined, false)).status, 401);
  const profile = await (await request('/api/profile?userIdHash=api-bob')).json();
  assert.equal(profile.userIdHash, 'api-alice');
  assert.equal(profile.likedCuisines.includes('private-bob-data'), false);
  const status = await (await request('/api/swiggy/connection?sessionId=api-bob')).json();
  assert.equal(status.connected, false);
  assert.equal((await request('/api/cart/confirm', { userIdHash: 'api-bob', confirmed: true }, false)).status, 401);
  assert.equal((await request('/api/auth/demo', {}, false)).status, 403);
  assert.equal((await request('/mcp', { method: 'tools/call', params: { name: 'get_taste_memory', arguments: { userIdHash: 'api-bob' } } }, false)).status, 401);
  assert.equal((await request('/mcp', { method: 'tools/call', params: { name: 'confirm_group_cart', arguments: {} } })).status, 403);
  const response = await request('/api/group-sessions', { creatorId: 'api-bob', purchaseUserId: 'api-bob' });
  assert.equal(response.status, 201);
  const group = await response.json();
  assert.equal(group.creatorId, 'api-alice');
  assert.equal((await getGroupSession(group.sessionId)).purchaseUserId, 'api-alice');
  for (const action of ['prepare-cart', 'confirm-cart']) {
    const call = headers => fetch(`${base}/api/group-sessions/${group.sessionId}/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${group.accessToken}`, ...headers },
      body: JSON.stringify({ confirmed: true, userIdHash: 'api-alice' })
    });
    assert.equal((await call({})).status, 401, 'group token alone must not authorize cart access');
    const other = signSessionToken({ id: 'api-bob' });
    assert.equal((await call({ cookie: `moodish_session=${other}` })).status, 403);
    assert.equal((await call({ 'x-moodish-session': other })).status, 403);
    // The matching personal session reaches the group state check; this group is
    // still collecting, so neither request can call Swiggy or mutate a cart.
    for (const headers of [{ cookie: `moodish_session=${token}` }, { 'x-moodish-session': token }]) {
      const allowed = await call(headers);
      assert.equal(allowed.status, 409);
      assert.match((await allowed.json()).error, /collecting/);
    }
  }
});
