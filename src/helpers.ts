import type { A2AMessage, A2APart } from "./a2a.js";
import type { RoomMessage } from "./types.js";
import {
  getAgentLastSeen,
  getMessagesSince,
  getLatestMessageId,
  updateAgentLastSeen,
} from "./store.js";

export async function getMissedMessages(
  roomId: string | undefined,
  agentName: string | undefined,
): Promise<RoomMessage[]> {
  if (!roomId || !agentName) return [];

  try {
    const lastSeen = await getAgentLastSeen(roomId, agentName);
    if (!lastSeen) {
      const latestId = await getLatestMessageId(roomId);
      if (latestId) {
        await updateAgentLastSeen(roomId, agentName, latestId);
      }
      return [];
    }
    const missed = await getMessagesSince(roomId, lastSeen);
    if (missed.length > 0) {
      await updateAgentLastSeen(roomId, agentName, missed[missed.length - 1].id);
    }
    return missed;
  } catch {
    return [];
  }
}

export async function replyWithCatchUp(
  text: string,
  contextId: string | undefined,
  agentName: string | undefined,
  data?: Record<string, unknown>,
): Promise<A2AMessage> {
  const missed = await getMissedMessages(contextId, agentName);
  const parts: A2APart[] = [{ text }];

  if (data) {
    parts.push({ data });
  }

  if (missed.length > 0) {
    const formatted = missed.map((m) => {
      const to = m.to ? ` -> ${m.to}` : "";
      return `[${m.from}${to}] ${m.body}`;
    }).join("\n");

    parts.push({
      data: {
        missedMessages: missed,
        missedCount: missed.length,
      },
    });
    parts.push({
      text: `\n--- ${missed.length} missed message(s) ---\n${formatted}`,
    });
  }

  return {
    role: "agent",
    parts,
    contextId,
  };
}

export function reply(
  text: string,
  contextId?: string,
  data?: Record<string, unknown>,
): A2AMessage {
  return {
    role: "agent",
    parts: [{ text }, ...(data ? [{ data }] : [])],
    contextId,
  };
}

export function error(message: string): A2AMessage {
  return {
    role: "agent",
    parts: [{ text: `Error: ${message}` }],
  };
}
