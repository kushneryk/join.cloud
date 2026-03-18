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
    execSync("git config --bool core.bare true", { cwd: dir, stdio: "ignore" });
    execSync("git config http.receivepack true", { cwd: dir, stdio: "ignore" });
    // Move .git/* to repo root and remove .git dir
    execSync(`mv ${gitDir}/* ${dir}/`, { cwd: dir, stdio: "ignore" });
    execSync(`rm -rf ${gitDir}`, { cwd: dir, stdio: "ignore" });
    // Remove working tree files (bare repos don't have them)
    // List tracked files and remove them
    try {
      const files = execSync("git ls-tree --name-only -r HEAD", { cwd: dir, encoding: "utf-8" }).trim();
      for (const f of files.split("\n").filter(Boolean)) {
        const fullPath = path.join(dir, f);
        if (existsSync(fullPath)) {
          execSync(`rm -f "${fullPath}"`, { stdio: "ignore" });
        }
      }
    } catch {}
    return;
  }

  // New repo — create bare
  mkdirSync(dir, { recursive: true });
  execSync("git init --bare", { cwd: dir, stdio: "ignore" });
  execSync("git config http.receivepack true", { cwd: dir, stdio: "ignore" });
}
