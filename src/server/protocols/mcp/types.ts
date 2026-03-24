import type { z } from "zod";
import type { MethodResult } from "../../registry.js";

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

// MCP adapter for method registry
export interface McpAdapter {
  toolName: string;
  description?: string;
  params?: z.ZodType;
  annotations?: ToolAnnotations;
  inject?: (session: Record<string, unknown>) => Record<string, unknown>;
  requiresJoin?: boolean;
  afterMcp?: (
    result: MethodResult,
    session: Record<string, unknown>,
    addCleanup: (fn: () => void) => void,
  ) => Promise<void>;
}
