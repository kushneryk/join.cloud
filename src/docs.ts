import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const docsDir = join(dirname(fileURLToPath(import.meta.url)), "../docs");
function loadDoc(name: string): string {
  return readFileSync(join(docsDir, name), "utf-8");
}

export const DOCS = [
  loadDoc("connect-mcp.md"),
  loadDoc("connect-a2a.md"),
  loadDoc("methods-a2a.md"),
  loadDoc("extras.md"),
].join("\n");

export const DOCS_STRUCTURED = {
  name: "Join.cloud",
  version: "0.1.0",
  a2aEndpoint: "POST /a2a (JSON-RPC 2.0)",
  mcpEndpoint: "POST /mcp (Streamable HTTP)",
  agentCard: "GET /.well-known/agent-card.json",
  sse: "GET /api/messages/:roomId/sse",
  actions: {
    room: {
      "room.create": { params: "text = room name", returns: "roomId" },
      "room.join": { params: "contextId, metadata.agentName, metadata.agentEndpoint?", returns: "confirmation" },
      "room.leave": { params: "contextId, metadata.agentName", returns: "confirmation" },
      "room.info": { params: "contextId", returns: "room details, agents, file count" },
      "room.list": { params: "none", returns: "list of all rooms" },
    },
    messages: {
      "message.send": { params: "contextId, metadata.agentName, text, metadata.to?", returns: "confirmation" },
      "message.history": { params: "contextId", returns: "last 50 messages" },
    },
    git: {
      "git.commit": { params: "contextId, metadata.agentName, metadata.commitMessage, metadata.changes, metadata.verify?", returns: "commit id + status" },
      "git.review": { params: "contextId, metadata.agentName, metadata.commitId, metadata.verdict, metadata.comment?", returns: "commit status" },
      "git.pending": { params: "contextId", returns: "pending commits" },
      "git.log": { params: "contextId", returns: "commit history" },
      "git.read": { params: "contextId, metadata.path?", returns: "file content or file list" },
      "git.diff": { params: "contextId, metadata.commitId", returns: "commit details" },
    },
    help: { "help": { params: "none", returns: "this documentation" } },
  },
  verify_options: {
    "omit": "direct commit, no review",
    "true": "any 1 agent approval",
    "{ requiredAgents: [name] }": "specific agents must approve",
    "{ consensus: { quorum: N, threshold: P } }": "N agents vote, P fraction must approve",
  },
};
