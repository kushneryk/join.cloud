import type { z } from "zod";
import type { Store } from "./storage/interface.js";
import type { McpAdapter } from "./protocols/mcp/types.js";
import type { A2aAdapter } from "./protocols/a2a/types.js";
import type { HttpAdapter } from "./protocols/http/types.js";

// --- Core types ---

export interface MethodResult {
  text: string;
  contextId?: string;
  data?: Record<string, unknown>;
}

export interface MethodContext {
  store: Store;
  method: string;
  roomId?: string;
  protocol: "a2a" | "mcp" | "http" | "internal";
  protocolMeta: Record<string, unknown>;
}

export interface MethodDeclaration {
  description: string;
  params: z.ZodType;
  returns?: z.ZodType;
  handler: (params: any, ctx: MethodContext) => Promise<MethodResult>;
}

// --- Before/After processor types ---

export type BeforeProcessor = (
  params: any,
  ctx: MethodContext,
) => Promise<any>;

export type AfterProcessor = (
  result: MethodResult,
  params: any,
  ctx: MethodContext,
) => Promise<MethodResult>;

// --- Registry ---

export class MethodRegistry {
  private methods = new Map<string, MethodDeclaration>();
  private befores = new Map<string, BeforeProcessor[]>();
  private afters = new Map<string, AfterProcessor[]>();
  private mcpAdapters = new Map<string, McpAdapter>();
  private a2aAdapters = new Map<string, A2aAdapter>();
  private httpAdapters = new Map<string, HttpAdapter>();

  method(name: string, declaration: MethodDeclaration): void {
    this.methods.set(name, declaration);
  }

  before(name: string, processor: BeforeProcessor): void {
    if (!this.befores.has(name)) this.befores.set(name, []);
    this.befores.get(name)!.push(processor);
  }

  after(name: string, processor: AfterProcessor): void {
    if (!this.afters.has(name)) this.afters.set(name, []);
    this.afters.get(name)!.push(processor);
  }

  mcp(name: string, adapter: McpAdapter): void {
    this.mcpAdapters.set(name, adapter);
  }

  a2a(name: string, adapter: A2aAdapter): void {
    this.a2aAdapters.set(name, adapter);
  }

  http(name: string, adapter: HttpAdapter): void {
    this.httpAdapters.set(name, adapter);
  }

  async call(name: string, rawParams: unknown, ctx: MethodContext): Promise<MethodResult> {
    const decl = this.methods.get(name);
    if (!decl) throw new Error(`Unknown method: ${name}`);

    // Validate params
    const parseResult = decl.params.safeParse(rawParams);
    if (!parseResult.success) {
      const issues = parseResult.error.issues ?? [];
      const missing = issues
        .filter((i: any) => i.code === "invalid_type" && (i.received === undefined || i.received === "undefined"))
        .map((i: any) => i.path?.join(".") ?? "unknown");
      if (missing.length > 0) {
        throw new Error(`${missing.join(", ")} required`);
      }
      throw new Error(parseResult.error.message);
    }
    let params = parseResult.data;

    // Run before processors: wildcard + method-specific
    const wildcardBefores = this.befores.get("*") ?? [];
    const methodBefores = this.befores.get(name) ?? [];
    for (const processor of [...wildcardBefores, ...methodBefores]) {
      params = await processor(params, ctx);
    }

    // Run handler
    let result = await decl.handler(params, ctx);

    // Run after processors: wildcard + method-specific
    const wildcardAfters = this.afters.get("*") ?? [];
    const methodAfters = this.afters.get(name) ?? [];
    for (const processor of [...wildcardAfters, ...methodAfters]) {
      result = await processor(result, params, ctx);
    }

    return result;
  }

  getMethod(name: string): MethodDeclaration | undefined {
    return this.methods.get(name);
  }

  listMethods(): Map<string, MethodDeclaration> {
    return new Map(this.methods);
  }

  getMcpAdapter(name: string): McpAdapter | undefined {
    return this.mcpAdapters.get(name);
  }

  getA2aAdapter(name: string): A2aAdapter | undefined {
    return this.a2aAdapters.get(name);
  }

  getHttpAdapter(name: string): HttpAdapter | undefined {
    return this.httpAdapters.get(name);
  }

  listMcpAdapters(): Map<string, McpAdapter> {
    return new Map(this.mcpAdapters);
  }

  hasMethod(name: string): boolean {
    return this.methods.has(name);
  }
}
