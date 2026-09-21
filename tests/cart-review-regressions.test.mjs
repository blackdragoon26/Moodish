import test from 'node:test';
import assert from 'node:assert/strict';
import { createTools } from '../services/agent/src/tools.mjs';
import { normalizeFoodCart } from '../services/agent/src/swiggy-gateway.mjs';

test('fixture personal and creator cart reviews work without an explicit user hash', async () => {
  const tools = createTools();
  const recommendation = await tools.plan_personal_meal({ mood: 'chaap', budget: 500 });
  const review = await tools.prepare_cart({ recommendationId: recommendation.recommendationId, optionId: recommendation.options[0].optionId });
  assert.deepEqual(review.existingCart.items, []);
  assert.equal(review.existingCart.mode, 'fixture');
  assert.match(review.note, /demo cart preview/);
  assert.ok(review.preparationId);
  await assert.rejects(tools.prepare_cart({ recommendationId: recommendation.recommendationId, optionId: recommendation.options[0].optionId, userIdHash: 'someone-else' }), { status: 404 });
  const group = await tools.create_group_meal_session({ creatorId: 'fixture-review-creator', headcount: 2 });
  const args = { sessionId: group.sessionId, actorId: group.creatorId };
  const ranked = await tools.rank_group_meal(args);
  await tools.select_group_option({ ...args, optionId: ranked.recommendation.options[0].optionId });
  const groupReview = await tools.prepare_group_cart(args);
  assert.deepEqual(groupReview.existingCart.items, []);
  assert.ok(groupReview.preparationId);
});

test('empty live carts can omit items but malformed payloads are rejected', () => {
  assert.deepEqual(normalizeFoodCart({ cart_id: null }).items, []);
  assert.equal(normalizeFoodCart({}).total, 0);
  for (const data of [null, [], 'invalid', { items: null }, { items: {} }, { items: 'invalid' }]) {
    assert.throws(() => normalizeFoodCart(data), /unrecognized cart/);
  }
});
