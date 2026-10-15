import { readJsonObject, badRequest } from "@/lib/api.ts";
import { readSetting, writeSetting } from "@/lib/db.ts";
import { parseJobSettings } from "@/lib/job-status.ts";

export const runtime = "nodejs";

const KEY = "jobSettings";

export async function GET() {
  return Response.json({ settings: parseJobSettings(readSetting(KEY)) });
}

// Body: any of { autoLetter: boolean, prepareMakes: "letter" | "letter-cv" | "everything" }.
export async function PUT(request: Request) {
  const body = await readJsonObject(request);
  if (!body) return badRequest("Request body must be a JSON object.");
  const settings = parseJobSettings({ ...parseJobSettings(readSetting(KEY)), ...body });
  writeSetting(KEY, settings);
  return Response.json({ settings });
}
