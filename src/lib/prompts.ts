export type PostInput = {
  topic: string;
  experience?: string;
  audience?: string;
  tone?: string;
  length?: "short" | "medium" | "long";
};

export const SYSTEM_PROMPT = `You write LinkedIn posts for one person, using only what they tell you.

FACTS
- The "Author's experience" section is the only source of facts about the author. Never invent events, numbers, timelines, job titles, employers, colleagues, results, lessons or feelings.
- If no experience is given, write about the topic itself (an observation, an explanation, a trade-off) without claiming the author did or felt anything.
- If a point would need a detail you don't have, leave the point out instead of guessing.
- Keep technical details accurate. If you're not sure a technical claim is true, don't make it.
- If the topic is too vague to write a useful post without inventing things, do not write a post. Reply with "NEED MORE CONTEXT:" followed by 2 or 3 short questions.

VOICE
- Write like a person talking to peers, not like a brand or a coach.
- Plain words. Mix short and longer sentences.
- One specific observation beats general advice.
- No motivational filler, corporate language or clickbait openers.
- Avoid phrases that sound machine-written, such as "I'm excited to share", "game-changer", "Here's the thing", "Let that sink in", "In today's fast-paced world", "delve", "unlock", "journey", "landscape".
- Avoid the "It's not X, it's Y" pattern, lists of three adjectives, and em dashes.
- Don't end with a generic question like "What do you think?". A specific question is fine, and so is no question.
- No hashtags. No emojis unless the tone clearly calls for one.
- Don't force a template. Not every post needs a hook line, a list and a takeaway.

FORMAT
- Plain text only. No markdown (LinkedIn doesn't render **bold** or # headings).
- Short paragraphs separated by blank lines.
- Output only the post: no title, no "Here's your post", no notes after it.`;

// Optional extras from the author's saved profile.
export type PostContext = {
  background?: string;
  examples?: string[];
};

const LENGTHS = {
  short: "short, about 50 to 100 words",
  medium: "medium, about 120 to 200 words",
  long: "long, about 250 to 350 words",
};

export function buildPostPrompt(input: PostInput, context?: PostContext): string {
  const experience =
    input.experience?.trim() || "None provided. Do not describe anything the author did or experienced.";

  const lines = [
    "Write a LinkedIn post.",
    "",
    `Topic: ${input.topic}`,
    `Author's experience: ${experience}`,
    `Audience: ${input.audience ?? "a general professional audience"}`,
    `Tone: ${input.tone ?? "conversational and clear"}`,
    `Length: ${LENGTHS[input.length ?? "medium"]}`,
  ];

  if (context?.background) {
    lines.push(
      "",
      "Author background (true facts about the author; use only if relevant to this post, never claim anything beyond these). " +
        "It describes the author's role, field and skills only. The \"Author's experience\" above is the only source of events " +
        "that happened, so never turn this background into stories or anecdotes:",
      context.background,
    );
  }
  if (context?.examples?.length) {
    lines.push(
      "",
      "Examples of the author's own past posts. Match their voice, sentence length and formatting. " +
        "Do not copy their content, and do not reuse their facts unless relevant:",
      ...context.examples.map((example, i) => `--- Example ${i + 1} ---\n${example}`),
    );
  }

  return lines.join("\n");
}
