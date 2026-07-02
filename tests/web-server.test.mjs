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
