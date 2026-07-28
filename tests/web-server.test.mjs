import test from "node:test";
import assert from "node:assert/strict";
import { createWebServer } from "../apps/web/server.mjs";

test("web server serves UI and API from one port", async () => {
  const server = createWebServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const html = await fetchText(port, "/");
    assert.match(html, /Moodish/);
    assert.match(html, /id="mealBudgetRange"/);
    assert.match(html, /id="participantAccessForm"/);
    assert.match(html, /id="copyInviteCode"/);
    assert.match(html, /id="managerInputReview"/);
    assert.match(html, /id="groupAddOnPanel"/);
    assert.match(html, /https:\/\/mcp\.swiggy\.com\/builders\//);
    assert.match(html, /Built for Swiggy Food \+ Instamart/);
    assert.match(html, /data-theme-toggle/);
    assert.match(html, /href="https:\/\/www\.swiggy\.com\/restaurants"/);
    assert.match(html, /href="https:\/\/www\.swiggy\.com\/instamart"/);
    assert.match(html, /src="\/assets\/swiggy\.png"/);
    assert.match(html, /src="\/assets\/instamart\.png"/);
    assert.doesNotMatch(html, /One place to plan the meal/);
    assert.doesNotMatch(html, /\u2014/);
    assert.match(html, /class="mic-icon"/);
    assert.doesNotMatch(html, /🎙|🎤/);
    assert.doesNotMatch(html, /Overall vibe/);
    assert.match(html, /Good old favourite/);
    assert.match(html, /Absolutely new/);
    const styles = await fetchText(port, "/styles.css");
    assert.match(styles, /html\[data-theme="dark"\] \.moment-message \.bubble/);
    assert.match(styles, /html\[data-theme="dark"\] \.discovery-choices button\.selected/);
    const swiggyImage = await fetch(`http://127.0.0.1:${port}/assets/swiggy.png`);
    assert.equal(swiggyImage.headers.get("content-type"), "image/png");
    const instamartImage = await fetch(`http://127.0.0.1:${port}/assets/instamart.png`);
    assert.equal(instamartImage.headers.get("content-type"), "image/png");
    const slackLogo = await fetch(`http://127.0.0.1:${port}/assets/slack.svg`);
    assert.equal(slackLogo.headers.get("content-type"), "image/svg+xml");

    const health = await fetchJson(port, "/health");
    assert.equal(health.ok, true);

    const recommendation = await fetchJson(port, "/api/recommendations/personal", {
      method: "POST",
      body: JSON.stringify({ budget: 350, mood: "curious", dietaryRules: "high-protein" })
    });
    assert.equal(recommendation.mode, "solo");
    assert.ok(recommendation.options.length > 0);
  } finally {
    server.close();
  }
});

test("web bootstrap combines health, auth configuration and current session without caching", async () => {
  const server = createWebServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(body.health.ok, true);
    assert.equal(body.config.swiggy, false);
    assert.match(body.config.swiggyAccessUrl, /mcp\.swiggy\.com\/builders\/access/);
    assert.equal(body.user, null);

    const swiggyLogin = await fetch(`http://127.0.0.1:${port}/api/auth/swiggy/start`, {
      redirect: "manual"
    });
    assert.equal(swiggyLogin.status, 503);
    assert.match((await swiggyLogin.json()).error, /whitelist approval/i);
  } finally {
    server.close();
  }
});

async function fetchText(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  assert.equal(response.ok, true);
  return response.text();
}

async function fetchJson(port, path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { "content-type": "application/json" },
    ...options
  });
  assert.equal(response.ok, true);
  return response.json();
}
