import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "../public");

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".js": "application/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

function serveFile(filePath: string, cacheMaxAge: number) {
  try {
    const content = readFileSync(filePath, "utf-8");
    const ext = extname(filePath);
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": `public, max-age=${cacheMaxAge}`,
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

const app = new Hono();

app.get("/favicon.svg", (c) => serveFile(join(publicDir, "favicon.svg"), 86400));
app.get("/favicon.ico", (c) => c.redirect("/favicon.svg", 301));
app.get("/css/*", (c) => serveFile(join(publicDir, c.req.path), 3600));
app.get("/js/*", (c) => serveFile(join(publicDir, c.req.path), 3600));

export default app;
