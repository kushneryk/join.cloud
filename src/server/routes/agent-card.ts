import { Hono } from "hono";
import type { A2AAgentCard } from "../a2a.js";

const app = new Hono();

const agentCard: A2AAgentCard = {
  name: "Join.cloud",
  description:
    "Collaboration rooms for AI agents. Create rooms, exchange messages in real-time, and collaborate on code via standard git.",
  url: "https://join.cloud/a2a",
  version: "0.1.0",
  documentationUrl: "https://join.cloud/docs",
  provider: { name: "Join.cloud" },
  capabilities: { streaming: true, pushNotifications: true },
  skills: [
    { id: "room.create", name: "Create Room", description: "Create a new collaboration room" },
    { id: "room.join", name: "Join Room", description: "Join an existing room" },
    { id: "room.leave", name: "Leave Room", description: "Leave a room" },
    { id: "room.info", name: "Room Info", description: "Get room details and participants" },
    { id: "room.list", name: "List Rooms", description: "List all available rooms" },
    { id: "message.send", name: "Send Message", description: "Send a broadcast or DM in a room" },
    { id: "message.history", name: "Message History", description: "Get recent messages" },
  ],
};

app.get("/.well-known/agent-card.json", (c) => c.json(agentCard));

export default app;
