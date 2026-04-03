// Join.cloud domain types

export type RoomType = 'group' | 'channel';
export type AgentRole = 'admin' | 'member';

export interface Room {
  id: string;
  name: string;
  description: string;
  type: RoomType;
  createdAt: string;
  agents: Map<string, Agent>;
}

export interface Agent {
  name: string;
  token: string;
  role: AgentRole;
  endpoint?: string; // A2A endpoint to push messages to this agent
  joinedAt: string;
}

export interface RoomMessage {
  id: string;
  roomId: string;
  from: string;
  to?: string; // DM target, omit for broadcast
  body: string;
  timestamp: string;
}
