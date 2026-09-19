import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Provider adapters for the streaming chat endpoint. Each adapter takes a system prompt,
 * conversation history, and an AbortSignal, and yields plain text deltas as they arrive —
 * the route layer is responsible for turning those into SSE frames and accumulating the
 * full response. Errors are intentionally left to propagate to the caller.
 */

export interface StreamOptions {
  apiKey: string;
  model: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  signal?: AbortSignal;
}

export async function* streamAnthropic(opts: StreamOptions): AsyncGenerator<string> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const stream = client.messages.stream(
    {
      model: opts.model,
      max_tokens: 2048,
      system: opts.system,
      messages: opts.messages,
    },
    { signal: opts.signal },
  );
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}

export async function* streamOpenAI(opts: StreamOptions): AsyncGenerator<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: opts.signal,
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      stream: true,
      messages: [{ role: "system", content: opts.system }, ...opts.messages],
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI request failed (${res.status}): ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    // Keep the trailing partial event (if any) in the buffer for the next chunk.
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice("data: ".length).trim();
        if (data === "[DONE]") continue;
        // A malformed frame shouldn't kill an otherwise healthy stream.
        let json: { choices?: Array<{ delta?: { content?: string } }> };
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        const text = json.choices?.[0]?.delta?.content;
        if (typeof text === "string" && text.length > 0) {
          yield text;
        }
      }
    }
  }
}
