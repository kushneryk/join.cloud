const BASE = process.env.TEST_URL ?? "http://localhost:3000";
const TARGET = process.env.TEST_TARGET ?? "local";
const isProd = TARGET === "prod";

export { BASE, TARGET, isProd };

// --- A2A helpers ---

export async function a2a(
  action: string,
  contextId?: string,
  text?: string,
  metadata?: Record<string, unknown>,
) {
  const res = await fetch(`${BASE}/a2a`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "SendMessage",
      params: {
        message: {
          role: "user",
          parts: [{ text: text ?? "" }],
          ...(contextId && { contextId }),
          metadata: { action, ...metadata },
        },
      },
    }),
  });
  return (await res.json()) as any;
}

export async function a2aRaw(body: unknown) {
  const res = await fetch(`${BASE}/a2a`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as any;
}

export async function a2aRawText(body: string) {
  const res = await fetch(`${BASE}/a2a`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return (await res.json()) as any;
}

export function resultText(json: any): string {
  return json.result?.parts?.find((p: any) => p.text)?.text ?? "";
}

export function resultData(json: any): any {
  return json.result?.parts?.find((p: any) => p.data)?.data;
}

export function isError(json: any): boolean {
  const text = resultText(json);
  return text.startsWith("Error:") || !!json.error;
}

export function isRpcError(json: any): boolean {
  return !!json.error;
}

let counter = 0;
const RUN_ID = Math.random().toString(36).slice(2, 8);
export function uniqueName(prefix = "test"): string {
  return `${prefix}-${RUN_ID}-${counter++}`;
}

export async function createRoom(name?: string, password?: string, extra?: Record<string, unknown>) {
  const n = name ?? uniqueName("room");
  const agentName = extra?.agentName as string ?? "creator";
  const metadata: Record<string, unknown> = { agentName };
  if (password) metadata.password = password;
  if (extra?.description !== undefined) metadata.description = extra.description;
  if (extra?.type !== undefined) metadata.type = extra.type;
  const res = await a2a("room.create", undefined, n, metadata);
  const data = resultData(res);
  if (!data?.roomId) throw new Error(`createRoom failed: ${resultText(res)}`);
  return { roomId: data.roomId as string, name: n, agentToken: data.agentToken as string, res };
}

export async function joinRoom(roomName: string, agentName: string, extra?: Record<string, unknown>) {
  const res = await a2a("room.join", roomName, "", { agentName, ...extra });
  const data = resultData(res);
  return { ...res, agentToken: data?.agentToken as string, roomId: data?.roomId as string, role: data?.role as string };
}

export async function sendMsg(agentToken: string, text: string, to?: string) {
  return a2a("message.send", undefined, text, { agentToken, ...(to && { to }) });
}

export async function promoteAgent(agentToken: string, targetAgent: string) {
  return a2a("room.promote", undefined, "", { agentToken, targetAgent });
}

export async function demoteAgent(agentToken: string, targetAgent: string) {
  return a2a("room.demote", undefined, "", { agentToken, targetAgent });
}

export async function kickAgent(agentToken: string, targetAgent: string) {
  return a2a("room.kick", undefined, "", { agentToken, targetAgent });
}

export async function updateRoom(agentToken: string, fields: { description?: string; type?: string }) {
  return a2a("room.update", undefined, "", { agentToken, ...fields });
}
