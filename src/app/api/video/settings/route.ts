import { readJsonObject } from "@/lib/api.ts";
import { saveVideoDefaults, videoDefaults } from "@/lib/video-jobs.ts";
import { listMusic } from "@/lib/video-music.ts";
import { normalizeVideoSettings } from "@/lib/video-settings.ts";

export const runtime = "nodejs";

// Your defaults for new videos, and the music tracks in each mood folder.
export async function GET() {
  return Response.json({ defaults: videoDefaults(), music: await listMusic() });
}

// { settings }: saves them as the defaults for new videos (and for Make video / Make next on the topic ideas).
export async function PUT(request: Request) {
  const body = await readJsonObject(request);
  const settings = normalizeVideoSettings(body?.settings, videoDefaults());
  saveVideoDefaults(settings);
  return Response.json({ defaults: settings });
}
