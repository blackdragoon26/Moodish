import { test, expect } from "@playwright/test";
import crypto from "node:crypto";
const base = "http://127.0.0.1:8791";
async function signin(page, id = crypto.randomUUID()) {
  await page.goto(`${base}/__e2e/session?id=${id}`);
  await page.goto(`${base}/teams.html`);
  return id;
}
async function createOffice(page) {
  await signin(page);
  await page.getByLabel("Workspace name").fill("Acme office");
  await page
    .getByLabel("Office / delivery instructions")
    .fill("Bengaluru reception");
  await page.getByLabel("Usual people").fill("3");
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Acme office", exact: true }),
  ).toBeVisible();
  return new URL(page.url()).searchParams.get("team");
}
async function startMeal(page) {
  await page.getByLabel("What are you arranging?").fill("Friday lunch");
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Friday lunch", exact: true }),
  ).toBeVisible();
  return new URL(page.url()).searchParams.get("meal");
}
async function invitation(page, teamId, mealId) {
  const response = await page.request.get(
    `${base}/api/teams/${teamId}/meals/${mealId}`,
  );
  const data = await response.json();
  return `${base}/teams.html?team=${teamId}&meal=${mealId}#join=${data.shareToken}`;
}

test("office meal journey: private attendance, checked budget, purchaser handoff, report and fresh repeat", async ({
  page,
  browser,
}) => {
  const teamId = await createOffice(page),
    mealId = await startMeal(page),
    link = await invitation(page, teamId, mealId);
  const ctx = await browser.newContext(),
    participant = await ctx.newPage();
  await participant.goto(link);
  await participant.getByLabel("Your name", { exact: true }).fill("Alex");
  await participant.getByLabel("Food preference").selectOption("veg");
  await participant
    .getByLabel("Allergies", { exact: true })
    .fill("Private peanuts");
  await participant.getByLabel("Remember my preferences").check();
  await participant
    .getByRole("button", { name: "Join this meal", exact: true })
    .click();
  await expect(participant.getByRole("status")).toContainText(
    "Your response: join",
  );
  await page.reload();
  await expect(page.locator("#responses")).toContainText("Alex: join");
  await expect(page.locator("body")).not.toContainText("Private peanuts");
  await page
    .getByRole("button", { name: "Close responses", exact: true })
    .click();
  await expect(page.locator("#choices")).toBeVisible();
  await page.getByLabel("Restaurant", { exact: true }).fill("Test Kitchen");
  await page.getByLabel("Items and quantities").fill("One veg bowl");
  await page
    .getByLabel("Restaurant / checkout URL")
    .fill("https://example.com/menu");
  await page.getByLabel("All-in total (₹)", { exact: true }).fill("300");
  await page.getByLabel("I checked dietary coverage").check();
  await page.getByRole("button", { name: "Save checked options" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Review purchasing handoff" }).click();
  await expect(page.locator("#handoff")).toContainText(
    "No cart or order has been created",
  );
  await page.getByLabel("Order reference").fill("ORDER-TEST-1");
  await page.getByLabel("Actual all-in total (₹)").fill("310");
  await page.getByLabel("I completed checkout").check();
  await page
    .getByRole("button", { name: "Record purchase", exact: true })
    .click();
  await expect(page.locator("#handoff")).toContainText(
    "Purchase reported: ₹310",
  );
  const report = await page.request.get(`${base}/api/teams/${teamId}/report`);
  expect((await report.json()).reportedSpend).toBe(310);
  await page
    .getByRole("button", { name: "Repeat next week", exact: true })
    .click();
  await expect(page.locator("#mealSummary")).toContainText("0 joining");
  await expect(page.locator("#options")).toBeEmpty();
  const swiggy = await (await page.request.get(`${base}/__e2e/state`)).json();
  expect(swiggy.writes).toBe(0);
  await ctx.close();
});
test("workspace invitation survives sign-out/login and purchaser gets no organizer controls", async ({
  page,
  browser,
}) => {
  const teamId = await createOffice(page);
  await page.locator("#inviteRole").selectOption("purchaser");
  await page.getByRole("button", { name: "Invite a colleague" }).click();
  await expect(page.locator("#invitation")).toContainText("one-use invitation");
  const text = await page.locator("#invitation").innerText();
  const link = text.match(/http:\/\/\S+/)[0];
  const ctx = await browser.newContext(),
    colleague = await ctx.newPage();
  await colleague.goto(link);
  await expect(colleague.locator("#login")).toBeVisible();
  await colleague.goto(`${base}/__e2e/session?id=${crypto.randomUUID()}`);
  await colleague.goto(`${base}/teams.html?team=${teamId}`);
  await expect(
    colleague.getByRole("heading", { name: "Acme office", exact: true }),
  ).toBeVisible();
  await expect(colleague.locator("#newMeal")).toBeHidden();
  await expect(colleague.locator("#invite")).toBeHidden();
  await ctx.close();
});
test("mobile participation saves device preferences only with consent and supports skip/delete", async ({
  page,
  browser,
}) => {
  const teamId = await createOffice(page),
    mealId = await startMeal(page),
    link = await invitation(page, teamId, mealId);
  const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    participant = await ctx.newPage();
  await participant.goto(link);
  await participant.getByLabel("Your name", { exact: true }).fill("Pat");
  await participant
    .getByRole("button", { name: "Skip this meal", exact: true })
    .click();
  await expect(participant.getByRole("status")).toContainText(
    "Your response: skip",
  );
  expect(
    await participant.evaluate(() =>
      localStorage.getItem("moodish:team-preferences"),
    ),
  ).toBeNull();
  expect(
    await participant.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await participant
    .getByRole("button", { name: "Delete my response", exact: true })
    .click();
  await expect(participant.getByRole("status")).toContainText("Join or skip");
  await ctx.close();
});
