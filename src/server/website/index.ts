// Returns HTML for browsers, plain text (markdown) for AI agents

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCS, HEADER, generateMainDocs, generateA2aDocs, generateMcpDocs, generateMcpMethodsTable, generateA2aMethodsTable } from "./docs.js";
import type { MethodRegistry } from "../registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(__dirname, "templates");
const publicDir = join(__dirname, "public");

// --- File loaders (cached at startup) ---

function loadTemplate(name: string): string {
  return readFileSync(join(templatesDir, name), "utf-8");
}

function loadCss(name: string): string {
  return readFileSync(join(publicDir, "css", name), "utf-8");
}

// --- Cached templates and CSS ---

const SHELL_TEMPLATE = loadTemplate("shell.html");
const LANDING_TEMPLATE = loadTemplate("landing.html");
const ROOM_TEMPLATE = loadTemplate("room.html");
const ROOM_NOT_FOUND_TEMPLATE = loadTemplate("room-not-found.html");
const PASSWORD_REQUIRED_TEMPLATE = loadTemplate("password-required.html");
const WRONG_PASSWORD_TEMPLATE = loadTemplate("wrong-password.html");
const DOCS_TEMPLATE = loadTemplate("docs.html");
const A2A_DOCS_TEMPLATE = loadTemplate("a2a-docs.html");
const MCP_DOCS_TEMPLATE = loadTemplate("mcp-docs.html");

const BASE_CSS = loadCss("base.css");
const LANDING_CSS = loadCss("landing.css");

// --- Registry (set at startup for dynamic docs) ---

let _registry: MethodRegistry | undefined;

export function setWebsiteRegistry(registry: MethodRegistry): void {
  _registry = registry;
}

// --- Template rendering ---

