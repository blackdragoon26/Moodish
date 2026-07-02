import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../services/agent/src/server.mjs";

test("mcp tools/call works for generic AI clients", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "t1",
        method: "tools/call",
        params: {
          name: "plan_personal_meal",
          arguments: { budget: 350, mood: "surprise me" }
        }
      })
    });
    const body = await response.json();
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.result.success, true);
    assert.ok(body.result.data.recommendationId);
  } finally {
    server.close();
  }
});
