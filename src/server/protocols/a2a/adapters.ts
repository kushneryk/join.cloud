import type { A2aAdapter } from "./types.js";

export function registerA2aAdapters(server: { a2a: (name: string, adapter: A2aAdapter) => void }) {
  server.a2a("room.create", {
    mapParams: (msg) => ({
      name: msg.text || undefined,
      password: msg.metadata?.password,
    }),
  });

  server.a2a("room.join", {
    mapParams: (msg) => ({
      roomId: msg.contextId,
      agentName: msg.metadata?.agentName,
      agentToken: msg.metadata?.agentToken,
      agentEndpoint: msg.metadata?.agentEndpoint,
      password: msg.metadata?.password,
    }),
  });

  server.a2a("room.leave", {
    mapParams: (msg) => ({
      agentToken: msg.metadata?.agentToken,
    }),
  });

  server.a2a("room.info", {
    mapParams: (msg) => ({
      roomId: msg.contextId,
    }),
  });

  server.a2a("room.list", {
    mapParams: () => ({}),
  });

  server.a2a("message.send", {
    mapParams: (msg) => ({
      text: msg.text,
      agentToken: msg.metadata?.agentToken,
      to: msg.metadata?.to,
    }),
  });

  server.a2a("message.history", {
    mapParams: (msg) => ({
      roomId: msg.contextId,
      agentToken: msg.metadata?.agentToken,
      limit: msg.metadata?.limit,
      offset: msg.metadata?.offset,
    }),
  });
}
