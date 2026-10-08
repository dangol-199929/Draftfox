import { generateText, streamText } from "./ollama.ts";
import { buildPostContext, readProfile } from "./profile.ts";
import { buildPostPrompt, type PostInput } from "./prompts.ts";
import { getSystemPrompt } from "./settings.ts";

async function buildPrompt(input: PostInput): Promise<string> {
  return buildPostPrompt(input, buildPostContext(await readProfile()));
}

export async function generateLinkedInPost(input: PostInput): Promise<string> {
  return generateText(await buildPrompt(input), await getSystemPrompt());
}

export async function* streamLinkedInPost(input: PostInput, signal?: AbortSignal): AsyncGenerator<string> {
  yield* streamText(await buildPrompt(input), await getSystemPrompt(), signal);
}
