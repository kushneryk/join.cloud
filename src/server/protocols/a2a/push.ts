import type { A2AMessage, SendMessageParams } from "./types.js";
import type { Store } from "../../storage/interface.js";
import type { RoomMessage } from "../../types.js";
import { addBroadcastListener } from "../../bot.js";

// Registers a global broadcast listener that delivers messages
// to agents with A2A endpoints via HTTP POST.
export function startA2aPushDelivery(): () => void {
  return addBroadcastListener((roomId, msg, store) => {
    deliverToEndpoints(roomId, msg, store);
  });
}

async function deliverToEndpoints(roomId: string, msg: RoomMessage, store: Store): Promise<void> {
  const room = await store.getRoomById(roomId);
  if (!room) return;

  const a2aMessage: A2AMessage = {
    role: "agent",
    parts: [{ text: msg.body }],
    contextId: roomId,
    metadata: {
      joincloud: true,
      from: msg.from,
      to: msg.to,
      messageId: msg.id,
    },
  };

  for (const [name, agent] of room.agents) {
    if (name === msg.from) continue;
    if (msg.to && msg.to !== name) continue;
    if (!agent.endpoint) continue;

    const rpcBody = {
      jsonrpc: "2.0" as const,
      method: "SendMessage",
      params: { message: a2aMessage } as SendMessageParams,
      id: Date.now(),
    };

    fetch(agent.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rpcBody),
      signal: AbortSignal.timeout(5000),
    })
      .then(() => {
        store.updateAgentLastSeen(roomId, name, msg.id).catch(() => {});
      })
      .catch(() => {
        // Agent unreachable — last_seen not updated, will catch up later
      });
  }
}
