import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["test/setup.ts"],
    testTimeout: 15000,
    hookTimeout: 30000,
    env: {
      TEST_URL: "http://localhost:3111",
      MCP_URL: "http://localhost:3112",
    },
  },
});
