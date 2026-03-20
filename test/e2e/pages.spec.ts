import { test, expect, type Page } from "@playwright/test";

const BASE = "http://localhost:3113";

// --- A2A helper ---
async function a2a(action: string, contextId?: string, text?: string, metadata?: Record<string, unknown>) {
  const res = await fetch(`${BASE}/a2a`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "SendMessage",
      params: {
        message: {
          role: "user",
          parts: [{ text: text ?? "" }],
          ...(contextId && { contextId }),
          metadata: { action, ...metadata },
        },
      },
    }),
  });
  return (await res.json()) as any;
}

// --- Shared assertions ---
async function assertValidHtml(page: Page) {
  // Check basic HTML structure
  const html = await page.locator("html").getAttribute("lang");
  expect(html).toBe("en");
  await expect(page.locator("head meta[charset]")).toHaveCount(1);
  await expect(page.locator("head meta[name='viewport']")).toHaveCount(1);
  await expect(page.locator("head title")).toHaveCount(1);
  await expect(page.locator("head style")).toHaveCount(1);

  // No broken images or scripts (check for errors in page)
  const title = await page.title();
  expect(title.length).toBeGreaterThan(0);
}

async function assertMobileFriendly(page: Page) {
  // Check viewport meta tag
  const viewport = await page.locator("meta[name='viewport']").getAttribute("content");
  expect(viewport).toContain("width=device-width");

  // Check no horizontal scroll at mobile width
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(100);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
}

async function assertNoConsoleErrors(page: Page, errors: string[]) {
  const realErrors = errors.filter(
    (e) =>
      !e.includes("favicon") &&
      !e.includes("ERR_CONNECTION_REFUSED") &&
      !e.includes("Failed to load resource"),
  );
  expect(realErrors).toEqual([]);
}

// --- Server lifecycle ---
let teardown: (() => Promise<void>) | undefined;

test.beforeAll(async () => {
  process.env.PORT = "3113";
  process.env.MCP_PORT = "3114";
  process.env.JOINCLOUD_DATA_DIR = "/tmp/joincloud-playwright-" + process.pid;

  const { initDb } = await import("../../src/server/db.js");
  const { startServer } = await import("../../src/server/index.js");

  await initDb();
  const { httpServer, mcpServer } = startServer();

  await new Promise<void>((resolve) => {
    let ready = 0;
    const check = () => {
      if (++ready >= 2) resolve();
    };
    httpServer.on("listening", check);
    mcpServer.on("listening", check);
    if (httpServer.listening) check();
    if (mcpServer.listening) check();
  });

  // Create a test room with messages
  const createRes = await a2a("room.create", undefined, "e2e-test-room");
  const roomId = createRes.result?.message?.contextId;
  if (roomId) {
    const joinRes = await a2a("room.join", roomId, "", { agentName: "test-agent" });
    const token = joinRes.result?.message?.metadata?.agentToken;
    if (token) {
      await a2a("message.send", roomId, "", { agentToken: token, text: "Hello from e2e test" });
    }
  }

  // Create a password-protected room
  await a2a("room.create", undefined, "pw-room", { password: "secret123" });

  teardown = async () => {
    httpServer.close();
    mcpServer.close();
    const { rmSync } = await import("node:fs");
    try {
      rmSync("/tmp/joincloud-playwright-" + process.pid, { recursive: true, force: true });
    } catch {}
  };
});

test.afterAll(async () => {
  await teardown?.();
});

// ============================================================
// Landing page
// ============================================================
test.describe("Landing page", () => {
  test("renders correctly", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

    await page.goto(BASE);

    await assertValidHtml(page);
    await expect(page.locator("h1")).toContainText("join");
    await expect(page.locator(".subtitle")).toContainText("Collaboration rooms");
    await expect(page.locator(".proto")).toHaveCount(5);
    await expect(page.locator(".use-card")).toHaveCount(4);
    await expect(page.locator(".instruction")).toBeVisible();
    await expect(page.locator(".links a")).toHaveCount(5);
    await expect(page.locator("footer")).toBeVisible();

    assertNoConsoleErrors(page, errors);
  });

  test("is mobile friendly", async ({ page }) => {
    await page.goto(BASE);
    await assertMobileFriendly(page);
  });
});

// ============================================================
// Room page (with messages)
// ============================================================
test.describe("Room page", () => {
  test("renders room with agents and messages", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

    await page.goto(`${BASE}/e2e-test-room`);

    await assertValidHtml(page);
    await expect(page.locator("h1")).toContainText("e2e-test-room");
    await expect(page.locator(".meta")).toBeVisible();
    await expect(page.locator(".messages")).toBeVisible();
    await expect(page.locator("#messages")).toHaveAttribute("data-room-id");

    // Check the room.js script is loaded (external, not inline)
    await expect(page.locator('script[src="/js/room.js"]')).toHaveCount(1);

    assertNoConsoleErrors(page, errors);
  });

  test("is mobile friendly", async ({ page }) => {
    await page.goto(`${BASE}/e2e-test-room`);
    await assertMobileFriendly(page);
  });
});

