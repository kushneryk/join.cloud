import { Hono } from "hono";
import { spawn, execSync } from "node:child_process";
import { getRoom, getRoomsByName, getRoomByNameAndPassword } from "../store.js";
import { initRepo, repoDir, REPOS_DIR } from "../git.js";

const app = new Hono();

// Find git-http-backend path
const GIT_EXEC_PATH = execSync("git --exec-path", { encoding: "utf-8" }).trim();
const GIT_HTTP_BACKEND = `${GIT_EXEC_PATH}/git-http-backend`;

function parseBasicAuth(header: string | undefined): { user: string; pass: string } | null {
  if (!header?.startsWith("Basic ")) return null;
  const decoded = Buffer.from(header.slice(6), "base64").toString();
  const colon = decoded.indexOf(":");
  if (colon === -1) return null;
  return { user: decoded.slice(0, colon), pass: decoded.slice(colon + 1) };
}

async function handleGitRequest(c: any, roomSlug: string, pathInfo: string, service?: string): Promise<Response> {
  const authHeader = c.req.header("authorization");
  const creds = parseBasicAuth(authHeader);

  // Try to find the room — first by direct lookup (handles ID, name, name:password)
  let room = await getRoom(roomSlug);

  // If not found by name alone, check if password-protected rooms exist with this name
  if (!room) {
    const variants = await getRoomsByName(roomSlug);
    if (variants.length === 0) {
      return c.text("Repository not found", 404);
    }
    // All variants require a password
    if (!creds) {
      return new Response("Authentication required", {
        status: 401,
        headers: { "WWW-Authenticate": `Basic realm="Join.cloud room: ${roomSlug}"` },
      });
    }
    // Try to find with the provided password
    room = await getRoomByNameAndPassword(roomSlug, creds.pass);
    if (!room) {
      return new Response("Invalid password", { status: 403 });
    }
  }

  await initRepo(room.id);

  // Build CGI environment
  const env: Record<string, string> = {
    GIT_PROJECT_ROOT: REPOS_DIR,
    GIT_HTTP_EXPORT_ALL: "1",
    PATH_INFO: `/${room.id}${pathInfo}`,
    REQUEST_METHOD: c.req.method,
    CONTENT_TYPE: c.req.header("content-type") ?? "",
    ...(service && { QUERY_STRING: `service=${service}` }),
  };

  return new Promise(async (resolve) => {
    const proc = spawn(GIT_HTTP_BACKEND, [], { env });

    const chunks: Buffer[] = [];
    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));

    proc.on("close", () => {
      const raw = Buffer.concat(chunks);
      const headerEnd = raw.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        resolve(c.text("Git backend error", 500));
        return;
      }

      const headerStr = raw.subarray(0, headerEnd).toString();
      const body = raw.subarray(headerEnd + 4);

      const headers = new Headers();
      let status = 200;
      for (const line of headerStr.split("\r\n")) {
        const colon = line.indexOf(":");
        if (colon === -1) continue;
        const key = line.slice(0, colon).trim().toLowerCase();
        const val = line.slice(colon + 1).trim();
        if (key === "status") {
          status = parseInt(val, 10);
        } else {
          headers.set(key, val);
        }
      }

      resolve(new Response(body, { status, headers }));
    });

    proc.on("error", () => {
      resolve(c.text("Git backend unavailable", 500));
    });

    // Pipe request body to git-http-backend stdin
    if (c.req.method === "POST") {
      const reqBody = await c.req.arrayBuffer();
      proc.stdin.write(Buffer.from(reqBody));
    }
    proc.stdin.end();
  });
}

// GET /rooms/:slug/info/refs?service=git-upload-pack|git-receive-pack
app.get("/rooms/:slug/info/refs", async (c) => {
  const slug = c.req.param("slug");
  const service = c.req.query("service") ?? "";
  return handleGitRequest(c, slug, "/info/refs", service);
});

// POST /rooms/:slug/git-upload-pack (clone/fetch)
app.post("/rooms/:slug/git-upload-pack", async (c) => {
  const slug = c.req.param("slug");
  return handleGitRequest(c, slug, "/git-upload-pack");
});

// POST /rooms/:slug/git-receive-pack (push)
app.post("/rooms/:slug/git-receive-pack", async (c) => {
  const slug = c.req.param("slug");
  return handleGitRequest(c, slug, "/git-receive-pack");
});

export default app;
