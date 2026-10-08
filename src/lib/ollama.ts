export const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:12b";

// Ollama's default context (4096 tokens) silently cuts long prompts, such as ones with profile examples.
const OPTIONS = { num_ctx: 8192 };

type ChatResponse = {
  message: { role: string; content: string };
};

export async function generateText(
  prompt: string,
  system?: string,
): Promise<string> {
  const messages = system
    ? [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ]
    : [{ role: "user", content: prompt }];

  let response: Response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: false,
        think: false,
        options: OPTIONS,
      }),
    });
  } catch {
    throw new Error(
      `Could not reach Ollama at ${OLLAMA_URL}. Is it running? Open the Ollama app or run: ollama serve`,
    );
  }

  if (response.status === 404) {
    throw new Error(
      `Model "${OLLAMA_MODEL}" is not downloaded. Run: ollama pull ${OLLAMA_MODEL}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Ollama returned ${response.status}: ${await response.text()}`,
    );
  }

  const data = (await response.json()) as ChatResponse;
  return data.message.content.trim();
}

export type OllamaErrorCode = "ollama_unreachable" | "model_missing" | "generation_failed";

// An Error with a code, so callers can show a specific fix instead of parsing the message.
export class OllamaError extends Error {
  code: OllamaErrorCode;

  constructor(code: OllamaErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

type ChatChunk = {
  message?: { content: string };
  error?: string;
};

// Same request as generateText, but yields the reply in chunks as Ollama writes it.
export async function* streamText(
  prompt: string,
  system?: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const messages = system
    ? [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ]
    : [{ role: "user", content: prompt }];

  let response: Response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: true,
        think: false,
        options: OPTIONS,
      }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new OllamaError(
      "ollama_unreachable",
      `Could not reach Ollama at ${OLLAMA_URL}. Is it running? Open the Ollama app or run: ollama serve`,
    );
  }

  if (response.status === 404) {
    throw new OllamaError(
      "model_missing",
      `Model "${OLLAMA_MODEL}" is not downloaded. Run: ollama pull ${OLLAMA_MODEL}`,
    );
  }
  if (!response.ok || !response.body) {
    throw new OllamaError(
      "generation_failed",
      `Ollama returned ${response.status}: ${await response.text()}`,
    );
  }

  // The body is NDJSON: one JSON object per line, possibly split across reads.
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const bytes of response.body) {
    buffer += decoder.decode(bytes, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const chunk = JSON.parse(line) as ChatChunk;
      if (chunk.error) throw new OllamaError("generation_failed", `Ollama error: ${chunk.error}`);
      if (chunk.message?.content) yield chunk.message.content;
    }
  }
}
