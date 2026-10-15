// Server-only: quick rewrites of a post (shorter, punchier hook, more personal, fixed grammar) with the text model.
import { streamText } from "./ollama.ts";

export const REWRITES = {
  shorter: "Make this post noticeably shorter (about two thirds of its length). Keep the main point and the voice.",
  hook: "Rewrite only the opening line or two so they make people want to read on. Leave the rest as it is.",
  personal:
    "Make this post sound more personal and first-person, as if the author is telling a colleague. Don't add any facts, events or numbers that aren't already in the post.",
  grammar: "Fix spelling, grammar and punctuation only. Don't change the wording, tone or line breaks otherwise.",
} as const;

export type RewriteAction = keyof typeof REWRITES;

export function isRewriteAction(value: unknown): value is RewriteAction {
  return typeof value === "string" && value in REWRITES;
}

const SYSTEM = `You edit LinkedIn posts. Follow the instruction exactly.
Never invent facts, names, numbers, events or opinions that aren't in the post.
Keep emojis, hashtags and line breaks unless the instruction says otherwise.
Reply with the edited post only: no title, no quotes, no explanation.`;

export async function* streamRewrite(text: string, action: RewriteAction, signal?: AbortSignal): AsyncGenerator<string> {
  yield* streamText(`${REWRITES[action]}\n\nPost:\n${text}`, SYSTEM, signal);
}
