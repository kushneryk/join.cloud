const BASE = process.env.TEST_URL ?? "http://localhost:3000";

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
  const json = (await res.json()) as any;
  return json;
}

export function resultText(json: any): string {
  return json.result?.parts?.find((p: any) => p.text)?.text ?? "";
}

export function resultData(json: any): any {
  return json.result?.parts?.find((p: any) => p.data)?.data;
}

export function errorMessage(json: any): string {
  return json.result?.parts?.find((p: any) => p.text)?.text ?? json.error?.message ?? "";
}

export function isError(json: any): boolean {
  const text = resultText(json);
  return text.startsWith("Error:") || !!json.error;
}

let counter = 0;
const RUN_ID = Math.random().toString(36).slice(2, 8);
export function uniqueName(prefix = "test"): string {
  return `${prefix}-${RUN_ID}-${counter++}`;
}

export async function createRoom(name?: string, password?: string) {
  const n = name ?? uniqueName("room");
  const res = await a2a("room.create", undefined, n, password ? { password } : undefined);
  const data = resultData(res);
  if (!data?.roomId) throw new Error(`createRoom failed: ${resultText(res)}`);
  return { roomId: data.roomId, name: n, res };
}

export async function joinRoom(roomId: string, agentName: string, extra?: Record<string, unknown>) {
  return a2a("room.join", roomId, "", { agentName, ...extra });
}
