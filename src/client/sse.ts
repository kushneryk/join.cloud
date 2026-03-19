import type { Message } from "./types.js";

export function connectSSE(
  url: string,
  onMessage: (msg: Message) => void,
  onError?: (err: Error) => void,
  onConnect?: () => void,
): () => void {
  let aborted = false;
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(url, {
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        onError?.(new Error(`SSE connection failed: ${res.status}`));
        return;
      }
      onConnect?.();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            const data = line.slice(5).trim();
            if (currentEvent === "ping" || !data) {
              currentEvent = "";
              continue;
            }
            try {
              const msg = JSON.parse(data) as Message;
              onMessage(msg);
            } catch {
              // ignore non-JSON data
            }
            currentEvent = "";
          } else if (line === "") {
            currentEvent = "";
          }
        }
      }
    } catch (err) {
      if (!aborted) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();

  return () => {
    aborted = true;
    controller.abort();
  };
}
