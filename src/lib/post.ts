import { generateText, streamText } from "./ollama.ts";
import { buildPostPrompt, type PostInput } from "./prompts.ts";
import { getSystemPrompt } from "./settings.ts";

export async function generateLinkedInPost(input: PostInput): Promise<string> {
  return generateText(buildPostPrompt(input), await getSystemPrompt());
}

export async function* streamLinkedInPost(input: PostInput, signal?: AbortSignal): AsyncGenerator<string> {
  yield* streamText(buildPostPrompt(input), await getSystemPrompt(), signal);
}
