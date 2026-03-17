import type { A2AMessage } from "../a2a.js";
import { reply, error } from "../helpers.js";
import { getRoomById } from "../store.js";
import { botNotify } from "../bot.js";
import {
  createBranch,
  listBranches,
  checkoutBranch,
  deleteBranch,
  currentBranch,
} from "../git.js";

export async function handleBranchAction(
  action: string,
  contextId: string | undefined,
  metadata: Record<string, unknown> | undefined,
): Promise<A2AMessage | null> {
  if (action === "git.branch.create") {
    if (!contextId) return error("contextId (roomId) required");
    const branchName = metadata?.branch as string;
    if (!branchName) return error("branch required in metadata");
    const startPoint = metadata?.from as string | undefined;
    await createBranch(contextId, branchName, startPoint);
    await botNotify(contextId, `Branch "${branchName}" created`);
    return reply(`Branch created: ${branchName}`, contextId, { branch: branchName });
  }

  if (action === "git.branch.list") {
    if (!contextId) return error("contextId (roomId) required");
    if (!(await getRoomById(contextId))) return error(`Room not found: ${contextId}`);
    const branches = await listBranches(contextId);
    const current = await currentBranch(contextId);
    return reply(
      branches.map((b) => (b === current ? `* ${b}` : `  ${b}`)).join("\n"),
      contextId,
      { branches, current },
    );
  }

  if (action === "git.branch.checkout") {
    if (!contextId) return error("contextId (roomId) required");
    const branchName = metadata?.branch as string;
    if (!branchName) return error("branch required in metadata");
    await checkoutBranch(contextId, branchName);
    await botNotify(contextId, `Switched to branch "${branchName}"`);
    return reply(`Switched to ${branchName}`, contextId, { branch: branchName });
  }

  if (action === "git.branch.delete") {
    if (!contextId) return error("contextId (roomId) required");
    const branchName = metadata?.branch as string;
    if (!branchName) return error("branch required in metadata");
    await deleteBranch(contextId, branchName);
    return reply(`Branch deleted: ${branchName}`, contextId);
  }

  return null;
}
