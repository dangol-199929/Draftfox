export const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:12b";

type ChatResponse = {
  message: { role: string; content: string };
};

export async function generateText(prompt: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        think: false,
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
