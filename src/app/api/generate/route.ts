import { generateLinkedInPost } from "@/lib/post.ts";
import type { PostInput } from "@/lib/prompts.ts";

export const runtime = "nodejs";

const FIELDS = ["topic", "experience", "audience", "tone", "length"];
const LENGTHS = ["short", "medium", "long"];

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be valid JSON.");
  }

  const result = parseInput(body);
  if (typeof result === "string") return badRequest(result);

  try {
    const post = await generateLinkedInPost(result);
    return Response.json({ post });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 503 });
  }
}

// Returns the cleaned input, or an error message naming the bad field.
function parseInput(body: unknown): PostInput | string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "Request body must be a JSON object.";
  }
  const data = body as Record<string, unknown>;

  const unknown = Object.keys(data).find((key) => !FIELDS.includes(key));
  if (unknown) return `Unknown field "${unknown}".`;

  for (const field of FIELDS) {
    if (data[field] !== undefined && typeof data[field] !== "string") {
      return `"${field}" must be a string.`;
    }
  }

  const value = (field: string) => (data[field] as string | undefined)?.trim() || undefined;

  const topic = value("topic");
  if (!topic) return `"topic" is required.`;

  const length = value("length");
  if (length && !LENGTHS.includes(length)) {
    return `"length" must be one of: ${LENGTHS.join(", ")}.`;
  }

  return {
    topic,
    experience: value("experience"),
    audience: value("audience"),
    tone: value("tone"),
    length: length as PostInput["length"],
  };
}

function badRequest(error: string) {
  return Response.json({ error }, { status: 400 });
}
