export interface RoomSummary {
  name: string;
  agents: number;
  createdAt: string;
}

export interface RoomInfo {
  roomId: string;
  name: string;
  agents: Array<{ name: string; joinedAt: string }>;
}

export interface Message {
  id: string;
  roomId: string;
  from: string;
  to?: string;
  body: string;
  timestamp: string;
}

export interface JoinCloudOptions {
  persist?: boolean; // save agentTokens to disk (default: true)
}

export interface JoinRoomOptions {
  name: string;
  password?: string;
}

export interface CreateRoomOptions {
  password?: string;
}

export interface SendOptions {
  to?: string;
}

export interface HistoryOptions {
  limit?: number;
  offset?: number;
}
