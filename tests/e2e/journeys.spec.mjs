import { test, expect } from "@playwright/test";
import crypto from "node:crypto";

const LIVE = "http://127.0.0.1:8791";
const FIXTURE = "http://127.0.0.1:8792";

async function control(request, path, body) {
  const response = body === undefined ? await request.get(`${LIVE}/__e2e/${path}`) : await request.post(`${LIVE}/__e2e/${path}`, { data: body });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

// Plays the person approving (or declining) consent on Swiggy's site. Moodish's
// own start route runs for real; its redirect to Swiggy is answered locally,
// because route handlers do not see redirect targets.
async function consentOnSwiggy(page, { deny = false } = {}) {
  await page.route(`${LIVE}/api/auth/swiggy/start`, async route => {
    const started = await route.fetch({ maxRedirects: 0 });
    const authorizationUrl = started.headers()["location"];
    expect(authorizationUrl).toMatch(/^https:\/\/mcp\.swiggy\.com\/auth\/authorize\?/);
    const { callback } = await control(page.request, "authorize", { authorizationUrl, deny });
    await route.fulfill({ status: 302, headers: { location: `${LIVE}${callback}`, "set-cookie": started.headers()["set-cookie"] } });
  });
}

async function signIn(page) {
  await page.goto(`${LIVE}/__e2e/session?id=${encodeURIComponent(`google:e2e-${crypto.randomUUID()}`)}`);
  await expect(page.locator("#swiggyConnection")).toBeVisible();
}

async function connectWithAddress(page) {
  await consentOnSwiggy(page);
  await page.locator("#connectSwiggy").click();
  await expect(page.locator("#connectionError")).toHaveText(/Swiggy connected/);
  await expect(page).toHaveURL(`${LIVE}/`);
  await page.locator("#swiggyAddress").selectOption("addr-1");
  await expect(page.locator("#connectionError")).toHaveText(/Address updated/);
}

async function askForMeal(page, text = "soya chaap, veg, under ₹600") {
  await page.locator("#chatInput").fill(text);
  await page.locator("#sendChat").focus();
  await page.keyboard.press("Enter");
}

test.beforeEach(async ({ request }) => { await control(request, "reset", {}); });

test("connect, choose an address, get a live meal and confirm one Swiggy cart update by keyboard", async ({ page, request }) => {
  await signIn(page);
  await expect(page.locator("#dataModeBadge")).toHaveText("Live Swiggy");
  await expect(page.locator("#swiggyStatus")).toHaveText("Connect Swiggy to discover meals");
  await connectWithAddress(page);
  await expect(page.locator("#swiggyStatus")).toHaveText("Swiggy connected");
  await askForMeal(page);
  const card = page.locator("#options .option-card").first();
  await expect(card).toContainText("Soya Chaap");
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(card).toHaveAttribute("aria-pressed", "true");

  const dialogs = [];
  page.on("dialog", dialog => { dialogs.push(dialog.message()); dialog.accept(); });
  await page.locator("#confirmCart").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#cartOutput")).toContainText("SWIGGY FOOD CART");
  await expect(page.locator("#cartOutput")).toContainText("₹292");
  await expect(page.locator("#cartOutput")).toContainText("Swiggy's cart total");
  expect(dialogs[0]).toContain("Items estimate (not the final bill): ₹250");
  expect(dialogs[0]).toContain("Deliver to: Home · Flat 1, Test Street");
  expect(dialogs[0]).not.toContain("+91");
  expect((await control(request, "state")).writes).toBe(1);

  // Reload keeps the connection and address and never repeats the write.
  await page.reload();
  await expect(page.locator("#swiggyStatus")).toHaveText("Swiggy connected");
  await expect(page.locator("#swiggyAddress")).toHaveValue("addr-1");
  expect((await control(request, "state")).writes).toBe(1);
});

test("the review button is disabled while a confirmation is in flight", async ({ page, request }) => {
  await signIn(page);
  await connectWithAddress(page);
  await askForMeal(page);
  await expect(page.locator("#options .option-card").first()).toBeVisible();
  await control(request, "fault", { tool: "update_food_cart", delayMs: 1500 });
  let confirmations = 0;
  page.on("dialog", dialog => { confirmations += 1; dialog.accept(); });
  const button = page.locator("#confirmCart");
  await button.click();
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute("aria-busy", "true");
  await button.click({ force: true }).catch(() => {});
  await page.keyboard.press("Enter");
  await expect(page.locator("#cartOutput")).toContainText("SWIGGY FOOD CART");
  await expect(button).toBeEnabled();
  expect(confirmations).toBe(1);
  expect((await control(request, "state")).writes).toBe(1);
});

test("a stale review is refused and a fresh review then succeeds", async ({ page, request }) => {
  await signIn(page);
  await connectWithAddress(page);
  await askForMeal(page);
  await expect(page.locator("#options .option-card").first()).toBeVisible();
  let changePrice = true;
  page.on("dialog", async dialog => {
    // The price changes while the person is reading the review.
    if (changePrice) { changePrice = false; await control(request, "price", { itemId: "dish-1", price: 260 }); }
    await dialog.accept();
  });
  await page.locator("#confirmCart").click();
  await expect(page.locator("#cartOutput")).toHaveText(/Menu prices or selections changed\. Review the cart again\./);
  expect((await control(request, "state")).writes).toBe(0);
  await page.locator("#confirmCart").click();
  await expect(page.locator("#cartOutput")).toContainText("SWIGGY FOOD CART");
  expect((await control(request, "state")).writes).toBe(1);
});

test("a Swiggy cart that already has items is explained and left untouched", async ({ page, request }) => {
  await signIn(page);
  await connectWithAddress(page);
  await askForMeal(page);
  await expect(page.locator("#options .option-card").first()).toBeVisible();
  await control(request, "cart", { cart: { restaurantId: "rest-1", items: [{ menu_item_id: "dish-2", quantity: 2 }] } });
  const dialogs = [];
  page.on("dialog", dialog => { dialogs.push([dialog.type(), dialog.message()]); dialog.dismiss(); });
  await page.locator("#confirmCart").click();
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0][0]).toBe("alert");
  expect(dialogs[0][1]).toContain("adds to that cart instead of replacing it");
  expect((await control(request, "state")).writes).toBe(0);
  await expect(page.locator("#confirmCart")).toBeEnabled();
});

