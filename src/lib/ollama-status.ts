import { OLLAMA_MODEL, OLLAMA_URL } from "./ollama.ts";

export type OllamaStatus = {
  // Ollama answered at OLLAMA_URL.
  reachable: boolean;
  // The model posts are written with (OLLAMA_MODEL, or the default).
  model: string;
  // Whether that model is downloaded; null when Ollama couldn't be reached.
  installed: boolean | null;
  // Every model Ollama has, for the settings page.
  models: { name: string; size: number; modifiedAt: string }[];
  url: string;
};

type TagsResponse = { models?: { name: string; model?: string; size?: number; modified_at?: string }[] };

// "gemma4" and "gemma4:latest" are the same model to Ollama.
function sameModel(a: string, b: string) {
  const withTag = (name: string) => (name.includes(":") ? name : `${name}:latest`);
  return withTag(a) === withTag(b);
}

// Asks the local Ollama which models it has. Quick to give up, so a stopped Ollama never slows a page.
export async function getOllamaStatus(timeoutMs = 1500): Promise<OllamaStatus> {
  const base = { model: OLLAMA_MODEL, url: OLLAMA_URL };
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!response.ok) return { ...base, reachable: false, installed: null, models: [] };
    const data = (await response.json()) as TagsResponse;
    const models = (data.models ?? []).map((model) => ({
      name: model.name ?? model.model ?? "",
      size: model.size ?? 0,
      modifiedAt: model.modified_at ?? "",
    }));
    return {
      ...base,
      reachable: true,
      installed: models.some((model) => sameModel(model.name, OLLAMA_MODEL)),
      models,
    };
  } catch {
    return { ...base, reachable: false, installed: null, models: [] };
  }
}
