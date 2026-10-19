import { readJsonObject } from "@/lib/api.ts";
import { readAutopilot, runAutopilot, saveAutopilot, setNextTopic, validateSettings } from "@/lib/autopilot.ts";
import { getStatus } from "@/lib/linkedin.ts";
import { startScheduler } from "@/lib/scheduler.ts";

export const runtime = "nodejs";

export async function GET() {
  // Normally started by instrumentation.ts; this covers a dev server that was running before it existed.
  startScheduler();
  return Response.json(readAutopilot());
}

export async function PUT(request: Request) {
  const body = await readJsonObject(request);
  const settings = validateSettings(body);
  if (typeof settings === "string") return Response.json({ error: settings }, { status: 400 });
  if (settings.enabled && settings.mode === "auto") {
    const status = await getStatus();
    if (!status.connected || status.expired || !status.canPost) {
      return Response.json(
        { error: "To post automatically, connect LinkedIn and enable posting on the Profile page first." },
        { status: 400 },
      );
    }
  }
  return Response.json(saveAutopilot(settings));
}

// Writes one post now with the saved settings. It's always saved as a draft, never posted.
export async function POST() {
  const { settings } = readAutopilot();
  if (settings.topics.length === 0) return Response.json({ error: "Add at least one topic first." }, { status: 400 });
  const { post, result } = await runAutopilot(settings, "manual");
  return Response.json({ post, result, ...readAutopilot() }, { status: post ? 201 : 503 });
}

// Moves the queue: { nextTopic: <index> } makes that topic the next one written.
export async function PATCH(request: Request) {
  const body = await readJsonObject(request);
  const result = setNextTopic(body?.nextTopic);
  if (typeof result === "string") return Response.json({ error: result }, { status: 400 });
  return Response.json(result);
}
