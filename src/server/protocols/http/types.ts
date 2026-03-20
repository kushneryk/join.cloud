export interface HttpAdapter {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  mapParams?: (req: {
    params: Record<string, string>;
    query: Record<string, string>;
    headers: Record<string, string>;
  }) => Record<string, unknown>;
  headers?: Record<string, string>;
}
