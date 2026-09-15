import { GenerateEventSchema, type GenerateEvent } from "@/lib/contracts/generate";

// TRD.md §8: POST /api/generate streams one JSON object per line. The response body is our
// own server's output, but it's still a network boundary — parsed and validated with the same
// Zod schema the server built it from, not trusted as-is.
export async function readNdjsonEvents(response: Response, onEvent: (event: GenerateEvent) => void, signal?: AbortSignal): Promise<void> {
  if (!response.body) throw new Error("Response has no body to stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consume = (line: string) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    onEvent(GenerateEventSchema.parse(JSON.parse(trimmed)));
  };

  try {
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        consume(buffer.slice(0, newlineIndex));
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");
      }
    }
    consume(buffer);
  } finally {
    reader.releaseLock();
  }
}
