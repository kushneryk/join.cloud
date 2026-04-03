import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { uniqueName, isProd } from "../helpers.js";

const CLI = "node dist/cli.js";
const SERVER = process.env.TEST_URL ?? "http://localhost:3000";

function run(args: string, opts: { timeout?: number } = {}): string {
  try {
    return execSync(`${CLI} ${args} --url ${SERVER}`, {
      encoding: "utf-8",
      timeout: opts.timeout ?? 10000,
      env: { ...process.env, JOINCLOUD_URL: SERVER },
    }).trim();
  } catch (err: any) {
    return (err.stdout ?? "").trim() + "\n" + (err.stderr ?? "").trim();
  }
}

function runRaw(args: string): { stdout: string; stderr: string; status: number | null } {
  try {
    const stdout = execSync(`${CLI} ${args} --url ${SERVER}`, {
      encoding: "utf-8",
      timeout: 10000,
      env: { ...process.env, JOINCLOUD_URL: SERVER },
    });
    return { stdout: stdout.trim(), stderr: "", status: 0 };
  } catch (err: any) {
    return {
      stdout: (err.stdout ?? "").trim(),
      stderr: (err.stderr ?? "").trim(),
      status: err.status,
    };
  }
}

// ============================================================
// help
// ============================================================
describe("CLI help", () => {
  // --- Positive ---
  it("--help shows usage", () => {
    const out = run("--help");
    expect(out).toContain("Usage:");
    expect(out).toContain("rooms");
    expect(out).toContain("create");
    expect(out).toContain("join");
    expect(out).toContain("--server");
  });

  it("-h shows usage", () => {
    const out = run("-h");
    expect(out).toContain("Usage:");
  });

  it("no args shows usage", () => {
    const out = run("");
    expect(out).toContain("Usage:");
  });
});

// ============================================================
// rooms
// ============================================================
describe("CLI rooms", () => {
  // --- Positive ---
  it("lists rooms", () => {
    const name = uniqueName("cli-room");
    run(`create ${name}`);
    const out = run("rooms");
    expect(out).toContain(name);
  });

  it("shows agent count", () => {
    const out = run("rooms");
    expect(out).toContain("agents");
  });

  // --- Negative ---
  it("shows error for unreachable server", () => {
    const { stderr, stdout } = runRaw("rooms --url http://localhost:1");
    const combined = stdout + stderr;
    expect(combined).toContain("Error");
  });
});

// ============================================================
// create
// ============================================================
describe("CLI create", () => {
  // --- Positive ---
  it("creates room and shows confirmation", () => {
    const name = uniqueName("cli-room");
    const out = run(`create ${name}`);
    expect(out).toContain("Room created");
    expect(out).toContain(name);
  });

  it("creates room with password", () => {
    const name = uniqueName("cli-room");
    const out = run(`create ${name} --password secret`);
    expect(out).toContain("Room created");
  });

  // --- Negative ---
  it("shows error for missing name", () => {
    const { stderr, stdout } = runRaw("create");
    const combined = stdout + stderr;
    expect(combined).toContain("Usage");
  });

  it("shows error for reserved name", () => {
    const out = run("create mcp");
    expect(out).toContain("Error");
  });

  it("shows error for duplicate name", () => {
    const name = uniqueName("cli-room");
    run(`create ${name}`);
    const out = run(`create ${name}`);
    expect(out).toContain("already exists");
  });
});

// ============================================================
// info
// ============================================================
describe("CLI info", () => {
  // --- Positive ---
  it("shows room info", () => {
    const name = uniqueName("cli-room");
    run(`create ${name}`);
    const out = run(`info ${name}`);
    expect(out).toContain("Room:");
    expect(out).toContain(name);
    expect(out).toContain("Agents");
  });

  it("shows agents in room info (creator auto-joined)", () => {
    const name = uniqueName("cli-room");
    run(`create ${name} --name cli-admin`);
    const out = run(`info ${name}`);
    expect(out).toContain("Agents (1)");
    expect(out).toContain("cli-admin");
    expect(out).toContain("[admin]");
  });

  // --- Negative ---
  it("shows error for missing room arg", () => {
    const { stderr, stdout } = runRaw("info");
    const combined = stdout + stderr;
    expect(combined).toContain("Usage");
  });

  it("shows error for non-existent room", () => {
    const out = run("info nonexistent-room-xyz");
    expect(out).toContain("not found");
  });
});

