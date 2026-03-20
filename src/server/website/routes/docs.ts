import { Hono } from "hono";
import { isAgent, getFullDocs, getFullDocsHtml } from "../index.js";

const app = new Hono();

app.get("/docs", (c) => {
  const ua = c.req.header("user-agent");
  const accept = c.req.header("accept");

  if (isAgent(ua, accept)) {
    return c.text(getFullDocs());
  }

  return c.html(getFullDocsHtml());
});

export default app;
