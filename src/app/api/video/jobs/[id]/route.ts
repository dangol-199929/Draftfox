import { rm } from "node:fs/promises";
import { badRequest, readJsonObject } from "@/lib/api.ts";
import {
  deleteVideoJob,
  getVideoJob,
  jobDir,
  listVideoEvents,
  requeueVideoJob,
  setVideoStatus,
} from "@/lib/video-jobs.ts";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const job = getVideoJob(id);
  if (!job) return badRequest("No such video.", 404);
  return Response.json({ job, events: listVideoEvents(id) });
}

// { action: "approve" | "reject" | "cancel" | "retry" }
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const job = getVideoJob(id);
  if (!job) return badRequest("No such video.", 404);
  const body = await readJsonObject(request);
  const action = body?.action;

  if (action === "approve" || action === "reject") {
    if (job.status !== "AWAITING_APPROVAL" && job.status !== "APPROVED" && job.status !== "REJECTED") {
      return badRequest("Only a finished video can be approved or rejected.", 409);
    }
    setVideoStatus(id, action === "approve" ? "APPROVED" : "REJECTED");
  } else if (action === "cancel") {
    if (["APPROVED", "REJECTED", "CANCELLED"].includes(job.status)) return badRequest("This video is already done.", 409);
    setVideoStatus(id, "CANCELLED");
  } else if (action === "retry") {
    if (!["FAILED", "CANCELLED", "REJECTED"].includes(job.status)) return badRequest("Only a failed, cancelled or rejected video can be retried.", 409);
    requeueVideoJob(id, job.stage ?? "script", null, "Retrying");
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
