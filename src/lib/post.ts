import { generateText, streamText } from "./ollama.ts";
import { SYSTEM_PROMPT, buildPostPrompt, type PostInput } from "./prompts.ts";

export async function generateLinkedInPost(input: PostInput): Promise<string> {
  return generateText(buildPostPrompt(input), SYSTEM_PROMPT);
}

export function streamLinkedInPost(input: PostInput, signal?: AbortSignal): AsyncGenerator<string> {
  return streamText(buildPostPrompt(input), SYSTEM_PROMPT, signal);
}
