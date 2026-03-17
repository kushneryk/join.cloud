// Join.cloud domain types

export interface Room {
  id: string;
  name: string;
  createdAt: string;
  agents: Map<string, Agent>;
}

export interface Agent {
  name: string;
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

export interface FileChange {
  path: string;
  content: string;
  action?: "create" | "modify" | "delete";
}

export interface VerifyOptions {
  requiredAgents?: string[];
  consensus?: {
    quorum: number;
    threshold: number;
  };
}

export interface RoomCommit {
  id: string;
  sha?: string;
  branch?: string;
  roomId: string;
  author: string;
  message: string;
  changes: FileChange[];
  verify?: VerifyOptions;
  status: "committed" | "pending" | "merged" | "rejected";
  reviews: CommitReview[];
  createdAt: string;
}

export interface CommitReview {
  commitId: string;
  reviewer: string;
  verdict: "approved" | "rejected" | "revision-requested";
  comment: string;
  createdAt: string;
}
