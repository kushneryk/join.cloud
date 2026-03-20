import { defineConfig } from "vitest/config";

const PROD_URL = process.env.PROD_URL ?? "https://join.cloud";
const PROD_MCP_URL = process.env.PROD_MCP_URL ?? PROD_URL;

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "local",
          include: ["test/**/*.test.ts"],
          exclude: ["test/e2e/**"],
          globalSetup: ["test/setup.ts"],
          testTimeout: 15000,
          hookTimeout: 30000,
          env: {
            TEST_URL: "http://localhost:3111",
            MCP_URL: "http://localhost:3112",
            TEST_TARGET: "local",
          },
        },
      },
      {
        test: {
          name: "prod",
          include: ["test/**/*.test.ts"],
          exclude: ["test/e2e/**"],
          testTimeout: 30000,
          hookTimeout: 30000,
          fileParallelism: false,
          env: {
            TEST_URL: PROD_URL,
            MCP_URL: PROD_MCP_URL,
            TEST_TARGET: "prod",
          },
        },
      },
    ],
  },
});
