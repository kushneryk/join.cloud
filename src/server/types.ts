// Join.cloud domain types

export interface Room {
  id: string;
  name: string;
  createdAt: string;
  agents: Map<string, Agent>;
}

export interface Agent {
  name: string;
  token: string;
  endpoint?: string; // A2A endpoint to push messages to this agent
  isHuman?: boolean; // true when joined from a browser
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