test("cancelled consent returns to Moodish with a clear message, and reload does not repeat it", async ({ page, request }) => {
  await signIn(page);
  await consentOnSwiggy(page, { deny: true });
  await page.locator("#connectSwiggy").click();
  await expect(page.locator("#connectionError")).toHaveText(/cancelled/);
  await expect(page).toHaveURL(`${LIVE}/`);
  await expect(page.locator("#swiggyStatus")).toHaveText("Connect Swiggy to discover meals");
  await page.reload();
  await expect(page.locator("#connectionError")).not.toHaveText(/cancelled/);
  expect((await control(request, "state")).tokenExchanges).toBe(0);
  // Back and forward after a completed connection never redeems the callback again.
  await page.unrouteAll();
  await connectWithAddress(page);
  const exchanges = (await control(request, "state")).tokenExchanges;
  await page.goBack();
  await page.goForward();
  expect((await control(request, "state")).tokenExchanges).toBe(exchanges);
});

test("disconnect and reconnect, with upstream errors and empty results shown plainly", async ({ page, request }) => {
  await signIn(page);
  await connectWithAddress(page);
  await page.locator("#disconnectSwiggy").click();
  await expect(page.locator("#swiggyStatus")).toHaveText("Connect Swiggy to discover meals");
  await expect(page.locator("#disconnectSwiggy")).toBeHidden();
  await control(request, "fault", { tool: "get_addresses", fault: { http: 503 } });
  await page.locator("#connectSwiggy").click();
  await expect(page.locator("#connectionError")).toHaveText(/could not complete/);
  await control(request, "reset", {});
  await page.reload();
  await expect(page.locator("#swiggyStatus")).toHaveText("Swiggy connected");
  // Disconnect forgets the saved choice; the reconnected account picks again.
  await expect(page.locator("#swiggyAddress")).toHaveValue("");
  await page.locator("#swiggyAddress").selectOption("addr-1");
  await control(request, "search-empty", {});
  await askForMeal(page, "rare dish nobody sells, veg, under ₹600");
  const reply = page.locator("#chatThread .message.assistant").last();
  await expect(reply).toContainText(/couldn.t find a Swiggy dish/);
  await expect(page.locator("#options .option-card")).toHaveCount(0);
});

test("the creator reviews and confirms the group cart once", async ({ page, request }) => {
  await signIn(page);
  await connectWithAddress(page);
  await page.locator('.rail-link[data-view="group"]').click();
  await page.locator('#office [name="headcount"]').fill("2");
  await page.locator('#office button[type="submit"]').click();
  await expect(page.locator("#groupPreference")).toBeVisible();
  await page.locator('#groupPreference [name="participantId"]').fill("teammate-1");
  await page.locator('#groupPreference [name="mood"]').fill("soya chaap");
  await page.locator('#groupPreference button[type="submit"]').click();
  await page.locator("#rankGroup").click();
  const plan = page.locator("#groupOptions .option-card").first();
  await expect(plan).toBeVisible();
  await plan.focus();
  await page.keyboard.press("Enter");
  await page.locator("#selectGroup").click();
  await expect(page.locator("#confirmGroupCart")).toBeEnabled();
  page.on("dialog", dialog => dialog.accept());
  await page.locator("#confirmGroupCart").click();
  await expect(page.locator("#groupStatus")).toContainText("cart built");
  expect((await control(request, "state")).writes).toBe(1);
});

for (const width of [375, 320]) {
  test(`narrow ${width}px screens keep connection and review controls usable without sideways scrolling`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    // Wide fallback fonts, like those on Linux, expose layouts that only fit on macOS.
    await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = '* { font-family: Verdana, "DejaVu Sans", sans-serif !important; }';
      document.head.append(style);
    }));
    await signIn(page);
    await connectWithAddress(page);
    await askForMeal(page);
    await expect(page.locator("#options .option-card").first()).toBeVisible();
    await page.locator("#confirmCart").scrollIntoViewIfNeeded();
    await expect(page.locator("#confirmCart")).toBeInViewport();
    // The account button stays fully inside the screen width.
    const avatar = await page.locator("#userMenu").boundingBox();
    expect(avatar.x + avatar.width).toBeLessThanOrEqual(width);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("fixture mode is labelled as demo data end to end", async ({ page }) => {
  await page.goto(FIXTURE);
  await page.locator("#demoLogin").click();
  await expect(page.locator("#dataModeBadge")).toHaveText("Demo data");
  await expect(page.locator("#swiggyConnection")).toBeHidden();
  await askForMeal(page, "chaap, veg, under ₹500");
  await expect(page.locator("#options .option-card").first()).toBeVisible();
  page.on("dialog", dialog => dialog.accept());
  await page.locator("#confirmCart").click();
  await expect(page.locator("#cartOutput")).toContainText("DEMO FOOD CART");
  await expect(page.locator("#cartOutput")).toContainText("Demo cart preview only");
});
