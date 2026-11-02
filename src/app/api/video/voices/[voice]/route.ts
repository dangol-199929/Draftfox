import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { badRequest } from "@/lib/api.ts";

export const runtime = "nodejs";

// The voice samples made by DraftfoxHub/voice-samples/make_samples.py (one sentence at speed 0.9 and 1.0).
const SAMPLES = process.env.VIDEO_VOICE_SAMPLES?.trim() || join(process.cwd(), "..", "DraftfoxHub", "voice-samples");

// ?speed=: the sample of that voice nearest the speed, as WAV.
export async function GET(request: Request, { params }: { params: Promise<{ voice: string }> }) {
  const { voice } = await params;
  if (!/^[a-z]{2}_[a-z]+$/.test(voice)) return badRequest("Unknown voice.");
  const speed = Number(new URL(request.url).searchParams.get("speed"));
  const file = `${voice}_${speed >= 0.95 ? "1.0" : "0.9"}.wav`;
  try {
    const data = await readFile(join(SAMPLES, file));
    return new Response(new Uint8Array(data), { headers: { "Content-Type": "audio/wav", "Cache-Control": "max-age=3600" } });
  } catch {
    return badRequest("There's no sample of that voice yet.", 404);
  }
}
