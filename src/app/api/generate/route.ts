import {
  currentGeneration,
  findGeneration,
  followGeneration,
  snapshot,
  startGeneration,
  stopGeneration,
} from "@/lib/generation.ts";
import type { PostInput } from "@/lib/prompts.ts";

export const runtime = "nodejs";

const FIELDS = ["topic", "experience", "audience", "tone", "length"];
const LENGTHS = ["short", "medium", "long"];

const STREAM_HEADERS = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" };

// Starts a generation on the server and streams its text. The generation keeps going if the page goes away;
// its id is in the X-Generation-Id header so the page can reconnect with GET ?follow=<id>.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be valid JSON.");
  }

  const result = parseInput(body);
  if (typeof result === "string") return badRequest(result);

  // Wait for the first chunk so Ollama errors still come back as JSON with a 503.
  const job = startGeneration(result);
  await job.started;
  const state = snapshot(job);
  if (state.status === "failed" && !state.text) {
    return Response.json({ error: state.error, code: state.code, model: state.model }, { status: 503 });
  }

  return new Response(followGeneration(job), { headers: { ...STREAM_HEADERS, "X-Generation-Id": job.id } });
}

// Without parameters: the latest generation as JSON ({ generation: null } if none yet).
// With ?follow=<id>: that generation's text so far and then live, if it's still the current one.
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("follow");
  if (id === null) return Response.json({ generation: currentGeneration() });

  const job = findGeneration(id);
  if (!job) return Response.json({ error: "That generation is no longer available." }, { status: 404 });
  return new Response(followGeneration(job), { headers: STREAM_HEADERS });
}

// Stops the running generation, keeping what it wrote so far.
export async function DELETE() {
  stopGeneration();
  return Response.json({ generation: currentGeneration() });
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
  return Response.json({ error, code: "invalid_input" }, { status: 400 });
}
