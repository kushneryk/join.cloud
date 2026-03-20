import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, cpSync, rmSync } from "node:fs";
import * as path from "node:path";

export const REPOS_DIR = process.env.REPOS_DIR ?? "/tmp/joincloud-repos";

export function repoDir(roomId: string): string {
  return path.join(REPOS_DIR, roomId);
}

export function initRepo(roomId: string): void {
  const dir = repoDir(roomId);

  if (existsSync(path.join(dir, "HEAD"))) {
    // Already a bare repo — ensure config is set
    try {
      execFileSync("git", ["config", "http.receivepack", "true"], { cwd: dir, stdio: "ignore" });
    } catch {}
    return;
  }

  if (existsSync(path.join(dir, ".git", "HEAD"))) {
    // Non-bare repo (created by old isomorphic-git) — convert to bare
    const gitDir = path.join(dir, ".git");
    // Move .git/* to repo root and remove .git dir
    cpSync(gitDir, dir, { recursive: true });
    rmSync(gitDir, { recursive: true, force: true });
    // Now set bare config (after files are in place)
    execFileSync("git", ["config", "--bool", "core.bare", "true"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["config", "http.receivepack", "true"], { cwd: dir, stdio: "ignore" });
    return;
  }

  // New repo — create bare
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "--bare"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "http.receivepack", "true"], { cwd: dir, stdio: "ignore" });
}
