import type { RoomMessage } from "./types.js";
import type { Store } from "./storage/interface.js";

export async function getMissedMessages(
  store: Store,
  roomId: string | undefined,
  agentName: string | undefined,
): Promise<RoomMessage[]> {
  if (!roomId || !agentName) return [];

  try {
    const lastSeen = await store.getAgentLastSeen(roomId, agentName);
    if (!lastSeen) {
      const latestId = await store.getLatestMessageId(roomId);
      if (latestId) {
        await store.updateAgentLastSeen(roomId, agentName, latestId);
      }
      return [];
    }
    const missed = await store.getMessagesSince(roomId, lastSeen);
    if (missed.length > 0) {
      const lastMsgId = missed[missed.length - 1].id;
      await store.updateAgentLastSeen(roomId, agentName, lastMsgId);
    }
    return missed;
  } catch {
    return [];
  }
}
