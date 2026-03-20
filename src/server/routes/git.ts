import { Hono } from "hono";
import { spawn, execFileSync } from "node:child_process";
import type { Store } from "../storage/interface.js";
import { initRepo, repoDir, REPOS_DIR } from "../git.js";
import { botNotify } from "../bot.js";

// Find git-http-backend path
const GIT_EXEC_PATH = execFileSync("git", ["--exec-path"], { encoding: "utf-8" }).trim();
const GIT_HTTP_BACKEND = `${GIT_EXEC_PATH}/git-http-backend`;

function parseBasicAuth(header: string | undefined): { user: string; pass: string } | null {
  if (!header?.startsWith("Basic ")) return null;
  const decoded = Buffer.from(header.slice(6), "base64").toString();
  const colon = decoded.indexOf(":");
  if (colon === -1) return null;
  return { user: decoded.slice(0, colon), pass: decoded.slice(colon + 1) };
}

function getNewCommits(repoPath: string, oldSha: string, newSha: string): Array<{ sha: string; author: string; message: string }> {
  if (oldSha === "0000000000000000000000000000000000000000") {
    try {
      const log = execFileSync("git", ["log", "--format=%H|%an|%s", "-5", newSha], { cwd: repoPath, encoding: "utf-8" }).trim();
      return log.split("\n").filter(Boolean).map((line) => {
        const [sha, author, ...msg] = line.split("|");
        return { sha: sha.slice(0, 8), author, message: msg.join("|") };
      });
    } catch { return []; }
  }
  try {
    const log = execFileSync("git", ["log", "--format=%H|%an|%s", `${oldSha}..${newSha}`], { cwd: repoPath, encoding: "utf-8" }).trim();
    return log.split("\n").filter(Boolean).map((line) => {
      const [sha, author, ...msg] = line.split("|");
      return { sha: sha.slice(0, 8), author, message: msg.join("|") };
    });
  } catch { return []; }
}

export function createGitRoutes(store: Store): Hono {
  const app = new Hono();

  async function handleGitRequest(c: any, roomSlug: string, pathInfo: string, service?: string): Promise<Response> {
    const authHeader = c.req.header("authorization");
    const creds = parseBasicAuth(authHeader);

    let room = await store.getRoom(roomSlug);

    if (!room) {
      const variants = await store.getRoomsByName(roomSlug);
      if (variants.length === 0) {
        return c.text("Repository not found", 404);
      }
      if (!creds) {
        return new Response("Authentication required", {
          status: 401,
          headers: { "WWW-Authenticate": `Basic realm="Join.cloud room: ${roomSlug}"` },
        });
      }
      room = await store.getRoomByNameAndPassword(roomSlug, creds.pass);
      if (!room) {
        return new Response("Invalid password", { status: 403 });
      }
    }

    await initRepo(room.id);

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

      if (c.req.method === "POST") {
        const reqBody = await c.req.arrayBuffer();
        proc.stdin.write(Buffer.from(reqBody));
      }
      proc.stdin.end();
    });
  }

  app.get("/rooms/:slug/info/refs", async (c) => {
    const slug = c.req.param("slug");
    const service = c.req.query("service") ?? "";
    return handleGitRequest(c, slug, "/info/refs", service);
  });

  app.post("/rooms/:slug/git-upload-pack", async (c) => {
    const slug = c.req.param("slug");
    return handleGitRequest(c, slug, "/git-upload-pack");
  });

  app.post("/rooms/:slug/git-receive-pack", async (c) => {
    const slug = c.req.param("slug");

    const room = await store.getRoom(slug);
    const refsBeforePush: Record<string, string> = {};
    if (room) {
      try {
        const refs = execFileSync("git", ["for-each-ref", "--format=%(refname) %(objectname)"], { cwd: repoDir(room.id), encoding: "utf-8" }).trim();
        for (const line of refs.split("\n").filter(Boolean)) {
          const [ref, sha] = line.split(" ");
          refsBeforePush[ref] = sha;
        }
      } catch {}
    }

    const response = await handleGitRequest(c, slug, "/git-receive-pack");

    if (room && response.status === 200) {
      try {
        const refsAfter = execFileSync("git", ["for-each-ref", "--format=%(refname) %(objectname)"], { cwd: repoDir(room.id), encoding: "utf-8" }).trim();
        for (const line of refsAfter.split("\n").filter(Boolean)) {
          const [ref, newSha] = line.split(" ");
          const oldSha = refsBeforePush[ref] ?? "0000000000000000000000000000000000000000";
          if (newSha !== oldSha) {
            const branch = ref.replace("refs/heads/", "");
            const commits = getNewCommits(repoDir(room.id), oldSha, newSha);
            if (commits.length > 0) {
              const summary = commits.map((c) => `  ${c.sha} ${c.message} (${c.author})`).join("\n");
              botNotify(room.id, `Git push to ${branch} — ${commits.length} commit(s):\n${summary}`).catch(() => {});
            }
          }
        }
      } catch {}
    }

    return response;
  });

  return app;
}

export default createGitRoutes;
