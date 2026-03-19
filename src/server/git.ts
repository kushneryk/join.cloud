import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
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
      execSync("git config http.receivepack true", { cwd: dir, stdio: "ignore" });
    } catch {}
    return;
  }

  if (existsSync(path.join(dir, ".git", "HEAD"))) {
    // Non-bare repo (created by old isomorphic-git) — convert to bare
    const gitDir = path.join(dir, ".git");
    // Move .git/* to repo root and remove .git dir
    execSync(`cp -a ${gitDir}/* ${dir}/`, { stdio: "ignore" });
    execSync(`rm -rf ${gitDir}`, { stdio: "ignore" });
    // Now set bare config (after files are in place)
    execSync("git config --bool core.bare true", { cwd: dir, stdio: "ignore" });
    execSync("git config http.receivepack true", { cwd: dir, stdio: "ignore" });
    return;
  }

  // New repo — create bare
  mkdirSync(dir, { recursive: true });
  execSync("git init --bare", { cwd: dir, stdio: "ignore" });
  execSync("git config http.receivepack true", { cwd: dir, stdio: "ignore" });
}