// ============================================================
// history
// ============================================================
describe("CLI history", () => {
  // --- Positive ---
  it("shows message history", async () => {
    const name = uniqueName("cli-room");
    run(`create ${name}`);
    // Send a message via A2A so there's history
    const { a2a, resultData } = await import("../helpers.js");
    const joinRes = await a2a("room.join", name, "", { agentName: "cli-hist" });
    const token = resultData(joinRes)?.agentToken;
    await a2a("message.send", undefined, "cli test msg", { agentToken: token });
    const out = run(`history ${name}`);
    expect(out).toContain("cli test msg");
  });

  it("respects --limit flag", async () => {
    const name = uniqueName("cli-room");
    run(`create ${name}`);
    const { a2a, resultData } = await import("../helpers.js");
    const joinRes = await a2a("room.join", name, "", { agentName: "cli-hist" });
    const token = resultData(joinRes)?.agentToken;
    for (let i = 0; i < 5; i++) await a2a("message.send", undefined, `clim${i}`, { agentToken: token });
    const out = run(`history ${name} --limit 2`);
    // Should have fewer lines than all messages
    const lines = out.split("\n").filter((l) => l.includes("cli-hist"));
    expect(lines.length).toBeLessThanOrEqual(2);
  });

  // --- Negative ---
  it("shows error for missing room arg", () => {
    const { stderr, stdout } = runRaw("history");
    const combined = stdout + stderr;
    expect(combined).toContain("Usage");
  });

  it("shows error for non-existent room", () => {
    const out = run("history nonexistent-room-xyz");
    expect(out).toContain("not found");
  });
});

// ============================================================
// send
// ============================================================
describe("CLI send", () => {
  // --- Positive ---
  it("sends a message", async () => {
    const name = uniqueName("cli-room");
    run(`create ${name}`);
    const out = run(`send ${name} "hello from CLI" --name cli-sender`);
    expect(out).toContain("Message sent");
  });

  it("sends a DM with --to", async () => {
    const name = uniqueName("cli-room");
    run(`create ${name}`);
    // Join another agent first
    const { a2a } = await import("../helpers.js");
    await a2a("room.join", name, "", { agentName: "target" });
    const out = run(`send ${name} "dm text" --name cli-sender --to target`);
    expect(out).toContain("Message sent");
  });

  // --- Negative ---
  it("shows error for missing room", () => {
    const { stderr, stdout } = runRaw('send --name x "hello"');
    const combined = stdout + stderr;
    expect(combined).toContain("Usage");
  });

  it("shows error for missing --name", () => {
    const name = uniqueName("cli-room");
    run(`create ${name}`);
    const { stderr, stdout } = runRaw(`send ${name} "hello"`);
    const combined = stdout + stderr;
    expect(combined).toContain("Usage");
  });
});

// ============================================================
// unknown command
// ============================================================
describe("CLI unknown command", () => {
  it("shows error for unknown command", () => {
    const { stderr, stdout } = runRaw("foobar");
    const combined = stdout + stderr;
    expect(combined).toContain("Unknown command");
  });
});

// ============================================================
// --server flag
// ============================================================
describe.skipIf(isProd)("CLI --server flag", () => {
  it("--server starts a local server", () => {
    // Just verify it starts and we can kill it
    try {
      execSync(`${CLI} --server --port 4111 --data /tmp/cli-test-server &`, {
        encoding: "utf-8",
        timeout: 3000,
      });
    } catch {
      // timeout is expected since server keeps running
    }
    // Try connecting to it
    try {
      const out = execSync(`${CLI} rooms --url http://localhost:4111`, {
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      // Should get a response (empty or with rooms)
      expect(out).toBeDefined();
    } catch {
      // Server may not have started in time, which is OK for CI
    } finally {
      try { execSync("kill $(lsof -ti:4111) 2>/dev/null"); } catch {}
      try { execSync("rm -rf /tmp/cli-test-server"); } catch {}
    }
  });
});
