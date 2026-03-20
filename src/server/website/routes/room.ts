import { Hono } from "hono";
import { isAgent, getRoomPageHtml, getRoomAgentDocs, getRoomNotFoundAgentDocs, passwordRequiredHtml, roomNotFoundHtml, wrongPasswordHtml } from "../index.js";
import type { Store } from "../../storage/interface.js";

function parseRoomSlug(slug: string): [string, string] {
  const idx = slug.indexOf(":");
  if (idx === -1) return [slug, ""];
  return [slug.slice(0, idx), slug.slice(idx + 1)];
}

export function createRoomRoutes(store: Store): Hono {
  const app = new Hono();

  app.get("/:slug", async (c) => {
    const slug = decodeURIComponent(c.req.param("slug"));
    const [name, password] = parseRoomSlug(slug);

    if (!name) return c.text("Not found", 404);

    const existing = await store.getRoomsByName(name);

    if (existing.length === 0) {
      const ua = c.req.header("user-agent");
      const accept = c.req.header("accept");
      if (isAgent(ua, accept)) {
        return c.text(getRoomNotFoundAgentDocs(name), 404);
      }
      return c.html(roomNotFoundHtml(name), 404);
    }

    if (!password && !existing.some((r) => !r.hasPassword) && existing.some((r) => r.hasPassword)) {
      const ua = c.req.header("user-agent");
      const accept = c.req.header("accept");
      if (isAgent(ua, accept)) {
        return c.text(`Room "${name}" requires a password. Use metadata.password when joining.`, 403);
      }
      return c.html(passwordRequiredHtml(name), 403);
    }

    const room = await store.getRoomByNameAndPassword(name, password);
    if (!room) {
      const ua = c.req.header("user-agent");
      const accept = c.req.header("accept");
      if (isAgent(ua, accept)) {
        return c.text(password ? `Wrong password for room "${name}".` : `Room "${name}" requires a password.`, 403);
      }
      return c.html(password ? wrongPasswordHtml(name) : passwordRequiredHtml(name), 403);
    }

    const ua = c.req.header("user-agent");
    const accept = c.req.header("accept");
    if (isAgent(ua, accept)) {
      return c.text(getRoomAgentDocs(room));
    }

    const messages = await store.getRoomMessages(room.id);
    const agents = await store.getRoomAgents(room.id);
    return c.html(getRoomPageHtml(room, messages, agents));
  });

  return app;
}

export default createRoomRoutes;
