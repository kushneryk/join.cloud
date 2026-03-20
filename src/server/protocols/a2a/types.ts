// A2A protocol types — based on a2a-protocol.org/latest/specification/

export interface A2APart {
  text?: string;
  mimeType?: string;
  uri?: string;
  data?: unknown;
}

export interface A2AMessage {
  role: "user" | "agent";
  parts: A2APart[];
  contextId?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
}

export interface A2ATaskStatus {
  state:
    | "submitted"
    | "working"
    | "completed"
    | "failed"
    | "canceled"
    | "rejected"
    | "input-required";
  timestamp: string;
  message?: A2AMessage;
}

export interface A2AArtifact {
  id: string;
  mimeType?: string;
  parts: A2APart[];
}

export interface A2ATask {
  id: string;
  contextId: string;
  status: A2ATaskStatus;
  messages?: A2AMessage[];
  artifacts?: A2AArtifact[];
}

export interface A2AAgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  documentationUrl?: string;
  provider?: { name: string; url?: string };
  capabilities?: {
    streaming: boolean;
    pushNotifications: boolean;
  };
  skills: Array<{
    id: string;
    name: string;
    description: string;
  }>;
  extensions?: Array<{
    uri: string;
    description: string;
    required: boolean;
    params?: Record<string, unknown>;
  }>;
}

// JSON-RPC types

export interface JsonRpcRequest<P = unknown> {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params: P;
}

export interface JsonRpcSuccess<R = unknown> {
  jsonrpc: "2.0";
  id: string | number;
  result: R;
}

export interface JsonRpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse<R = unknown> = JsonRpcSuccess<R> | JsonRpcError;

export interface SendMessageParams {
  message: A2AMessage;
  configuration?: {
    acceptedOutputModes?: string[];
    returnImmediately?: boolean;
  };
  metadata?: Record<string, unknown>;
}

export interface GetTaskParams {
  taskId: string;
}

// A2A adapter for method registry
export interface A2aAdapter {
  mapParams?: (msg: {
    text: string;
    contextId?: string;
    metadata?: Record<string, unknown>;
  }) => Record<string, unknown>;
}
