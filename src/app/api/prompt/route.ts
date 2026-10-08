import { SYSTEM_PROMPT } from "@/lib/prompts.ts";
import { getSystemPrompt, resetSystemPrompt, saveSystemPrompt } from "@/lib/settings.ts";

export const runtime = "nodejs";

const MAX_LENGTH = 20_000;

export async function GET() {
  return promptResponse();
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be valid JSON.");
  }

  const prompt = (body as { prompt?: unknown } | null)?.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    return badRequest(`"prompt" must be a non-empty string.`);
  }
  if (prompt.length > MAX_LENGTH) {
    return badRequest(`"prompt" must be at most ${MAX_LENGTH.toLocaleString("en")} characters.`);
  }

  try {
    // Saving the default text unchanged stores nothing, so the prompt stays "Default".
    if (prompt === SYSTEM_PROMPT) await resetSystemPrompt();
    else await saveSystemPrompt(prompt);
  } catch (error) {
    return serverError(error);
  }
  return promptResponse();
}

export async function DELETE() {
  try {
    await resetSystemPrompt();
  } catch (error) {
    return serverError(error);
  }
  return promptResponse();
}

async function promptResponse() {
  const prompt = await getSystemPrompt();
  return Response.json({ prompt, defaultPrompt: SYSTEM_PROMPT, isDefault: prompt === SYSTEM_PROMPT });
}

function badRequest(error: string) {
  return Response.json({ error }, { status: 400 });
}

function serverError(error: unknown) {
  console.error("Could not save the prompt:", error);
  return Response.json({ error: `Could not save the prompt: ${(error as Error).message}` }, { status: 500 });
}
