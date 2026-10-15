import { badRequest, readJsonObject } from "@/lib/api.ts";
import { MAX_POST_LENGTH } from "@/lib/linkedin.ts";
import { OllamaError } from "@/lib/ollama.ts";
import { isRewriteAction, streamRewrite } from "@/lib/rewrite.ts";

export const runtime = "nodejs";

// Body: { text, action } with action shorter, hook, personal or grammar. Streams the rewritten post as plain text.
// Ollama errors before the first chunk come back as JSON with a 503, like /api/generate.
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return badRequest("Write the post first.");
  if (text.length > MAX_POST_LENGTH * 2) return badRequest("The text is too long.");
  if (!isRewriteAction(body?.action)) return badRequest(`"action" must be shorter, hook, personal or grammar.`);

  const chunks = streamRewrite(text, body.action, request.signal);
  let first: IteratorResult<string>;
  try {
    first = await chunks.next();
  } catch (error) {
    const code = error instanceof OllamaError ? error.code : "generation_failed";
    return Response.json({ error: (error as Error).message, code }, { status: 503 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (!first.done) controller.enqueue(encoder.encode(first.value));
    },
    async pull(controller) {
      try {
        const next = await chunks.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" } });
}
