import type { SendMessageParams, A2AMessage, A2ATask } from "../a2a.js";
import { reply, error } from "../helpers.js";
import { DOCS, DOCS_STRUCTURED } from "../docs.js";
import { getRoom } from "../store.js";
import { handleRoomAction } from "./room.js";
import { handleMessageAction, handleDefaultChat } from "./messages.js";
import { handleGitAction } from "./git.js";
import { handleBranchAction } from "./branches.js";
import { handleTagAction } from "./tags.js";

const ACTION_ALIASES: Record<string, string> = {
  "create": "room.create",
  "join": "room.join",
  "leave": "room.leave",
  "info": "room.info",
  "list": "room.list",
  "send": "message.send",
  "history": "message.history",
  "commit": "git.commit",
  "review": "git.review",
  "pending": "git.pending",
  "log": "git.log",
  "read": "git.read",
  "diff": "git.diff",
  "blame": "git.blame",
  "revert": "git.revert",
  "status": "git.status",
};

export async function handleSendMessage(
  params: SendMessageParams,
): Promise<A2AMessage | A2ATask> {
  const msg = params.message;
  const text = msg.parts.find((p) => p.text)?.text ?? "";
  let contextId = msg.contextId;
  const metadata = msg.metadata as Record<string, unknown> | undefined;

  const rawAction = metadata?.action as string | undefined;
  const action = rawAction ? (ACTION_ALIASES[rawAction] ?? rawAction) : undefined;
  const agentName = metadata?.agentName as string | undefined;

  // Resolve room name to ID — only for room.* methods (other methods require the UUID directly)
  if (contextId && action?.startsWith("room.") && action !== "room.create" && action !== "room.list") {
    const room = await getRoom(contextId);
    if (room) contextId = room.id;
  }

  // Try each handler in order; first non-null wins
  const result =
    (action?.startsWith("room.") ? await handleRoomAction(action, text, contextId, metadata) : null) ??
    (action?.startsWith("message.") ? await handleMessageAction(action, text, contextId, agentName, metadata) : null) ??
    (action?.startsWith("git.branch.") ? await handleBranchAction(action, contextId, metadata) : null) ??
    (action?.startsWith("git.tag.") ? await handleTagAction(action, contextId, metadata) : null) ??
    (action?.startsWith("git.") ? await handleGitAction(action, text, contextId, agentName, metadata) : null);

  if (result) return result;

  if (action === "help") return reply(DOCS, undefined, { documentation: DOCS_STRUCTURED });

  if (action) {
    return error(`Unknown action: ${action}. Send metadata.action: "help" for full documentation.`);
  }

  // No action — default chat or docs
  const chatResult = await handleDefaultChat(text, contextId, agentName);
  if (chatResult) return chatResult;

  return reply(DOCS, undefined, { documentation: DOCS_STRUCTURED });
}
