import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://127.0.0.1").pathname;
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

const port = Number(process.env.MOODISH_WEB_PORT || 8787);
server.listen(port, "127.0.0.1", () => {
  console.log(`Moodish web listening on http://127.0.0.1:${port}`);
});
