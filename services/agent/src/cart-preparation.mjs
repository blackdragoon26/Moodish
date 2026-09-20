import crypto from "node:crypto";
import { getSecretSession, saveSecretSession, withAccountLock } from "./memory.mjs";

const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const cartFingerprint = cart => digest({ restaurantId: cart.restaurantId, total: cart.total, items: cart.items.map(i => ({ id: i.itemId, quantity: i.quantity, variants: i.variants, variantsV2: i.variantsV2, addons: i.addons })) });

export async function prepareCart({ ownerId, recommendation, optionId, restaurantId, addOnProductIds = [], swiggy, groupSessionId }) {
  const option = recommendation.options.find(o => o.optionId === optionId);
  if (!option) throw fail("Unknown recommendation option", 404);
  const restaurants = [...new Set(option.items.map(i => i.restaurantId || option.restaurantId))];
  if (restaurants.length > 1 && !restaurantId) throw Object.assign(fail("Choose one restaurant to prepare. Other restaurant plans remain previews."), { details: { restaurants: (option.foodSources || []).map(s => ({ restaurantId: s.restaurantId, restaurantName: s.restaurantName })) } });
  restaurantId ||= restaurants[0];
  if (!restaurants.includes(restaurantId)) throw fail("Restaurant is not part of this recommendation", 400);
  const items = option.items.filter(i => (i.restaurantId || option.restaurantId) === restaurantId);
  if (!items.length) throw fail("This option contains no Food items", 422);
  const addressId = recommendation.address?.id;
  if (!addressId) throw fail("Choose a saved delivery address", 422);
  const addresses = await swiggy.getAddresses();
  if (!addresses.some(a => a.id === addressId)) throw fail("Delivery address is no longer available", 422);
  const checked = await checkMenu(swiggy, restaurantId, addressId, items);
  const existing = await swiggy.getFoodCart({ addressId });
  const id = crypto.randomUUID();
  const preparation = { id, ownerId, groupSessionId, recommendationId: recommendation.recommendationId, optionId,
    connectionVersion: swiggy.mode === "live" ? (await getSecretSession(`swiggy:${ownerId}`))?.version : undefined,
    restaurantId, addressId, items: checked, addOnProductIds, existingHash: cartFingerprint(existing),
    expiresAt: Date.now() + 5 * 60000, state: "prepared" };
  await saveSecretSession(`cart-prepare:${id}`, preparation);
  return { preparationId: id, expiresAt: new Date(preparation.expiresAt).toISOString(),
    restaurantId, address: recommendation.address, items: checked,
    estimatedItemTotal: checked.reduce((sum, i) => sum + i.price * i.quantity, 0),
    existingCart: existing, replacesExistingCart: existing.items.length > 0,
    note: swiggy.mode === "fixture" ? "This is a demo cart preview. No real cart or order will be created." : "This will update your real Swiggy Food cart. Final charges come from Swiggy after the update. Instamart remains a preview. No order will be placed." };
}

export async function confirmPreparedCart({ preparationId, ownerId, recommendation, optionId, restaurantId, addOnProductIds = [], confirmed, swiggy, groupSessionId, build }) {
  if (!preparationId) throw fail("Review the live cart before confirming. Update your client if needed.", 428);
  if (confirmed !== true) throw fail("Explicit confirmation is required");
  return withAccountLock(`swiggy-cart:${ownerId}`, async () => {
    const key = `cart-prepare:${preparationId}`;
    const p = await getSecretSession(key);
    if (!p || p.ownerId !== ownerId || p.groupSessionId !== groupSessionId || p.recommendationId !== recommendation.recommendationId || p.optionId !== optionId || (restaurantId && restaurantId !== p.restaurantId) || digest([...p.addOnProductIds].sort()) !== digest([...addOnProductIds].sort())) throw fail("Cart review does not match this request", 403);
    if (p.state === "done") return p.result;
    if (p.state !== "prepared") throw fail("The previous cart update has an uncertain result. Review your current Swiggy cart before preparing another change.");
    if (p.expiresAt <= Date.now()) throw fail("Cart review expired. Review the cart again.");
    if (swiggy.mode === "live" && p.connectionVersion !== (await getSecretSession(`swiggy:${ownerId}`))?.version) throw fail("Swiggy connection changed. Review the cart again.");
    const checked = await checkMenu(swiggy, p.restaurantId, p.addressId, p.items);
    if (digest(checked) !== digest(p.items)) throw fail("Menu prices or selections changed. Review the cart again.");
    if (cartFingerprint(await swiggy.getFoodCart({ addressId: p.addressId })) !== p.existingHash) throw fail("Your Swiggy cart changed. Review it again before replacing it.");
    p.state = "attempting";
    await saveSecretSession(key, p);
    try {
      const result = await build(p.restaurantId);
      const actual = result.foodCarts?.[0];
      if (!actual || actual.restaurantId !== p.restaurantId || !sameItems(actual.items, p.items)) throw fail("Swiggy returned different cart contents. Check the cart before trying again.");
      await saveSecretSession(key, { ...p, state: "done", result });
      return result;
    } catch (error) {
      // Read after uncertain mutation; never issue a second update automatically.
      const current = await swiggy.getFoodCart({ addressId: p.addressId }).catch(() => null);
      await saveSecretSession(key, { ...p, state: "uncertain", matchesRequested: current?.restaurantId === p.restaurantId && sameItems(current.items, p.items) });
      throw error;
    }
  });
}
function sameItems(actual = [], expected = []) {
  return digest(actual.map(i => [i.itemId, Number(i.quantity)]).sort()) === digest(expected.map(i => [i.itemId, Number(i.quantity)]).sort());
}
async function checkMenu(swiggy, restaurantId, addressId, requested) {
  const menu = await swiggy.getRestaurantMenu({ restaurantId, addressId });
  return Promise.all(requested.map(async item => {
    const details = swiggy.mode === "live" ? await swiggy.searchMenu({ addressId, query: item.name, restaurantIdOfAddedItem: restaurantId }) : menu.items;
    const current = details.find(i => i.itemId === item.itemId);
    if (!current || current.inStock === false || current.inStock === 0 || current.in_stock === false || current.isAvailable === false || !Number.isFinite(current.price)) throw fail("A selected item is unavailable. Get fresh recommendations.");
    if ((current.hasVariants === true || current.variations?.length || current.variants?.variantGroups?.length || current.variantsV2?.length || current.variantsV2?.variantGroups?.length || current.addons?.some?.(g => Number(g.minAddons) > 0))) throw fail("This dish needs customization. Choose a dish without required customization for this cart.", 422);
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) throw fail("Invalid item quantity", 422);
    return { itemId: current.itemId, name: current.name, price: current.price, quantity };
  }));
}
