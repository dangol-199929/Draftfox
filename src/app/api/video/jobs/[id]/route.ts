import { rm } from "node:fs/promises";
import { badRequest, readJsonObject } from "@/lib/api.ts";
import { listPublications } from "@/lib/video-publications.ts";
import { syncTopicWithJob } from "@/lib/video-topics.ts";
import { normalizeVideoSettings, settingsRedo } from "@/lib/video-settings.ts";
import {
  continueVideoJob,
  deleteVideoJob,
  getVideoJob,
  jobDir,
  listVideoEvents,
  redoVideoStages,
  setVideoStatus,
  unapproveIfEdited,
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

// Your edits to the script: title, narration, each scene's narration, image prompt, motion prompt and caption, the
// post caption and hashtags. A scene field that isn't sent stays as it was. When a scene's narration changes, the
// narration the voice reads is those joined again.
function editedScript(job: VideoJob, input: Record<string, unknown>): VideoScript | string {
  if (!job.script) return "This video has no script yet.";
  const scenes = Array.isArray(input.scenes) ? input.scenes : [];
  if (scenes.length !== job.scenes.length) return "Keep the same number of scenes.";
  const field = (edit: Record<string, unknown>, name: string, max: number, fallback: string) =>
    typeof edit[name] === "string" ? text(edit[name], max) || fallback : fallback;
  const edited = job.scenes.map((scene, index) => {
    const edit = (scenes[index] ?? {}) as Record<string, unknown>;
    return {
      ...scene,
      narration: typeof edit.narration === "string" ? text(edit.narration, 600).replace(/\s+/g, " ") : scene.narration,
      image_prompt: field(edit, "image_prompt", 1000, scene.image_prompt),
      motion_prompt: typeof edit.motion_prompt === "string" ? text(edit.motion_prompt, 500) : scene.motion_prompt,
      on_screen_text: typeof edit.on_screen_text === "string" ? text(edit.on_screen_text, 100) : scene.on_screen_text,
    };
  });
  const scenesSpoken = edited.some((scene, index) => (scene.narration ?? "") !== (job.scenes[index].narration ?? ""));
  return {
    ...job.script,
    title: text(input.title, 100) || job.script.title,
    narration: scenesSpoken
      ? edited.map((scene) => scene.narration ?? "").filter(Boolean).join(" ")
      : text(input.narration, 1000) || job.script.narration,
    post_caption: typeof input.post_caption === "string" ? text(input.post_caption, 2000) : job.script.post_caption,
    hashtags: Array.isArray(input.hashtags)
      ? input.hashtags.map((tag) => text(tag, 60)).filter(Boolean).slice(0, 10)
      : job.script.hashtags,
    scenes: edited,
  };
}

// A scene picked by index, or an error.
function sceneIndex(job: VideoJob, value: unknown): number | null {
  const scene = Number(value);
  return Number.isInteger(scene) && scene >= 0 && scene < job.scenes.length ? scene : null;
}

// Clears a scene's "your own" flag so the worker makes that part again.
function forgetOwn(job: VideoJob, scene: number, field: "image_source" | "clip_source") {
  const scenes = job.scenes.map((item, index) => (index === scene ? { ...item, [field]: null } : item));
  updateVideoJob(job.id, { scenes, script: job.script ? { ...job.script, scenes } : undefined });
}

// Body: { action } with
// - approve | reject | cancel | retry
// - continue: goes on after the script, for a video set to stop there
// - settings: { settings, apply? } saves this video's settings; apply: true also makes again what they change
// - edit: { script?: {...}, captions?: [{ text }] } saves your changes (captions keep their timings)
// - redo: { what: "scene" | "clip" (with scene: index) | "narration" | "render" | "script" } makes that part again,
//   keeping the rest: a scene is drawn and animated again, a clip only animated again from its image
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
    syncTopicWithJob(id, action === "approve" ? "approved" : "rejected");
  } else if (action === "cancel") {
    if (["APPROVED", "REJECTED", "CANCELLED", "UPLOADING"].includes(job.status)) return badRequest("This video is already done.", 409);
    setVideoStatus(id, "CANCELLED");
  } else if (job.assets.source === "upload" && (action === "retry" || action === "redo" || action === "settings")) {
    return badRequest("This is a video you uploaded; there's nothing to make again.", 409);
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
    unapproveIfEdited(id);
  } else if (action === "continue") {
    if (job.status !== "SCRIPT_READY") return badRequest("This video isn't waiting for you.", 409);
    continueVideoJob(id);
  } else if (action === "settings") {
    if (RUNNING.includes(job.status)) return badRequest("Wait for the worker to finish this step, or cancel it first.", 409);
    const before = normalizeVideoSettings(job.assets.settings);
    const after = normalizeVideoSettings(body?.settings, before);
    updateVideoJob(id, { assets: { ...job.assets, settings: after, motion: after.motion } });
    // apply: true makes again what the change needs, earliest first (a new script is left to you: it replaces your edits).
    const redo = body?.apply === true ? settingsRedo(before, after) : null;
    const done = (stage: "visuals" | "audio" | "render") => job.completedStages.includes(stage);
    if (redo === "clips" && done("visuals")) {
      redoVideoStages(id, ["visuals"], { clips: job.scenes.map((_, index) => index) }, after.motion ? "Animating the scenes again" : "Using still scenes");
    } else if ((redo === "clips" || redo === "audio") && done("audio")) {
      redoVideoStages(id, ["audio"], null, "Recording the voice again with the new settings");
    } else if (redo && redo !== "script" && done("render")) {
      redoVideoStages(id, ["render"], null, "Rendering again with the new settings");
    } else {
      unapproveIfEdited(id);
    }
    return Response.json({ job: getVideoJob(id), redo });
  } else if (action === "redo") {
    if (RUNNING.includes(job.status)) return badRequest("Wait for the worker to finish this step, or cancel it first.", 409);
    const what = body?.what;
    if (what === "scene" || what === "clip") {
      const scene = sceneIndex(job, body?.scene);
      if (scene === null) return badRequest("Pick a scene.");
      if (what === "scene") {
        forgetOwn(job, scene, "image_source");
        forgetOwn(getVideoJob(id)!, scene, "clip_source");
        redoVideoStages(id, ["visuals"], { scenes: [scene] }, `Drawing scene ${scene + 1} again`);
      } else {
        forgetOwn(job, scene, "clip_source");
        redoVideoStages(id, ["visuals"], { clips: [scene] }, `Animating scene ${scene + 1} again`);
      }
    } else if (what === "narration") {
      redoVideoStages(id, ["audio"], null, "Speaking the narration again");
    } else if (what === "render") {
      redoVideoStages(id, ["render"], null, "Rendering again");
    } else if (what === "script") {
      redoVideoStages(id, ["script"], null, "Starting over with a new script");
    } else {
      return badRequest(`"what" must be scene, clip, narration, render or script.`);
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
  syncTopicWithJob(id, "deleted");
  await rm(jobDir(id), { recursive: true, force: true });
  return Response.json({ ok: true });
}
