import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRoom, resultData, a2a } from "./helpers.js";

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
      gitInDir(dir1, `clone ${BASE}/rooms/${name} repo`);
      const repo1 = join(dir1, "repo");
      writeFileSync(join(repo1, "test.txt"), "hello from test");
      gitInDir(repo1, "add test.txt");
      gitInDir(repo1, `-c user.name=test -c user.email=test@test.com commit -m "add test file"`);
      gitInDir(repo1, "push origin main");

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
      const url = `${BASE.replace("://", "://user:gitpass2@")}/rooms/${name}`;
      gitInDir(dir, `clone ${url} repo`);
      const repoDir = join(dir, "repo");
      const status = gitInDir(repoDir, "status");
      expect(status).toContain("branch");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects clone with wrong password", async () => {
    const { name } = await createRoom(undefined, "correct-pw");
    const dir = tmpDir();
    try {
      const url = `${BASE.replace("://", "://user:wrong-pw@")}/rooms/${name}`;
      expect(() => {
        gitInDir(dir, `clone ${url} repo`);
      }).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("push multiple commits", async () => {
    const { name } = await createRoom();
    const dir1 = tmpDir();
    const dir2 = tmpDir();
    try {
      gitInDir(dir1, `clone ${BASE}/rooms/${name} repo`);
      const repo1 = join(dir1, "repo");

      writeFileSync(join(repo1, "file1.txt"), "first");
      gitInDir(repo1, "add file1.txt");
      gitInDir(repo1, `-c user.name=test -c user.email=test@test.com commit -m "commit 1"`);

      writeFileSync(join(repo1, "file2.txt"), "second");
      gitInDir(repo1, "add file2.txt");
      gitInDir(repo1, `-c user.name=test -c user.email=test@test.com commit -m "commit 2"`);

      writeFileSync(join(repo1, "file3.txt"), "third");
      gitInDir(repo1, "add file3.txt");
      gitInDir(repo1, `-c user.name=test -c user.email=test@test.com commit -m "commit 3"`);

      gitInDir(repo1, "push origin main");

      // Clone and verify all 3 files
      gitInDir(dir2, `clone ${BASE}/rooms/${name} repo`);
      const repo2 = join(dir2, "repo");
      expect(readFileSync(join(repo2, "file1.txt"), "utf-8")).toBe("first");
      expect(readFileSync(join(repo2, "file2.txt"), "utf-8")).toBe("second");
      expect(readFileSync(join(repo2, "file3.txt"), "utf-8")).toBe("third");

      // Verify commit count
      const log = gitInDir(repo2, "log --oneline");
      const lines = log.split("\n").filter(Boolean);
      expect(lines.length).toBe(3);
    } finally {
      rmSync(dir1, { recursive: true, force: true });
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("multiple branches", async () => {
    const { name } = await createRoom();
    const dir1 = tmpDir();
    const dir2 = tmpDir();
    try {
      gitInDir(dir1, `clone ${BASE}/rooms/${name} repo`);
      const repo1 = join(dir1, "repo");

      // Push to main
      writeFileSync(join(repo1, "main.txt"), "on main");
      gitInDir(repo1, "add main.txt");
      gitInDir(repo1, `-c user.name=test -c user.email=test@test.com commit -m "main commit"`);
      gitInDir(repo1, "push origin main");

      // Create and push a feature branch
      gitInDir(repo1, "checkout -b feature");
      writeFileSync(join(repo1, "feature.txt"), "on feature");
      gitInDir(repo1, "add feature.txt");
      gitInDir(repo1, `-c user.name=test -c user.email=test@test.com commit -m "feature commit"`);
      gitInDir(repo1, "push origin feature");

      // Clone and verify both branches
      gitInDir(dir2, `clone ${BASE}/rooms/${name} repo`);
      const repo2 = join(dir2, "repo");
      expect(readFileSync(join(repo2, "main.txt"), "utf-8")).toBe("on main");
      // feature.txt should not be on main
      expect(existsSync(join(repo2, "feature.txt"))).toBe(false);

      // Switch to feature branch
      gitInDir(repo2, "checkout feature");
      expect(readFileSync(join(repo2, "feature.txt"), "utf-8")).toBe("on feature");
      expect(readFileSync(join(repo2, "main.txt"), "utf-8")).toBe("on main");
    } finally {
      rmSync(dir1, { recursive: true, force: true });
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("clone by room ID", async () => {
    const { roomId } = await createRoom();
    const dir = tmpDir();
    try {
      gitInDir(dir, `clone ${BASE}/rooms/${roomId} repo`);
      const repoDir = join(dir, "repo");
      const status = gitInDir(repoDir, "status");
      expect(status).toContain("branch");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("pull fetches new changes", async () => {
    const { name } = await createRoom();
    const dir1 = tmpDir();
    const dir2 = tmpDir();
    try {
      // Clone from two locations
      gitInDir(dir1, `clone ${BASE}/rooms/${name} repo`);
      const repo1 = join(dir1, "repo");

      // Push from first clone
      writeFileSync(join(repo1, "initial.txt"), "initial");
      gitInDir(repo1, "add initial.txt");
      gitInDir(repo1, `-c user.name=test -c user.email=test@test.com commit -m "initial"`);
      gitInDir(repo1, "push origin main");

      // Clone from second location
      gitInDir(dir2, `clone ${BASE}/rooms/${name} repo`);
      const repo2 = join(dir2, "repo");
      expect(readFileSync(join(repo2, "initial.txt"), "utf-8")).toBe("initial");

      // Push more changes from first clone
      writeFileSync(join(repo1, "update.txt"), "updated");
      gitInDir(repo1, "add update.txt");
      gitInDir(repo1, `-c user.name=test -c user.email=test@test.com commit -m "update"`);
      gitInDir(repo1, "push origin main");

      // Pull from second clone
      gitInDir(repo2, "pull origin main");
      expect(readFileSync(join(repo2, "update.txt"), "utf-8")).toBe("updated");
    } finally {
      rmSync(dir1, { recursive: true, force: true });
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("push with password-protected room", async () => {
    const { name } = await createRoom(undefined, "pushpass");
    const dir = tmpDir();
    try {
      const url = `${BASE.replace("://", "://user:pushpass@")}/rooms/${name}`;
      gitInDir(dir, `clone ${url} repo`);
      const repoDir = join(dir, "repo");
      writeFileSync(join(repoDir, "secret.txt"), "secret content");
      gitInDir(repoDir, "add secret.txt");
      gitInDir(repoDir, `-c user.name=test -c user.email=test@test.com commit -m "push to pw room"`);
      gitInDir(repoDir, "push origin main");

      // Verify by cloning again
      const dir2 = tmpDir();
      try {
        gitInDir(dir2, `clone ${url} repo2`);
        const content = readFileSync(join(dir2, "repo2", "secret.txt"), "utf-8");
        expect(content).toBe("secret content");
      } finally {
        rmSync(dir2, { recursive: true, force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns 401 for git-receive-pack on password room without auth", async () => {
    const { name } = await createRoom(undefined, "rcvpass");
    const res = await fetch(`${BASE}/rooms/${name}/info/refs?service=git-receive-pack`);
    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get("www-authenticate");
    expect(wwwAuth).toContain("Basic");
  });

  it("returns 403 for wrong password on password room", async () => {
    const { name } = await createRoom(undefined, "forbidden-pw");
    const res = await fetch(`${BASE}/rooms/${name}/info/refs?service=git-upload-pack`, {
      headers: {
        Authorization: "Basic " + btoa("user:wrong-password"),
      },
    });
    expect(res.status).toBe(403);
  });

  it("info/refs returns correct content-type for upload-pack", async () => {
    const { name } = await createRoom();
    const res = await fetch(`${BASE}/rooms/${name}/info/refs?service=git-upload-pack`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type");
    expect(ct).toContain("git-upload-pack");
  });

  it("info/refs returns correct content-type for receive-pack", async () => {
    const { name } = await createRoom();
    const res = await fetch(`${BASE}/rooms/${name}/info/refs?service=git-receive-pack`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type");
    expect(ct).toContain("git-receive-pack");
  });
});
