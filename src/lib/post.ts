import { generateText } from "./ollama.ts";
import { SYSTEM_PROMPT, buildPostPrompt, type PostInput } from "./prompts.ts";

export async function generateLinkedInPost(input: PostInput): Promise<string> {
  return generateText(buildPostPrompt(input), SYSTEM_PROMPT);
}
