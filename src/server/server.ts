import { Hono } from "hono";
import { MethodRegistry } from "./registry.js";
import type { Store } from "./storage/interface.js";
import type { MethodDeclaration, MethodResult, MethodContext, BeforeProcessor, AfterProcessor } from "./registry.js";
import type { McpAdapter } from "./protocols/mcp/types.js";
import type { A2aAdapter } from "./protocols/a2a/types.js";
import type { HttpAdapter } from "./protocols/http/types.js";

export interface JoinCloudServerOptions {
  store?: Store;
}

export class JoinCloudServer {
  readonly registry: MethodRegistry;
  readonly app: Hono;
  store!: Store;

  constructor(options?: JoinCloudServerOptions) {
    this.registry = new MethodRegistry();
    this.app = new Hono();
    if (options?.store) {
      this.store = options.store;
    }
  }

  // --- Method registration (delegates to registry) ---

  method(name: string, declaration: MethodDeclaration): void {
    this.registry.method(name, declaration);
  }

  before(name: string, processor: BeforeProcessor): void {
    this.registry.before(name, processor);
  }

  after(name: string, processor: AfterProcessor): void {
    this.registry.after(name, processor);
  }

  // --- Protocol adapters ---

  mcp(name: string, adapter: McpAdapter): void {
    this.registry.mcp(name, adapter);
  }

  a2a(name: string, adapter: A2aAdapter): void {
    this.registry.a2a(name, adapter);
  }

  http(name: string, adapter: HttpAdapter): void {
    this.registry.http(name, adapter);
  }

  // --- Execution ---

  async call(
    methodName: string,
    params: unknown,
    options?: {
      roomId?: string;
      protocol?: MethodContext["protocol"];
      protocolMeta?: Record<string, unknown>;
    },
  ): Promise<MethodResult> {
    const ctx: MethodContext = {
      store: this.store,
      method: methodName,
      roomId: options?.roomId,
      protocol: options?.protocol ?? "internal",
      protocolMeta: options?.protocolMeta ?? {},
    };
    return this.registry.call(methodName, params, ctx);
  }
}
