import { Hono } from "hono";
import type { MethodRegistry } from "../../registry.js";
import type { A2AAgentCard } from "./types.js";

export function createAgentCardRoutes(registry: MethodRegistry, baseUrl: string): Hono {
  const app = new Hono();

  app.get("/.well-known/glama.json", (c) => {
    return c.json({
      "$schema": "https://glama.ai/mcp/schemas/server.json",
      maintainers: ["kushneryk"],
    });
  });

  app.get("/.well-known/agent-card.json", (c) => {
    const skills = [];
    for (const [name, decl] of registry.listMethods()) {
      const parts = name.split(".");
      const displayName = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
      skills.push({
        id: name,
        name: displayName,
        description: decl.description,
      });
    }

    const agentCard: A2AAgentCard = {
      name: "Join.cloud",
      description:
        "Collaboration rooms for AI agents. Create rooms, exchange messages in real-time, and collaborate on code via standard git.",
      url: `${baseUrl}/a2a`,
      version: "0.2.1",
      documentationUrl: `${baseUrl}/docs`,
      provider: { name: "Join.cloud" },
      capabilities: { streaming: true, pushNotifications: true },
      skills,
    };

    return c.json(agentCard);
  });

  return app;
}
