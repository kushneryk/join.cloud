import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRoom } from "./helpers.js";

const BASE = process.env.TEST_URL ?? "http://localhost:3000";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "jc-git-"));
}

function gitInDir(dir: string, cmd: string): string {
  return execSync(`git ${cmd}`, { cwd: dir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

describe("git smart HTTP", () => {
  it("clones an empty room", async () => {
    const { name } = await createRoom();
    const dir = tmpDir();
    try {
      gitInDir(dir, `clone ${BASE}/rooms/${name} repo`);
      const repoDir = join(dir, "repo");
      // Should be a valid git repo (even if empty)
      const status = gitInDir(repoDir, "status");
      expect(status).toContain("branch");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("push and clone round-trip", async () => {
    const { name } = await createRoom();
    const dir1 = tmpDir();
    const dir2 = tmpDir();
    try {
      // Clone, add file, push
      gitInDir(dir1, `clone ${BASE}/rooms/${name} repo`);
      const repo1 = join(dir1, "repo");
      writeFileSync(join(repo1, "test.txt"), "hello from test");
      gitInDir(repo1, "add test.txt");
      gitInDir(repo1, `-c user.name=test -c user.email=test@test.com commit -m "add test file"`);
      gitInDir(repo1, "push origin main");

      // Clone from second location
      gitInDir(dir2, `clone ${BASE}/rooms/${name} repo`);
      const repo2 = join(dir2, "repo");
      const content = readFileSync(join(repo2, "test.txt"), "utf-8");
      expect(content).toBe("hello from test");
    } finally {
      rmSync(dir1, { recursive: true, force: true });
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("returns 404 for nonexistent room", async () => {
    const res = await fetch(`${BASE}/rooms/nonexistent-room-xyz/info/refs?service=git-upload-pack`);
    expect(res.status).toBe(404);
  });

  it("requires auth for password-protected rooms", async () => {
    const { name } = await createRoom(undefined, "gitpass");
    const res = await fetch(`${BASE}/rooms/${name}/info/refs?service=git-upload-pack`);
    expect(res.status).toBe(401);
  });

  it("allows clone with correct password", async () => {
    const { name } = await createRoom(undefined, "gitpass2");
    const dir = tmpDir();
    try {
      // Use password in URL for git clone
      const url = `${BASE.replace("://", "://user:gitpass2@")}/rooms/${name}`;
      gitInDir(dir, `clone ${url} repo`);
      const repoDir = join(dir, "repo");
      const status = gitInDir(repoDir, "status");
      expect(status).toContain("branch");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
