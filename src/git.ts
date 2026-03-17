import * as git from "isomorphic-git";
import * as fs from "node:fs";
import * as path from "node:path";
import type { RoomCommit, FileChange, VerifyOptions, CommitReview } from "./types.js";
import {
  addCommit as storeCommit,
  updateCommit as storeUpdateCommit,
  getCommit as storeGetCommit,
  getPendingCommits as storeGetPending,
  getMergedCommits as storeGetMerged,
} from "./store.js";
import { botNotify } from "./bot.js";

const REPOS_DIR = process.env.REPOS_DIR ?? "/tmp/joincloud-repos";

function repoDir(roomId: string): string {
  return path.join(REPOS_DIR, roomId);
}

// --- Init ---

export async function initRepo(roomId: string): Promise<void> {
  const dir = repoDir(roomId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  try {
    await git.resolveRef({ fs, dir, ref: "HEAD" });
  } catch {
    await git.init({ fs, dir, defaultBranch: "main" });
    // Create initial empty commit so main branch exists
    const sha = await git.commit({
      fs,
      dir,
      message: "Initial commit",
      author: { name: "room-bot", email: "bot@join.cloud" },
    });
  }
}

// --- Write files and commit ---

async function writeAndStage(
  dir: string,
  changes: FileChange[],
): Promise<void> {
  for (const change of changes) {
    if (change.action === "delete") {
      const fullPath = path.join(dir, change.path);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
      await git.remove({ fs, dir, filepath: change.path });
    } else {
      const fullPath = path.join(dir, change.path);
      const parentDir = path.dirname(fullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(fullPath, change.content);
      await git.add({ fs, dir, filepath: change.path });
    }
  }
}

// --- Branches ---

export async function createBranch(
  roomId: string,
  branchName: string,
  startPoint?: string,
): Promise<string> {
  const dir = repoDir(roomId);
  const ref = startPoint ?? "main";
  await git.branch({ fs, dir, ref: branchName, checkout: false });
  return branchName;
}

export async function listBranches(roomId: string): Promise<string[]> {
  const dir = repoDir(roomId);
  return git.listBranches({ fs, dir });
}

export async function checkoutBranch(
  roomId: string,
  branchName: string,
): Promise<void> {
  const dir = repoDir(roomId);
  await git.checkout({ fs, dir, ref: branchName });
}

export async function deleteBranch(
  roomId: string,
  branchName: string,
): Promise<void> {
  const dir = repoDir(roomId);
  await git.deleteBranch({ fs, dir, ref: branchName });
}

export async function currentBranch(roomId: string): Promise<string> {
  const dir = repoDir(roomId);
  const branch = await git.currentBranch({ fs, dir });
  return branch ?? "main";
}

// --- Commits ---

export async function createCommit(
  roomId: string,
  author: string,
  message: string,
  changes: FileChange[],
  verify?: VerifyOptions | boolean,
): Promise<RoomCommit> {
  const dir = repoDir(roomId);
  await initRepo(roomId);

  const normalizedVerify: VerifyOptions | undefined =
    verify === true
      ? {}
      : verify === false || verify === undefined
        ? undefined
        : verify;

  if (!normalizedVerify) {
    // Direct commit — write to current branch
    await writeAndStage(dir, changes);
    const sha = await git.commit({
      fs,
      dir,
      message,
      author: { name: author, email: `${author}@join.cloud` },
    });

    const commit: RoomCommit = {
      id: crypto.randomUUID().slice(0, 8),
      sha,
      roomId,
      author,
      message,
      changes,
      status: "committed",
      reviews: [],
      createdAt: new Date().toISOString(),
    };

    await storeCommit(commit);
    await botNotify(
      roomId,
      `Commit ${commit.id} by ${author}: "${message}" (${changes.length} file(s) changed)`,
    );
    return commit;
  }

  // Verified commit — create on a proposal branch, don't merge yet
  const branchName = `proposal/${crypto.randomUUID().slice(0, 8)}`;
  const currentRef = await currentBranch(roomId);

  await git.branch({ fs, dir, ref: branchName, checkout: true });
  await writeAndStage(dir, changes);

  const sha = await git.commit({
    fs,
    dir,
    message,
    author: { name: author, email: `${author}@join.cloud` },
  });

  // Switch back to previous branch
  await git.checkout({ fs, dir, ref: currentRef });

  const commit: RoomCommit = {
    id: crypto.randomUUID().slice(0, 8),
    sha,
    roomId,
    author,
    message,
    changes,
    verify: normalizedVerify,
    branch: branchName,
    status: "pending",
    reviews: [],
    createdAt: new Date().toISOString(),
  };

  await storeCommit(commit);
  await botNotify(
    roomId,
    `Pending commit ${commit.id} by ${author}: "${message}" — awaiting review (branch: ${branchName})`,
  );
  return commit;
}

// --- Review + Merge ---

function checkVerification(commit: RoomCommit): boolean {
  if (!commit.verify) return true;

  const approvals = commit.reviews.filter((r) => r.verdict === "approved");
  const rejections = commit.reviews.filter((r) => r.verdict === "rejected");

  if (rejections.length > 0) return false;

  if (commit.verify.requiredAgents) {
    for (const required of commit.verify.requiredAgents) {
      if (!approvals.some((r) => r.reviewer === required)) return false;
    }
  }

  if (commit.verify.consensus) {
    const totalVotes = commit.reviews.length;
    if (totalVotes < commit.verify.consensus.quorum) return false;
    const approvalRatio = approvals.length / totalVotes;
    if (approvalRatio < commit.verify.consensus.threshold) return false;
  }

  if (!commit.verify.requiredAgents && !commit.verify.consensus) {
    return approvals.length >= 1;
  }

  return true;
}

export async function reviewCommit(
  roomId: string,
  commitId: string,
  reviewer: string,
  verdict: "approved" | "rejected" | "revision-requested",
  comment: string,
): Promise<RoomCommit | null> {
  const commit = await storeGetCommit(roomId, commitId);
  if (!commit || commit.status !== "pending") return null;

  const review: CommitReview = {
    commitId,
    reviewer,
    verdict,
    comment,
    createdAt: new Date().toISOString(),
  };

  commit.reviews.push(review);

  await botNotify(
    roomId,
    `Review on ${commitId} by ${reviewer}: ${verdict}${comment ? ` — "${comment}"` : ""}`,
  );

  if (verdict === "rejected") {
    commit.status = "rejected";
    await storeUpdateCommit(commit);
    await botNotify(roomId, `Commit ${commitId} rejected`);
    return commit;
  }

  if (checkVerification(commit)) {
    // Merge the proposal branch into current branch
    const dir = repoDir(roomId);
    const current = await currentBranch(roomId);

    try {
      await git.merge({
        fs,
        dir,
        ours: current,
        theirs: commit.branch!,
        author: { name: "room-bot", email: "bot@join.cloud" },
      });
      commit.status = "merged";
      await botNotify(
        roomId,
        `Commit ${commitId} approved and merged (${commit.changes.length} file(s) changed)`,
      );

      // Clean up proposal branch
      try {
        await git.deleteBranch({ fs, dir, ref: commit.branch! });
      } catch {
        // Branch cleanup failure is non-critical
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await botNotify(roomId, `Merge failed for ${commitId}: ${msg}`);
    }
  }

  await storeUpdateCommit(commit);
  return commit;
}

// --- Read operations ---

export async function readFile(
  roomId: string,
  filePath: string,
  ref?: string,
): Promise<string | undefined> {
  const dir = repoDir(roomId);
  await initRepo(roomId);

  try {
    const resolvedRef = ref ?? "HEAD";
    const { blob } = await git.readBlob({
      fs,
      dir,
      oid: await git.resolveRef({ fs, dir, ref: resolvedRef }),
      filepath: filePath,
    });
    return new TextDecoder().decode(blob);
  } catch {
    return undefined;
  }
}

export async function listFiles(
  roomId: string,
  ref?: string,
): Promise<string[]> {
  const dir = repoDir(roomId);
  await initRepo(roomId);

  try {
    return git.listFiles({ fs, dir, ref: ref ?? "HEAD" });
  } catch {
    return [];
  }
}

export async function getLog(
  roomId: string,
  ref?: string,
  depth?: number,
): Promise<Array<{ oid: string; message: string; author: string; timestamp: number }>> {
  const dir = repoDir(roomId);
  await initRepo(roomId);

  try {
    const commits = await git.log({ fs, dir, ref: ref ?? "HEAD", depth: depth ?? 50 });
    return commits.map((c) => ({
      oid: c.oid.slice(0, 8),
      message: c.commit.message,
      author: c.commit.author.name,
      timestamp: c.commit.author.timestamp,
    }));
  } catch {
    return [];
  }
}

// --- Diff ---

export async function diffCommit(
  roomId: string,
  commitId: string,
): Promise<RoomCommit | undefined> {
  return storeGetCommit(roomId, commitId);
}

export async function getPendingCommits(roomId: string): Promise<RoomCommit[]> {
  return storeGetPending(roomId);
}

export async function getCommitLog(roomId: string): Promise<RoomCommit[]> {
  return storeGetMerged(roomId);
}

// --- Tags ---

export async function createTag(
  roomId: string,
  tagName: string,
  ref?: string,
): Promise<void> {
  const dir = repoDir(roomId);
  await git.tag({ fs, dir, ref: tagName, object: ref ?? "HEAD" });
}

export async function listTags(roomId: string): Promise<string[]> {
  const dir = repoDir(roomId);
  return git.listTags({ fs, dir });
}

export async function deleteTag(
  roomId: string,
  tagName: string,
): Promise<void> {
  const dir = repoDir(roomId);
  await git.deleteTag({ fs, dir, ref: tagName });
}

// --- Blame (walk-based) ---

export async function blame(
  roomId: string,
  filePath: string,
): Promise<Array<{ line: number; commit: string; author: string }>> {
  // Simplified blame — walk log and find which commit last touched each line
  const dir = repoDir(roomId);
  await initRepo(roomId);

  const content = await readFile(roomId, filePath);
  if (!content) return [];

  const lines = content.split("\n");
  const commits = await git.log({ fs, dir, ref: "HEAD", depth: 100 });

  // Simple approach: attribute all lines to the last commit that touched this file
  const result: Array<{ line: number; commit: string; author: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    // Find the first commit in history where this file existed
    let found = false;
    for (const c of commits) {
      try {
        await git.readBlob({ fs, dir, oid: c.oid, filepath: filePath });
        result.push({
          line: i + 1,
          commit: c.oid.slice(0, 8),
          author: c.commit.author.name,
        });
        found = true;
        break;
      } catch {
        continue;
      }
    }
    if (!found) {
      result.push({ line: i + 1, commit: "unknown", author: "unknown" });
    }
  }

  return result;
}

// --- Revert ---

export async function revertCommit(
  roomId: string,
  commitOid: string,
  author: string,
): Promise<RoomCommit> {
  // Read the parent commit's tree and restore those files
  const dir = repoDir(roomId);
  await initRepo(roomId);

  const targetCommit = await git.readCommit({ fs, dir, oid: commitOid });
  const parentOid = targetCommit.commit.parent[0];

  if (!parentOid) {
    throw new Error("Cannot revert the initial commit");
  }

  // Get files at parent
  const parentFiles = await git.listFiles({ fs, dir, ref: parentOid });
  const changes: FileChange[] = [];

  for (const filePath of parentFiles) {
    try {
      const { blob } = await git.readBlob({ fs, dir, oid: parentOid, filepath: filePath });
      const content = new TextDecoder().decode(blob);
      changes.push({ path: filePath, content });
    } catch {
      continue;
    }
  }

  // Commit the revert
  return createCommit(
    roomId,
    author,
    `Revert "${targetCommit.commit.message.trim()}"`,
    changes,
  );
}

// --- Status ---

export async function getStatus(
  roomId: string,
): Promise<Array<{ path: string; status: string }>> {
  const dir = repoDir(roomId);
  await initRepo(roomId);

  const matrix = await git.statusMatrix({ fs, dir });
  return matrix
    .filter(([, head, workdir, stage]) => head !== workdir || head !== stage)
    .map(([filepath, head, workdir, stage]) => ({
      path: filepath as string,
      status:
        head === 0 && workdir === 2 ? "added" :
        head === 1 && workdir === 0 ? "deleted" :
        head === 1 && workdir === 2 ? "modified" :
        "unknown",
    }));
}
