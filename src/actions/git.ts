import type { A2AMessage } from "../a2a.js";
import { reply, error } from "../helpers.js";
import { getRoomById, getRoomCommits } from "../store.js";
import {
  createCommit,
  reviewCommit,
  getPendingCommits,
  getCommitLog,
  readFile,
  listFiles,
  diffCommit,
  getLog,
  blame,
  revertCommit,
  getStatus,
} from "../git.js";

export async function handleGitAction(
  action: string,
  text: string,
  contextId: string | undefined,
  agentName: string | undefined,
  metadata: Record<string, unknown> | undefined,
): Promise<A2AMessage | null> {
  if (action === "git.commit") {
    if (!contextId) return error("contextId (roomId) required");
    if (!agentName) return error("agentName required in metadata");

    const commitMsg = metadata?.commitMessage as string ?? text;
    const changes = metadata?.changes as Array<{ path: string; content: string }>;
    const verify = metadata?.verify as Record<string, unknown> | boolean | undefined;

    if (!changes?.length) return error("changes required in metadata");

    const commit = await createCommit(
      contextId,
      agentName,
      commitMsg,
      changes,
      verify as any,
    );

    return reply(
      `Commit ${commit.id}: ${commit.status}`,
      contextId,
      { commit: { id: commit.id, status: commit.status, message: commit.message } },
    );
  }

  if (action === "git.review") {
    if (!contextId) return error("contextId (roomId) required");
    if (!agentName) return error("agentName required in metadata");

    const commitId = metadata?.commitId as string;
    const verdict = metadata?.verdict as "approved" | "rejected" | "revision-requested";
    const comment = metadata?.comment as string ?? "";

    if (!commitId) return error("commitId required in metadata");
    if (!verdict) return error("verdict required in metadata");

    const commit = await reviewCommit(contextId, commitId, agentName, verdict, comment);
    if (!commit) return error(`Commit not found or not pending: ${commitId}`);

    return reply(
      `Review submitted: ${verdict}. Commit status: ${commit.status}`,
      contextId,
      { commit: { id: commit.id, status: commit.status } },
    );
  }

  if (action === "git.pending") {
    if (!contextId) return error("contextId (roomId) required");
    if (!(await getRoomById(contextId))) return error(`Room not found: ${contextId}`);
    const pending = await getPendingCommits(contextId);
    return reply(JSON.stringify(pending, null, 2), contextId, { commits: pending });
  }

  if (action === "git.log") {
    if (!contextId) return error("contextId (roomId) required");
    if (!(await getRoomById(contextId))) return error(`Room not found: ${contextId}`);
    const log = await getCommitLog(contextId);
    return reply(JSON.stringify(log, null, 2), contextId, { commits: log });
  }

  if (action === "git.read") {
    if (!contextId) return error("contextId (roomId) required");
    const path = metadata?.path as string;

    if (!path) {
      const fileList = await listFiles(contextId);
      return reply(JSON.stringify(fileList), contextId, { files: fileList });
    }

    const content = await readFile(contextId, path);
    if (content === undefined) return error(`File not found: ${path}`);

    return reply(content, contextId, { path, content });
  }

  if (action === "git.diff") {
    if (!contextId) return error("contextId (roomId) required");
    const commitId = metadata?.commitId as string;
    if (!commitId) return error("commitId required in metadata");

    const commit = await diffCommit(contextId, commitId);
    if (!commit) return error(`Commit not found: ${commitId}`);

    return reply(JSON.stringify(commit, null, 2), contextId, { commit });
  }

  if (action === "git.history") {
    if (!contextId) return error("contextId (roomId) required");
    if (!(await getRoomById(contextId))) return error(`Room not found: ${contextId}`);
    const ref = metadata?.ref as string | undefined;
    const depth = metadata?.depth as number | undefined;
    const log = await getLog(contextId, ref, depth);
    return reply(JSON.stringify(log, null, 2), contextId, { log });
  }

  if (action === "git.status") {
    if (!contextId) return error("contextId (roomId) required");
    if (!(await getRoomById(contextId))) return error(`Room not found: ${contextId}`);
    const status = await getStatus(contextId);
    if (status.length === 0) {
      return reply("Working tree clean", contextId, { status: [] });
    }
    const formatted = status.map((s) => `${s.status}: ${s.path}`).join("\n");
    return reply(formatted, contextId, { status });
  }

  if (action === "git.blame") {
    if (!contextId) return error("contextId (roomId) required");
    const filePath = metadata?.path as string;
    if (!filePath) return error("path required in metadata");
    const result = await blame(contextId, filePath);
    if (result.length === 0) return error(`File not found or empty: ${filePath}`);
    const formatted = result.map((l) => `${l.commit} (${l.author}) line ${l.line}`).join("\n");
    return reply(formatted, contextId, { blame: result });
  }

  if (action === "git.revert") {
    if (!contextId) return error("contextId (roomId) required");
    if (!agentName) return error("agentName required in metadata");
    const commitOid = metadata?.commitId as string;
    if (!commitOid) return error("commitId required in metadata");

    const allCommits = await getRoomCommits(contextId);
    const found = allCommits.find((c: any) => c.id === commitOid);
    const fullOid = found?.sha ?? commitOid;

    const revertedCommit = await revertCommit(contextId, fullOid, agentName);
    return reply(
      `Reverted to before "${found?.message ?? commitOid}". New commit: ${revertedCommit.id}`,
      contextId,
      { commit: { id: revertedCommit.id, status: revertedCommit.status } },
    );
  }

  return null;
}
