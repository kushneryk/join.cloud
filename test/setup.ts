import type { GlobalSetupContext } from "vitest/node";

const TEST_PORT = 3111;
const MCP_PORT = 3112;
const DATA_DIR = "/tmp/joincloud-vitest-" + process.pid;

export default async function setup({ provide }: GlobalSetupContext) {
  process.env.PORT = String(TEST_PORT);
  process.env.MCP_PORT = String(MCP_PORT);
  process.env.JOINCLOUD_DATA_DIR = DATA_DIR;
  process.env.TEST_URL = `http://localhost:${TEST_PORT}`;
  process.env.MCP_URL = `http://localhost:${MCP_PORT}`;

  const { initDb } = await import("../src/server/db.js");
  const { startServer } = await import("../src/server/index.js");

  await initDb();
  const { httpServer, mcpServer } = startServer();

  // Wait for servers to be listening
  await new Promise<void>((resolve) => {
    let ready = 0;
    const check = () => { if (++ready >= 2) resolve(); };
    httpServer.on("listening", check);
    mcpServer.on("listening", check);
    // If already listening
    if (httpServer.listening) check();
    if (mcpServer.listening) check();
  });

  return async () => {
    httpServer.close();
    mcpServer.close();
    // Clean up test data
    const { rmSync } = await import("node:fs");
    try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
  };
}
