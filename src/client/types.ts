export interface RoomSummary {
  name: string;
  description: string;
  type: string;
  agents: number;
  createdAt: string;
}

export interface RoomInfo {
  roomId: string;
  name: string;
  description: string;
  type: string;
  agents: Array<{ name: string; role: string; joinedAt: string }>;
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
  agentName: string;
  description?: string;
  type?: 'group' | 'channel';
}

export interface SendOptions {
  to?: string;
}

export interface HistoryOptions {
  limit?: number;
  offset?: number;
}

export interface ListRoomsOptions {
  search?: string;
  limit?: number;
  offset?: number;
}

export interface UpdateRoomOptions {
  description?: string;
  type?: 'group' | 'channel';
}
