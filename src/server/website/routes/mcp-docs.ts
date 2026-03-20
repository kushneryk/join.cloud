import { Hono } from "hono";
import { isAgent, getMcpDocsHtml, getMcpDocs } from "../index.js";

const app = new Hono();

app.get("/mcp", (c) => {
  const ua = c.req.header("user-agent");
  const accept = c.req.header("accept");

  if (isAgent(ua, accept)) {
    return c.text(getMcpDocs());
  }

  return c.html(getMcpDocsHtml());
});

export default app;