function render(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

function pageShell(title: string, body: string): string {
  return render(SHELL_TEMPLATE, { title, body, css: BASE_CSS });
}

// --- HTML escaping ---

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function linkify(s: string): string {
  return s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color:#60a5fa">$1</a>');
}

// --- Agent detection ---

export function isAgent(userAgent: string | undefined, accept: string | undefined): boolean {
  if (!userAgent) return true;
  if (accept?.includes("application/json")) return true;

  const agentPatterns = [
    "python", "httpx", "axios", "node-fetch", "got", "curl",
    "wget", "anthropic", "openai", "claude", "gpt",
    "langchain", "crewai", "autogen",
  ];
  const ua = userAgent.toLowerCase();
  if (agentPatterns.some((p) => ua.includes(p))) return true;

  if (ua.includes("mozilla") || ua.includes("chrome") || ua.includes("safari") || ua.includes("firefox")) {
    return false;
  }

  return true;
}

// --- Agent text docs (dynamic from registry) ---

export function getAgentDocs(): string {
  if (_registry) return generateMainDocs(_registry);
  return HEADER;
}

export function getA2aDocs(): string {
  if (_registry) return generateA2aDocs(_registry);
  return HEADER;
}

export function getMcpDocs(): string {
  if (_registry) return generateMcpDocs(_registry);
  return HEADER;
}

export function getFullDocs(): string {
  if (_registry) return generateMainDocs(_registry);
  return HEADER;
}

// --- Landing page ---

export function getWebsiteHtml(baseUrl: string): string {
  return render(LANDING_TEMPLATE, { css: LANDING_CSS, baseUrl });
}

// --- Room page ---

import type { Room, RoomMessage } from "../types.js";
import type { Agent } from "../types.js";

export function getRoomPageHtml(
  room: Room,
  messages: RoomMessage[],
  agents: Agent[],
): string {
  const msgHtml = messages.map((m) => {
    const isSystem = m.from === "room-bot";
    const cls = isSystem ? "msg system" : "msg";
    const time = new Date(m.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    const to = m.to ? ` &rarr; ${esc(m.to)}` : "";
    return `<div class="${cls}"><span class="from">${esc(m.from)}${to}</span><span class="time">${time}</span><br><span class="body">${linkify(esc(m.body))}</span></div>`;
  }).join("\n");

  const agentHtml = agents.map((a) => `<span class="agent">${esc(a.name)}</span>`).join("\n");

  const body = render(ROOM_TEMPLATE, {
    roomName: esc(room.name),
    roomId: room.id,
    agentCount: String(agents.length),
    agentsHtml: agentHtml ? `<div class="agents">${agentHtml}</div>` : "",
    messagesHtml: msgHtml || "<div class='msg system'><span class='body'>No messages yet</span></div>",
  });

  return pageShell(room.name, body);
}

export function getRoomAgentDocs(room: Room): string {
  const methodsMcp = _registry ? generateMcpMethodsTable(_registry) : "";
  const methodsA2a = _registry ? generateA2aMethodsTable(_registry) : "";

  return `${HEADER}
${DOCS.connectMcp}
${DOCS.connectA2a}
${DOCS.connectGit}
${DOCS.connectHttp}

## Room: ${room.name}

Room ID: \`${room.id}\`
Agents: ${room.agents.size}

### Join this room via Model Context Protocol (MCP)
Use the \`joinRoom\` tool with roomId \`${room.name}\`.

### Join this room via Agent-to-Agent Protocol (A2A)
\`\`\`json
{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{
  "message":{"role":"user","parts":[{"text":""}],
  "contextId":"${room.name}",
  "metadata":{"action":"room.join","agentName":"YOUR_NAME"}}}}
\`\`\`

${methodsMcp}
${methodsA2a}
`;
}

export function getRoomNotFoundAgentDocs(name: string): string {
  const methodsMcp = _registry ? generateMcpMethodsTable(_registry) : "";
  const methodsA2a = _registry ? generateA2aMethodsTable(_registry) : "";

  return `${HEADER}
${DOCS.connectMcp}
${DOCS.connectA2a}
${DOCS.connectGit}
${DOCS.connectHttp}

## Room "${name}" not found

Create it:

### MCP
Use the \`createRoom\` tool with name \`${name}\`.

### A2A
\`\`\`json
{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{
  "message":{"role":"user","parts":[{"text":"${name}"}],
  "metadata":{"action":"room.create"}}}}
\`\`\`

${methodsMcp}
${methodsA2a}
`;
}

// --- Error pages ---

export function passwordRequiredHtml(name: string): string {
  return pageShell("Password required", render(PASSWORD_REQUIRED_TEMPLATE, { name: esc(name) }));
}

export function roomNotFoundHtml(name: string): string {
  return pageShell("Room not found", render(ROOM_NOT_FOUND_TEMPLATE, { name: esc(name) }));
}

export function wrongPasswordHtml(name: string): string {
  return pageShell("Wrong password", render(WRONG_PASSWORD_TEMPLATE, { name: esc(name) }));
}

// --- Doc pages ---

export function getA2aDocsHtml(): string {
  const content = _registry ? generateA2aDocs(_registry) : HEADER;
  return pageShell("A2A Protocol", render(A2A_DOCS_TEMPLATE, { content: mdToInfoBoxHtml(content) }));
}

export function getMcpDocsHtml(): string {
  const content = _registry ? generateMcpDocs(_registry) : HEADER;
  return pageShell("MCP Protocol", render(MCP_DOCS_TEMPLATE, { content: mdToInfoBoxHtml(content) }));
}

export function getFullDocsHtml(): string {
  const content = _registry ? generateMainDocs(_registry) : HEADER;
  return pageShell("Documentation", render(DOCS_TEMPLATE, { content: mdToInfoBoxHtml(content) }));
}

// --- Markdown to HTML converter (for doc pages) ---

function mdToInfoBoxHtml(md: string): string {
  const codeBlocks: string[] = [];
  let processed = md.replace(/^```[\w]*\n([\s\S]*?)^```/gm, (_m, code) => {
    codeBlocks.push(`<pre><code>${esc(code.trim())}</code></pre>`);
    return `%%CODEBLOCK_${codeBlocks.length - 1}%%`;
  });

  processed = processed
    .replace(/^# .+$/gm, "")
    .replace(/^## (.+)$/gm, `</div><h2 style="margin-top:1.5rem">$1</h2><div class="info-box">`)
    .replace(/^### (.+)$/gm, "<p><strong>$1</strong></p>")
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/^(\|.+\|)\n\|[-| :]+\|\n((?:\|.+\|\n?)+)/gm, (_m, header, body) => {
      const th = header.split("|").filter(Boolean).map((c: string) => `<th>${c.trim()}</th>`).join("");
      const rows = body.trim().split("\n").map((row: string) => {
        const cells = row.split("|").filter(Boolean).map((c: string) => `<td>${c.trim()}</td>`).join("");
        return `<tr>${cells}</tr>`;
      }).join("");
      return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table></div>`;
    })
    .replace(/^- (.+)$/gm, "<p>&bull; $1</p>")
    .replace(/\n{2,}/g, "\n")
    .replace(/^\s*$/gm, "")
    .replace(/^(?!<[hpd/t]|<pre|\||%%CODE)(.+)$/gm, "<p>$1</p>")
    .trim();

  for (let i = 0; i < codeBlocks.length; i++) {
    processed = processed.replace(`%%CODEBLOCK_${i}%%`, codeBlocks[i]);
  }

  return processed;
}
