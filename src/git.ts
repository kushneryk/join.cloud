import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import * as path from "node:path";

export const REPOS_DIR = process.env.REPOS_DIR ?? "/tmp/joincloud-repos";

export function repoDir(roomId: string): string {
  return path.join(REPOS_DIR, roomId);
}

export function initRepo(roomId: string): void {
  const dir = repoDir(roomId);
  if (existsSync(path.join(dir, "HEAD"))) return; // already a bare repo

  mkdirSync(dir, { recursive: true });
  execSync("git init --bare", { cwd: dir, stdio: "ignore" });
  execSync("git config http.receivepack true", { cwd: dir, stdio: "ignore" });
}
