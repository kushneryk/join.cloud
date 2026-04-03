import type { Room, RoomMessage, Agent } from "../types.js";

export interface Store {
  // Lifecycle
  init(): Promise<void>;

  // Rooms
  createRoom(id: string, name: string, password?: string, options?: { description?: string; type?: string }): Promise<Room>;
  getRoom(idOrName: string): Promise<Room | undefined>;
  getRoomById(id: string): Promise<Room | undefined>;
  getRoomsByName(name: string): Promise<Array<{ id: string; hasPassword: boolean }>>;
  getRoomByNameAndPassword(name: string, password: string): Promise<Room | undefined>;
  listRooms(options?: { search?: string; limit?: number; offset?: number }): Promise<{ rooms: Array<{ name: string; description: string; type: string; agents: number; createdAt: string }>; total: number }>;
  deleteRoom(id: string): Promise<void>;
  checkRoomPassword(id: string, password: string): Promise<boolean>;
  updateRoom(roomId: string, fields: { description?: string; type?: string }): Promise<void>;

  // Agents
  addAgent(roomId: string, name: string, endpoint?: string, role?: string): Promise<string>;
  agentExistsInRoom(roomId: string, name: string): Promise<boolean>;
  getAgentToken(roomId: string, name: string): Promise<string | null>;
  getAgentByToken(token: string): Promise<{ roomId: string; name: string; role: string; endpoint?: string } | undefined>;
  removeAgentByToken(token: string): Promise<{ roomId: string; name: string } | undefined>;
  removeAgent(roomId: string, name: string): Promise<void>;
  updateAgentEndpoint(token: string, endpoint?: string): Promise<void>;
  updateAgentLastSeen(roomId: string, name: string, messageId: string): Promise<void>;
  getAgentLastSeen(roomId: string, name: string): Promise<string | null>;
  getRoomAgents(roomId: string): Promise<Agent[]>;
  setAgentRole(roomId: string, name: string, role: string): Promise<void>;

  // Messages
  addMessage(msg: RoomMessage): Promise<void>;
  getRoomMessages(roomId: string, limit?: number, offset?: number): Promise<{ messages: RoomMessage[]; total: number }>;
  getLatestMessageId(roomId: string): Promise<string | null>;
  getMessagesSince(roomId: string, afterMessageId: string): Promise<RoomMessage[]>;
}
