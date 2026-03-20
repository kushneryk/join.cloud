import { Hono } from "hono";
import { isAgent, getAgentDocs, getWebsiteHtml } from "../index.js";

const app = new Hono();

app.get("/", (c) => {
  const ua = c.req.header("user-agent");
  const accept = c.req.header("accept");
  const proto = c.req.header("x-forwarded-proto") ?? "http";
  const host = c.req.header("host") ?? "localhost:3002";
  const baseUrl = `${proto}://${host}`;

  if (isAgent(ua, accept)) {
    return c.text(getAgentDocs());
  }

  return c.html(getWebsiteHtml(baseUrl));
});

export default app;
