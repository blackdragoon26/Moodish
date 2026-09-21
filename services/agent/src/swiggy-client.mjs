import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import Ajv from "ajv";
import { getSwiggyAccessToken, disconnectSwiggy } from "./swiggy-auth.mjs";
import { retrySwiggyCall } from "./telemetry.mjs";

const allowed = { food: new Set(["get_addresses", "search_menu", "search_restaurants", "get_restaurant_menu", "get_food_cart", "update_food_cart"]), im: new Set(["search_products"]) };
const ajv = new Ajv({ strict: false, allErrors: false });
export const upstreamError = (message, status = 502, code = "SWIGGY_ERROR") => Object.assign(new Error(message), { status, code });

export function createLiveCaller(userId) {
  return async function call(server, name, args = {}) {
    if (!allowed[server]?.has(name)) throw upstreamError("This Swiggy operation is not enabled", 403);
    const run = async () => {
      const token = await getSwiggyAccessToken(userId);
      if (!token) throw upstreamError("Connect or reconnect your Swiggy account", 401, "SWIGGY_REAUTH_REQUIRED");
      const client = new Client({ name: "moodish", version: "0.2.0" });
      const transport = new StreamableHTTPClientTransport(new URL(`https://mcp.swiggy.com/${server}`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) }
      });
      try {
        await client.connect(transport);
        let cursor;
        let tool;
        do {
          const page = await client.listTools(cursor ? { cursor } : {}, { timeout: 15000 });
          tool = page.tools.find(t => t.name === name);
          cursor = page.nextCursor;
        } while (!tool && cursor);
        if (!tool) throw upstreamError(`Swiggy ${server} does not expose ${name}`, 503, "SWIGGY_CAPABILITY_UNAVAILABLE");
        if (!ajv.validate(tool.inputSchema, args)) throw upstreamError(`Swiggy ${name} input does not match the current tool schema`, 422, "SWIGGY_SCHEMA_MISMATCH");
        const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 20000 });
        return unwrapMcpResult({ result });
      } catch (error) {
        const status = error.status || error.code;
        if (status === 401 || status === 419) {
          await disconnectSwiggy(userId);
          throw upstreamError("Your Swiggy connection expired. Reconnect to continue.", 401, "SWIGGY_REAUTH_REQUIRED");
        }
        if (error.status) throw error;
        if (status === 403) throw upstreamError("Swiggy denied access to this service", 403, "SWIGGY_ACCESS_DENIED");
        if (status === 429) throw upstreamError("Swiggy is rate limiting requests. Please try again shortly.", 429);
        throw upstreamError(`Swiggy ${server}.${name} could not complete`, 502);
      } finally { await client.close().catch(() => {}); }
    };
    return name === "update_food_cart" ? run() : retrySwiggyCall(run, { maxAttempts: 2 });
  };
}

export function unwrapMcpResult(body) {
  if (body.error || body.result?.isError) throw upstreamError("Swiggy reported a tool error");
  let result = body.result?.structuredContent ?? body.result?.data ?? body.result ?? body;
  if (result.content) {
    const text = result.content.find(item => item.type === "text")?.text;
    if (!text) throw upstreamError("Swiggy returned no structured result");
    try { result = JSON.parse(text); } catch { throw upstreamError("Swiggy returned an unreadable tool result"); }
  }
  for (let depth = 0; depth < 4; depth++) {
    if (result?.success === false || result?.isError || result?.error || (Number(result?.statusCode) >= 400)) throw upstreamError("Swiggy could not complete the requested operation");
    if (result?.data === undefined) break;
    result = result.data;
  }
  return result;
}
