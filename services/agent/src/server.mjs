import http from "node:http";
import { URL } from "node:url";
import { loadLocalEnv } from "./env.mjs";
import { createTools } from "./tools.mjs";
import { clearTeamHistory, deleteTasteMemory, getAuditLogs, getTasteProfile, updateTasteProfile } from "./memory.mjs";

loadLocalEnv();
const tools = createTools();

export function createServer() {
  return http.createServer(handleAgentRequest);
}

export async function handleAgentRequest(req, res) {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "OPTIONS") return send(res, 204, {});
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, {
        ok: true,
        service: "moodish-agent",
        swiggyMode: process.env.SWIGGY_MODE || "fixture",
        aiProvider: process.env.AI_PROVIDER || "mock"
      });
    }
    if (req.method === "GET" && url.pathname === "/api/profile") {
      return send(res, 200, getTasteProfile(url.searchParams.get("userIdHash") || undefined));
    }
    if (req.method === "POST" && url.pathname === "/api/profile") {
      const body = await readJson(req);
      return send(res, 200, updateTasteProfile(body.userIdHash, body.patch || body));
    }
    if (req.method === "POST" && url.pathname === "/api/recommendations/personal") {
      return send(res, 200, await tools.plan_personal_meal(await readJson(req)));
    }
    if (req.method === "POST" && url.pathname === "/api/recommendations/office") {
      return send(res, 200, await tools.plan_office_lunch(await readJson(req)));
    }
    if (req.method === "POST" && url.pathname === "/api/cart/confirm") {
      return send(res, 200, await tools.build_confirmed_cart(await readJson(req)));
    }
    if (req.method === "POST" && url.pathname === "/api/feedback") {
      return send(res, 200, await tools.record_meal_feedback(await readJson(req)));
    }
    if (req.method === "GET" && url.pathname === "/api/audit") {
      return send(res, 200, { logs: getAuditLogs() });
    }
    if (req.method === "POST" && url.pathname === "/api/privacy/delete-taste-memory") {
      const body = await readJson(req);
      return send(res, 200, deleteTasteMemory(body.userIdHash));
    }
    if (req.method === "POST" && url.pathname === "/api/privacy/clear-team-history") {
      const body = await readJson(req);
      return send(res, 200, clearTeamHistory(body.teamId));
    }
    if (req.method === "POST" && url.pathname === "/mcp") {
      return send(res, 200, await handleJsonRpc(await readJson(req)));
    }
    return send(res, 404, { error: "Not found" });
  } catch (error) {
    return send(res, error.status || 500, { error: error.message, details: error.details });
  }
}

async function handleJsonRpc(message) {
  if (message.method !== "tools/call") {
    return { jsonrpc: "2.0", id: message.id ?? null, error: { code: -32601, message: "Only tools/call is supported" } };
  }
  const name = message.params?.name;
  const args = message.params?.arguments || {};
  if (!tools[name]) {
    return { jsonrpc: "2.0", id: message.id ?? null, error: { code: -32601, message: `Unknown tool ${name}` } };
  }
  try {
    const data = await tools[name](args);
    return { jsonrpc: "2.0", id: message.id ?? null, result: { success: true, data } };
  } catch (error) {
    return { jsonrpc: "2.0", id: message.id ?? null, result: { success: false, error: { message: error.message } } };
  }
}

function send(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization"
  });
  res.end(status === 204 ? "" : JSON.stringify(payload, null, 2));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.MOODISH_PORT || 8786);
  createServer().listen(port, "127.0.0.1", () => {
    console.log(`Moodish agent listening on http://127.0.0.1:${port}`);
  });
}
