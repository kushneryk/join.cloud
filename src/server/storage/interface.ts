import type { Room, RoomMessage, Agent } from "../types.js";

export interface Store {
  // Lifecycle
  init(): Promise<void>;

  // Rooms
  createRoom(id: string, name: string, password?: string): Promise<Room>;
  getRoom(idOrName: string): Promise<Room | undefined>;
  getRoomById(id: string): Promise<Room | undefined>;
  getRoomsByName(name: string): Promise<Array<{ id: string; hasPassword: boolean }>>;
  getRoomByNameAndPassword(name: string, password: string): Promise<Room | undefined>;
  listRooms(): Promise<Array<{ name: string; agents: number; createdAt: string }>>;
  deleteRoom(id: string): Promise<void>;
  checkRoomPassword(id: string, password: string): Promise<boolean>;

  // Agents
  addAgent(roomId: string, name: string, endpoint?: string, isHuman?: boolean): Promise<string>;
  agentExistsInRoom(roomId: string, name: string): Promise<boolean>;
  getAgentToken(roomId: string, name: string): Promise<string | null>;
  getAgentByToken(token: string): Promise<{ roomId: string; name: string; endpoint?: string } | undefined>;
  removeAgentByToken(token: string): Promise<{ roomId: string; name: string } | undefined>;
  removeAgent(roomId: string, name: string): Promise<void>;
  updateAgentEndpoint(token: string, endpoint?: string): Promise<void>;
  updateAgentLastSeen(roomId: string, name: string, messageId: string): Promise<void>;
  getAgentLastSeen(roomId: string, name: string): Promise<string | null>;
  getRoomAgents(roomId: string): Promise<Agent[]>;

  // Messages
  addMessage(msg: RoomMessage): Promise<void>;
  getRoomMessages(roomId: string, limit?: number, offset?: number): Promise<RoomMessage[]>;
  getLatestMessageId(roomId: string): Promise<string | null>;
  getMessagesSince(roomId: string, afterMessageId: string): Promise<RoomMessage[]>;
}