// ============================================================
// Room not found page
// ============================================================
test.describe("Room not found", () => {
  test("renders 404 page", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

    const response = await page.goto(`${BASE}/nonexistent-room-xyz`);
    expect(response?.status()).toBe(404);

    await assertValidHtml(page);
    await expect(page.locator("h1")).toContainText("nonexistent-room-xyz");
    await expect(page.locator(".info-box")).toBeVisible();
    await expect(page.locator(".info-box")).toContainText("No room named");

    assertNoConsoleErrors(page, errors);
  });

  test("is mobile friendly", async ({ page }) => {
    await page.goto(`${BASE}/nonexistent-room-xyz`);
    await assertMobileFriendly(page);
  });
});

// ============================================================
// Password required page
// ============================================================
test.describe("Password required", () => {
  test("renders password prompt", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

    const response = await page.goto(`${BASE}/pw-room`);
    expect(response?.status()).toBe(403);

    await assertValidHtml(page);
    await expect(page.locator("h1")).toContainText("pw-room");
    await expect(page.locator(".info-box")).toBeVisible();
    await expect(page.locator(".info-box")).toContainText("password");

    assertNoConsoleErrors(page, errors);
  });

  test("is mobile friendly", async ({ page }) => {
    await page.goto(`${BASE}/pw-room`);
    await assertMobileFriendly(page);
  });
});

// ============================================================
// Wrong password page
// ============================================================
test.describe("Wrong password", () => {
  test("renders wrong password error", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

    const response = await page.goto(`${BASE}/pw-room:wrongpass`);
    expect(response?.status()).toBe(403);

    await assertValidHtml(page);
    await expect(page.locator("h1")).toContainText("pw-room");
    await expect(page.locator(".info-box")).toBeVisible();
    await expect(page.locator(".info-box")).toContainText("Wrong password");

    assertNoConsoleErrors(page, errors);
  });

  test("is mobile friendly", async ({ page }) => {
    await page.goto(`${BASE}/pw-room:wrongpass`);
    await assertMobileFriendly(page);
  });
});

// ============================================================
// Docs page
// ============================================================
test.describe("Docs page", () => {
  test("renders full documentation", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

    await page.goto(`${BASE}/docs`);

    await assertValidHtml(page);
    await expect(page.locator("h1")).toContainText("docs");
    const infoBoxCount = await page.locator(".info-box").count();
    expect(infoBoxCount).toBeGreaterThanOrEqual(1);

    // Should contain method tables
    const tableCount = await page.locator("table").count();
    expect(tableCount).toBeGreaterThanOrEqual(1);

    assertNoConsoleErrors(page, errors);
  });

  test("is mobile friendly", async ({ page }) => {
    await page.goto(`${BASE}/docs`);
    await assertMobileFriendly(page);
  });
});

// ============================================================
// A2A docs page
// ============================================================
test.describe("A2A docs page", () => {
  test("renders A2A documentation", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

    await page.goto(`${BASE}/a2a`);

    await assertValidHtml(page);
    await expect(page.locator("h1")).toContainText("A2A");
    const infoBoxCount = await page.locator(".info-box").count();
    expect(infoBoxCount).toBeGreaterThanOrEqual(1);

    // Should have link to A2A spec
    await expect(page.locator('a[href="https://a2a-protocol.org/"]')).toHaveCount(1);

    assertNoConsoleErrors(page, errors);
  });

  test("is mobile friendly", async ({ page }) => {
    await page.goto(`${BASE}/a2a`);
    await assertMobileFriendly(page);
  });
});

// ============================================================
// MCP docs page
// ============================================================
test.describe("MCP docs page", () => {
  test("renders MCP documentation", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

    await page.goto(`${BASE}/mcp`);

    await assertValidHtml(page);
    await expect(page.locator("h1")).toContainText("MCP");
    const infoBoxCount = await page.locator(".info-box").count();
    expect(infoBoxCount).toBeGreaterThanOrEqual(1);

    // Should have link to MCP spec
    await expect(page.locator('a[href="https://modelcontextprotocol.io/"]')).toHaveCount(1);

    assertNoConsoleErrors(page, errors);
  });

  test("is mobile friendly", async ({ page }) => {
    await page.goto(`${BASE}/mcp`);
    await assertMobileFriendly(page);
  });
});

// ============================================================
// Static assets
// ============================================================
test.describe("Static assets", () => {
  test("favicon.svg serves correctly", async ({ request }) => {
    const res = await request.get(`${BASE}/favicon.svg`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/svg+xml");
  });

  test("favicon.ico redirects to svg", async ({ request }) => {
    const res = await request.get(`${BASE}/favicon.ico`, { maxRedirects: 0 });
    expect(res.status()).toBe(301);
  });

  test("CSS files serve correctly", async ({ request }) => {
    const res = await request.get(`${BASE}/css/base.css`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/css");
    const text = await res.text();
    expect(text.length).toBeGreaterThan(100);
  });

  test("JS files serve correctly", async ({ request }) => {
    const res = await request.get(`${BASE}/js/room.js`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/javascript");
    const text = await res.text();
    expect(text).toContain("EventSource");
  });

  test("missing static file returns 404", async ({ request }) => {
    const res = await request.get(`${BASE}/css/nonexistent.css`);
    expect(res.status()).toBe(404);
  });
});

// ============================================================
// Agent card
// ============================================================
test.describe("Agent card", () => {
  test("returns valid JSON", async ({ request }) => {
    const res = await request.get(`${BASE}/.well-known/agent-card.json`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.name).toBe("Join.cloud");
    expect(json.skills).toBeInstanceOf(Array);
  });
});
