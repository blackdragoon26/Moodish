import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleAgentRequest } from "../../services/agent/src/server.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

export function createWebServer() {
  return http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, "http://127.0.0.1").pathname;
      if (pathname === "/health" || pathname === "/mcp" || pathname.startsWith("/api/")) {
        return handleAgentRequest(req, res);
      }
      const file = pathname === "/" ? "index.html" : pathname.slice(1);
      const path = join(root, "public", file);
      const body = await readFile(path);
      res.writeHead(200, { "content-type": mime[extname(path)] || "application/octet-stream" });
      res.end(body);
    } catch {
      const body = await readFile(join(root, "public", "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(body);
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.MOODISH_WEB_PORT || 8787);
  createWebServer().listen(port, "127.0.0.1", () => {
    console.log(`Moodish web + API listening on http://127.0.0.1:${port}`);
  });
}
