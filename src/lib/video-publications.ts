// Server-only: where each Video Studio video was uploaded, in the video_publications table.
// One row per (job, platform), so a video can't be uploaded twice to the same platform.
import { db } from "./db.ts";

export type Platform = "youtube";
export type PublicationStatus = "uploading" | "uploaded" | "failed";

export type VideoPublication = {
  jobId: string;
  platform: Platform;
  status: PublicationStatus;
  remoteId: string | null;
  url: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type Row = {
  job_id: string;
  platform: string;
  status: string;
  remote_id: string | null;
  url: string | null;
  error: string | null;
  upload_url: string | null;
  created_at: string;
  updated_at: string;
};

// An upload still marked "uploading" after this long was interrupted (a restart mid-upload) and may be tried again.
const STALE_MS = 15 * 60 * 1000;

function toPublication(row: Row): VideoPublication {
  return {
    jobId: row.job_id,
    platform: row.platform as Platform,
    status: row.status as PublicationStatus,
    remoteId: row.remote_id,
    url: row.url,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getRow(jobId: string, platform: Platform): Row | undefined {
  return db().prepare("SELECT * FROM video_publications WHERE job_id = ? AND platform = ?").get(jobId, platform) as Row | undefined;
}

export function listPublications(jobId: string): VideoPublication[] {
  return (db().prepare("SELECT * FROM video_publications WHERE job_id = ? ORDER BY platform").all(jobId) as Row[]).map(toPublication);
}

export type StartResult =
  | { ok: true; uploadUrl: string | null }
  | { ok: false; publication: VideoPublication; reason: "uploaded" | "uploading" };

// Marks the upload as started, unless it's already done or another upload of it is running. Returns the
// resumable upload URL of an earlier attempt that broke off, so that attempt can continue instead of starting over.
// node:sqlite is synchronous and the server is one process, so the check and the write can't interleave.
export function startPublication(jobId: string, platform: Platform): StartResult {
  const row = getRow(jobId, platform);
  const now = new Date().toISOString();
  if (row?.status === "uploaded") return { ok: false, publication: toPublication(row), reason: "uploaded" };
  if (row?.status === "uploading" && Date.now() - Date.parse(row.updated_at) < STALE_MS) {
    return { ok: false, publication: toPublication(row), reason: "uploading" };
  }
  db()
    .prepare(
      `INSERT INTO video_publications (job_id, platform, status, created_at, updated_at) VALUES (?, ?, 'uploading', ?, ?)
       ON CONFLICT (job_id, platform) DO UPDATE SET status = 'uploading', error = NULL, updated_at = excluded.updated_at`,
    )
    .run(jobId, platform, now, now);
  return { ok: true, uploadUrl: row?.upload_url ?? null };
}

export function saveUploadUrl(jobId: string, platform: Platform, uploadUrl: string | null): void {
  db()
    .prepare("UPDATE video_publications SET upload_url = ?, updated_at = ? WHERE job_id = ? AND platform = ?")
    .run(uploadUrl, new Date().toISOString(), jobId, platform);
}

export function finishPublication(jobId: string, platform: Platform, remoteId: string, url: string): void {
  db()
    .prepare(
      `UPDATE video_publications SET status = 'uploaded', remote_id = ?, url = ?, error = NULL, upload_url = NULL, updated_at = ?
       WHERE job_id = ? AND platform = ?`,
    )
    .run(remoteId, url, new Date().toISOString(), jobId, platform);
}

export function failPublication(jobId: string, platform: Platform, error: string): void {
  db()
    .prepare("UPDATE video_publications SET status = 'failed', error = ?, updated_at = ? WHERE job_id = ? AND platform = ?")
    .run(error.slice(0, 2000), new Date().toISOString(), jobId, platform);
}
