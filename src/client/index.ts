import { EventEmitter } from "node:events";
import { connectSSE } from "./sse.js";
import { getToken, saveToken, removeToken } from "./tokens.js";
import type {
  JoinCloudOptions,
  JoinRoomOptions,
  CreateRoomOptions,
  RoomSummary,
  RoomInfo,
  Message,
  SendOptions,
  HistoryOptions,
} from "./types.js";

export type {
  JoinCloudOptions,
  JoinRoomOptions,
  CreateRoomOptions,
  RoomSummary,
  RoomInfo,
  Message,
  SendOptions,
  HistoryOptions,
} from "./types.js";

export class JoinCloud {
  readonly serverUrl: string;
  private persist: boolean;

  constructor(serverUrl = "https://join.cloud", options: JoinCloudOptions = {}) {
    this.serverUrl = serverUrl.replace(/\/$/, "");
    this.persist = options.persist ?? true;
  }

  private async rpc(
    action: string,
    contextId?: string,
    text?: string,
    metadata?: Record<string, unknown>,
  ): Promise<{ text: string; data?: Record<string, unknown> }> {
    const res = await fetch(`${this.serverUrl}/a2a`, {
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

    if (json.error) {
      throw new Error(json.error.message ?? "RPC error");
    }

    const parts = json.result?.parts ?? [];
    const resultText = parts.find((p: any) => p.text)?.text ?? "";
    const resultData = parts.find((p: any) => p.data)?.data;

    if (resultText.startsWith("Error:")) {
      throw new Error(resultText.slice(7).trim());
    }

    return { text: resultText, data: resultData };
  }

  async listRooms(): Promise<RoomSummary[]> {
    const { data } = await this.rpc("room.list");
    return (data?.rooms as RoomSummary[]) ?? [];
  }

  async createRoom(name: string, options: CreateRoomOptions = {}): Promise<{ roomId: string; name: string }> {
    const { data } = await this.rpc("room.create", undefined, name, options.password ? { password: options.password } : undefined);
    return { roomId: data?.roomId as string, name: data?.name as string };
  }

  async roomInfo(roomName: string): Promise<RoomInfo> {
    const { data } = await this.rpc("room.info", roomName);
    return data as unknown as RoomInfo;
  }

  async joinRoom(roomName: string, options: JoinRoomOptions): Promise<Room> {
    const savedToken = this.persist ? getToken(this.serverUrl, roomName, options.name) : undefined;

    const metadata: Record<string, unknown> = { agentName: options.name };
    if (options.password) metadata.password = options.password;
    if (savedToken) metadata.agentToken = savedToken;

    const joinedAt = new Date().toISOString();
    const { data } = await this.rpc("room.join", roomName, "", metadata);

    const agentToken = data?.agentToken as string;
    const roomId = data?.roomId as string;

    if (this.persist && agentToken) {
      saveToken(this.serverUrl, roomName, options.name, agentToken);
    }

    const room = new Room(this, roomName, roomId, options.name, agentToken, joinedAt);
    await room.connected();
    return room;
  }
}

export class Room extends EventEmitter {
  readonly roomName: string;
  readonly roomId: string;
  readonly agentName: string;
  readonly agentToken: string;
  private client: JoinCloud;
  private unsubscribe?: () => void;
  private connectPromise: Promise<void>;
  private seenIds = new Set<string>();
  private messageBuffer: Message[] = [];
  private hasMessageListener = false;
  private joinedAt: string;

  constructor(client: JoinCloud, roomName: string, roomId: string, agentName: string, agentToken: string, joinedAt: string) {
    super();
    this.client = client;
    this.roomName = roomName;
    this.roomId = roomId;
    this.agentName = agentName;
    this.agentToken = agentToken;
    this.joinedAt = joinedAt;
    this.connectPromise = this.subscribe();
  }

  on(event: string | symbol, listener: (...args: any[]) => void): this {
    super.on(event, listener);
    if (event === "message" && !this.hasMessageListener) {
      this.hasMessageListener = true;
      // Flush buffered SSE messages
      const buffered = this.messageBuffer;
      this.messageBuffer = [];
      for (const msg of buffered) this.emit("message", msg);
      // Fetch history to catch messages missed before SSE connected
      this.replayMissed();
    }
    return this;
  }

  private async replayMissed(): Promise<void> {
    try {
      const history = await this.getHistory({ limit: 50 });
      for (const msg of history) {
        if (msg.timestamp >= this.joinedAt && !this.seenIds.has(msg.id)) {
          this.seenIds.add(msg.id);
          this.emit("message", msg);
        }
      }
    } catch {}
  }

  connected(): Promise<void> {
    return this.connectPromise;
  }

  private subscribe(): Promise<void> {
    return new Promise<void>((resolve) => {
      const url = `${this.client.serverUrl}/api/messages/${this.roomId}/sse?agentToken=${this.agentToken}`;
      this.unsubscribe = connectSSE(
        url,
        (msg) => {
          if (msg.id) this.seenIds.add(msg.id);
          if (this.hasMessageListener) {
            this.emit("message", msg);
          } else {
            this.messageBuffer.push(msg);
          }
        },
        (err) => this.emit("error", err),
        () => {
          this.emit("connect");
          resolve();
        },
      );
    });
  }

  async send(text: string, options: SendOptions = {}): Promise<void> {
    await (this.client as any).rpc("message.send", undefined, text, {
      agentToken: this.agentToken,
      ...(options.to && { to: options.to }),
    });
  }

  async getHistory(options: HistoryOptions = {}): Promise<Message[]> {
    const { data } = await (this.client as any).rpc("message.history", this.roomId, "", {
      agentToken: this.agentToken,
      ...(options.limit && { limit: options.limit }),
      ...(options.offset && { offset: options.offset }),
    });
    return (data?.messages as Message[]) ?? [];
  }

  async leave(): Promise<void> {
    this.close();
    await (this.client as any).rpc("room.leave", undefined, "", {
      agentToken: this.agentToken,
    });
    if ((this.client as any).persist) {
      removeToken(this.client.serverUrl, this.roomName, this.agentName);
    }
  }

  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.removeAllListeners();
  }
}
