import { rm } from "node:fs/promises";
import { badRequest, readJsonObject } from "@/lib/api.ts";
import { listPublications } from "@/lib/video-publications.ts";
import {
  deleteVideoJob,
  getVideoJob,
  jobDir,
  listVideoEvents,
  redoVideoStages,
  setVideoStatus,
  updateVideoJob,
  type CaptionGroup,
  type VideoJob,
  type VideoScript,
} from "@/lib/video-jobs.ts";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const RUNNING = ["GENERATING_SCRIPT", "GENERATING_VISUALS", "GENERATING_AUDIO", "RENDERING", "QUALITY_CHECK"];

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const job = getVideoJob(id);
  if (!job) return badRequest("No such video.", 404);
  return Response.json({ job, events: listVideoEvents(id), publications: listPublications(id) });
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

// Your edits to the script: title, narration, scene captions and image prompts, post caption, hashtags.
function editedScript(job: VideoJob, input: Record<string, unknown>): VideoScript | string {
  if (!job.script) return "This video has no script yet.";
  const scenes = Array.isArray(input.scenes) ? input.scenes : [];
  if (scenes.length !== job.scenes.length) return "Keep the same number of scenes.";
  const script: VideoScript = {
    ...job.script,
    title: text(input.title, 100) || job.script.title,
    narration: text(input.narration, 1000) || job.script.narration,
    post_caption: text(input.post_caption, 2000),
    hashtags: Array.isArray(input.hashtags)
      ? input.hashtags.map((tag) => text(tag, 60)).filter(Boolean).slice(0, 10)
      : job.script.hashtags,
    scenes: job.scenes.map((scene, index) => {
      const edit = (scenes[index] ?? {}) as Record<string, unknown>;
      return {
        ...scene,
        image_prompt: text(edit.image_prompt, 1000) || scene.image_prompt,
        on_screen_text: text(edit.on_screen_text, 100),
      };
    }),
  };
  return script;
}

// Body: { action } with
// - approve | reject | cancel | retry
// - edit: { script?: {...}, captions?: [{ text }] } saves your changes (captions keep their timings)
// - redo: { what: "scene" (with scene: index) | "narration" | "render" | "script" } makes that part again, keeping the rest
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const job = getVideoJob(id);
  if (!job) return badRequest("No such video.", 404);
  const body = await readJsonObject(request);
  const action = body?.action;

  if (action === "approve" || action === "reject") {
    if (!["AWAITING_APPROVAL", "APPROVED", "REJECTED"].includes(job.status)) {
      return badRequest("Only a finished video can be approved or rejected.", 409);
    }
    setVideoStatus(id, action === "approve" ? "APPROVED" : "REJECTED");
  } else if (action === "cancel") {
    if (["APPROVED", "REJECTED", "CANCELLED"].includes(job.status)) return badRequest("This video is already done.", 409);
    setVideoStatus(id, "CANCELLED");
  } else if (action === "retry") {
    if (!["FAILED", "CANCELLED", "REJECTED"].includes(job.status)) return badRequest("Only a failed, cancelled or rejected video can be retried.", 409);
    redoVideoStages(id, [job.stage ?? "script"], null, "Retrying");
  } else if (action === "edit") {
    if (RUNNING.includes(job.status)) return badRequest("Wait for the worker to finish this step, or cancel it first.", 409);
    let script = job.script;
    if (body?.script && typeof body.script === "object") {
      const edited = editedScript(job, body.script as Record<string, unknown>);
      if (typeof edited === "string") return badRequest(edited);
      script = edited;
    }
    let assets = job.assets;
    if (Array.isArray(body?.captions)) {
      const groups = (job.assets.caption_groups as CaptionGroup[] | undefined) ?? [];
      if (body.captions.length !== groups.length) return badRequest("Keep the same number of captions.");
      const edited = groups.map((group, index) => ({
        ...group,
        text: text((body.captions as Record<string, unknown>[])[index]?.text, 80) || group.text,
      }));
      assets = { ...assets, caption_groups: edited };
    }
    updateVideoJob(id, { script: script ?? undefined, scenes: script?.scenes, assets });
  } else if (action === "redo") {
    if (RUNNING.includes(job.status)) return badRequest("Wait for the worker to finish this step, or cancel it first.", 409);
    const what = body?.what;
    if (what === "scene") {
      const scene = Number(body?.scene);
      if (!Number.isInteger(scene) || scene < 0 || scene >= job.scenes.length) return badRequest("Pick a scene.");
      redoVideoStages(id, ["visuals"], { scenes: [scene] }, `Drawing scene ${scene + 1} again`);
    } else if (what === "narration") {
      redoVideoStages(id, ["audio"], null, "Speaking the narration again");
    } else if (what === "render") {
      redoVideoStages(id, ["render"], null, "Rendering again");
    } else if (what === "script") {
      redoVideoStages(id, ["script"], null, "Starting over with a new script");
    } else {
      return badRequest(`"what" must be scene, narration, render or script.`);
    }
  } else {
    return badRequest("Unknown action.");
  }
  return Response.json({ job: getVideoJob(id) });
}

// Deletes the video and its files. A video the worker is making is cancelled first.
export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  if (!getVideoJob(id)) return badRequest("No such video.", 404);
  deleteVideoJob(id);
  await rm(jobDir(id), { recursive: true, force: true });
  return Response.json({ ok: true });
}
