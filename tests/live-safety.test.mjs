import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startSwiggyOAuth, completeSwiggyOAuth, exchangeMobileCode, getSwiggyAccessToken, disconnectSwiggy } from '../services/agent/src/swiggy-auth.mjs';
import { unwrapMcpResult } from '../services/agent/src/swiggy-client.mjs';
import { prepareCart, confirmPreparedCart } from '../services/agent/src/cart-preparation.mjs';

const sha = s => crypto.createHash('sha256').update(s).digest('base64url');
test('OAuth binds browser, consumes state once, and isolates credentials by account', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async url => new Response(JSON.stringify(String(url).endsWith('register') ? { client_id: 'mock-client' } : { access_token: 'mock-token', expires_in: 3600 }), { headers: { 'content-type': 'application/json' } });
  const start = await startSwiggyOAuth({ user: { id: 'owner-a' }, browserBinding: 'browser-a' });
  const state = new URL(start.authorizationUrl).searchParams.get('state');
  await assert.rejects(completeSwiggyOAuth({ state, code: 'test', browserBinding: 'other' }), { status: 403 });
  await completeSwiggyOAuth({ state, code: 'test', browserBinding: 'browser-a' });
  assert.equal(await getSwiggyAccessToken('owner-a'), 'mock-token');
  assert.equal(await getSwiggyAccessToken('owner-b'), '');
  assert.equal(await getSwiggyAccessToken(), '');
  await assert.rejects(completeSwiggyOAuth({ state, code: 'test', browserBinding: 'browser-a' }));
  await disconnectSwiggy('owner-a');
  assert.equal(await getSwiggyAccessToken('owner-a'), '');
});
test('mobile exchange requires PKCE and is single use', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async url => new Response(JSON.stringify(String(url).endsWith('register') ? { client_id: 'mock' } : { access_token: 'mock', expires_in: 3600 }));
  const verifier = crypto.randomBytes(32).toString('base64url');
  const start = await startSwiggyOAuth({ user: { id: 'mobile-user' }, mobileChallenge: sha(verifier) });
  const done = await completeSwiggyOAuth({ state: new URL(start.authorizationUrl).searchParams.get('state'), code: 'test' });
  assert.equal(done.accessToken, undefined);
  await assert.rejects(exchangeMobileCode({ code: done.exchangeCode, verifier: 'a'.repeat(43) }));
  assert.equal((await exchangeMobileCode({ code: done.exchangeCode, verifier })).id, 'mobile-user');
  await assert.rejects(exchangeMobileCode({ code: done.exchangeCode, verifier }));
});
test('HTTP success never masks MCP or embedded tool failure', () => {
  for (const result of [{ isError: true }, { structuredContent: { success: false } }, { content: [{ type: 'text', text: JSON.stringify({ data: { success: false } }) }] }]) {
    assert.throws(() => unwrapMcpResult({ result }));
  }
  assert.deepEqual(unwrapMcpResult({ result: { structuredContent: { success: true, data: { items: [] } } } }), { items: [] });
});
function harness() {
  const item = { itemId: 'dish', name: 'Meal', price: 200, quantity: 1 };
  let cart = { restaurantId: '', total: 0, items: [] };
  let writes = 0;
  const swiggy = { getAddresses: async () => [{ id: 'address' }], getRestaurantMenu: async () => ({ items: [item] }), getFoodCart: async () => cart };
  const recommendation = { recommendationId: crypto.randomUUID(), address: { id: 'address' }, options: [{ optionId: 'option', restaurantId: 'restaurant', items: [item] }] };
  const args = { ownerId: 'owner', recommendation, optionId: 'option', swiggy, confirmed: true };
  const build = async () => { writes++; cart = { restaurantId: 'restaurant', total: 220, items: [item] }; return { foodCarts: [cart] }; };
  return { args, build, writes: () => writes, setCart: c => { cart = c; } };
}
test('cart preparation is read-only, owner-bound, and confirmation retries cannot repeat a mutation', async () => {
  const h = harness();
  const review = await prepareCart(h.args);
  assert.equal(h.writes(), 0);
  await assert.rejects(confirmPreparedCart({ ...h.args, ownerId: 'attacker', preparationId: review.preparationId, build: h.build }), { status: 403 });
  const confirm = () => confirmPreparedCart({ ...h.args, preparationId: review.preparationId, build: h.build });
  await Promise.all([confirm(), confirm()]);
  assert.equal(h.writes(), 1);
});
test('changed cart and uncertain update require fresh review, never automatic replay', async () => {
  const h = harness();
  const review = await prepareCart(h.args);
  h.setCart({ restaurantId: 'other', total: 50, items: [{ itemId: 'other', quantity: 1 }] });
  await assert.rejects(confirmPreparedCart({ ...h.args, preparationId: review.preparationId, build: h.build }), /cart changed/);
  assert.equal(h.writes(), 0);
  const next = await prepareCart(h.args);
  let attempts = 0;
  const failed = () => confirmPreparedCart({ ...h.args, preparationId: next.preparationId, build: async () => { attempts++; throw new Error('timeout'); } });
  await assert.rejects(failed(), /timeout/);
  await assert.rejects(failed(), /uncertain/);
  assert.equal(attempts, 1);
});
