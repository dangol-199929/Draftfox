import { acquireGpu, withGpu } from "./gpu-lock.ts";

export const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:12b";

// Ollama's default context (4096 tokens) silently cuts long prompts, such as ones with profile examples.
const OPTIONS = { num_ctx: 8192 };

// How long one request may take, including loading the model, before it's given up.
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 5 * 60 * 1000;

type ChatResponse = {
  message: { role: string; content: string };
};

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function unreachable(error: unknown): Error {
  if ((error as Error)?.name === "TimeoutError") {
    return new Error(`Ollama didn't answer within ${Math.round(TIMEOUT_MS / 60000)} minutes. Try again, or use a smaller model.`);
  }
  return new Error(`Could not reach Ollama at ${OLLAMA_URL}. Is it running? Open the Ollama app or run: ollama serve`);
}

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

  return withGpu("Ollama: writing", async () => {
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
        signal: requestSignal(),
      });
    } catch (error) {
      throw unreachable(error);
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

    let data: ChatResponse;
    try {
      data = (await response.json()) as ChatResponse;
    } catch (error) {
      throw unreachable(error);
    }
    return data.message.content.trim();
  });
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

  let release: () => void;
  try {
    release = await acquireGpu("Ollama: writing", { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new OllamaError("generation_failed", (error as Error).message);
  }
  try {
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
        signal: requestSignal(signal),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new OllamaError("ollama_unreachable", unreachable(error).message);
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
    try {
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
    } catch (error) {
      if (signal?.aborted || error instanceof OllamaError) throw error;
      throw new OllamaError("generation_failed", unreachable(error).message);
    }
  } finally {
    release();
  }
}

export type JsonOptions = {
  // A model other than OLLAMA_MODEL, such as the Video Studio's script model.
  model?: string;
  // How long Ollama keeps the model loaded afterwards (Ollama's keep_alive), such as "0" to unload at once.
  keepAlive?: string | number;
  temperature?: number;
  signal?: AbortSignal;
};

// Asks for a reply that matches a JSON schema (Ollama's structured outputs) and returns it parsed.
export async function generateJson<T>(prompt: string, system: string, schema: object, options: JsonOptions = {}): Promise<T> {
  const model = options.model ?? OLLAMA_MODEL;
  return withGpu(
    `Ollama: ${model}`,
    async () => {
      let response: Response;
      try {
        response = await fetch(`${OLLAMA_URL}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: prompt },
            ],
            format: schema,
            stream: false,
            think: false,
            options: options.temperature === undefined ? OPTIONS : { ...OPTIONS, temperature: options.temperature },
            ...(options.keepAlive !== undefined && { keep_alive: options.keepAlive }),
          }),
          signal: requestSignal(options.signal),
        });
      } catch (error) {
        throw unreachable(error);
      }
      if (response.status === 404) throw new Error(`Model "${model}" is not downloaded. Run: ollama pull ${model}`);
      if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${await response.text()}`);
      let data: ChatResponse;
      try {
        data = (await response.json()) as ChatResponse;
      } catch (error) {
        throw unreachable(error);
      }
      try {
        return JSON.parse(data.message.content) as T;
      } catch {
        throw new Error("The model's reply wasn't valid JSON. Try again.");
      }
    },
    { signal: options.signal },
  );
}
