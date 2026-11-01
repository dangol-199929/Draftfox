// Server-only: the Video Studio's backlog of topic ideas, in the video_topics table. Ideas are imported per series
// (scripts/import-video-topics.ts) and only become videos when you click Make video or Make next.
// status: idea (not made yet), queued (a video was made from it), used (that video was approved).
import { db } from "./db.ts";
import { createVideoJob, type VideoJob } from "./video-jobs.ts";

export type TopicStatus = "idea" | "queued" | "used";

export type VideoTopic = {
  id: number;
  series: string;
  category: string | null;
  position: number;
  title: string;
  brief: string;
  status: TopicStatus;
  jobId: string | null;
};

type Row = {
  id: number;
  series: string;
  category: string | null;
  position: number;
  title: string;
  brief: string;
  status: string;
  job_id: string | null;
};

function toTopic(row: Row): VideoTopic {
  return {
    id: row.id,
    series: row.series,
    category: row.category,
    position: row.position,
    title: row.title,
    brief: row.brief,
    status: row.status as TopicStatus,
    jobId: row.job_id,
  };
}

export function listVideoTopics(): VideoTopic[] {
  return (db().prepare("SELECT * FROM video_topics ORDER BY series, position").all() as Row[]).map(toTopic);
}

export type TopicImport = { category?: string; title: string; brief: string };

// Adds or updates a series' ideas by position, keeping the status (and video) of ones already made.
export function importVideoTopics(series: string, topics: TopicImport[]): number {
  const now = new Date().toISOString();
  const upsert = db().prepare(
    `INSERT INTO video_topics (series, category, position, title, brief, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'idea', ?, ?)
     ON CONFLICT (series, position) DO UPDATE SET category = excluded.category, title = excluded.title,
       brief = excluded.brief, updated_at = excluded.updated_at`,
  );
  topics.forEach((topic, index) => upsert.run(series, topic.category ?? null, index + 1, topic.title, topic.brief, now, now));
  return topics.length;
}

// What the script writer is given: the hook title, then the lesson to explain.
function jobTopic(topic: VideoTopic): string {
  return `${topic.title}. ${topic.brief}`.slice(0, 500);
}

// Makes a video from an idea (once: an idea that already has a video is refused).
export function makeVideoFromTopic(id: number): { job: VideoJob } | { error: string; status: number } {
  const row = db().prepare("SELECT * FROM video_topics WHERE id = ?").get(id) as Row | undefined;
  if (!row) return { error: "No such topic idea.", status: 404 };
  const topic = toTopic(row);
  if (topic.status !== "idea") return { error: "A video was already made from this idea.", status: 409 };
  const job = createVideoJob(jobTopic(topic), topic.series);
  db()
    .prepare("UPDATE video_topics SET status = 'queued', job_id = ?, updated_at = ? WHERE id = ?")
    .run(job.id, new Date().toISOString(), id);
  return { job };
}

// The first idea not made yet, in import order (optionally within one series).
export function nextTopicIdea(series?: string): VideoTopic | null {
  const row = (
    series
      ? db().prepare("SELECT * FROM video_topics WHERE status = 'idea' AND series = ? ORDER BY position LIMIT 1").get(series)
      : db().prepare("SELECT * FROM video_topics WHERE status = 'idea' ORDER BY series, position LIMIT 1").get()
  ) as Row | undefined;
  return row ? toTopic(row) : null;
}

// Called when a video is approved, rejected or deleted, so the idea shows what happened to it. A rejected video keeps
// its idea (it can still be tried again); a deleted one puts the idea back in the list.
export function syncTopicWithJob(jobId: string, outcome: "approved" | "rejected" | "deleted"): void {
  const sql = {
    approved: "UPDATE video_topics SET status = 'used', updated_at = ? WHERE job_id = ?",
    rejected: "UPDATE video_topics SET status = 'queued', updated_at = ? WHERE job_id = ?",
    deleted: "UPDATE video_topics SET status = 'idea', job_id = NULL, updated_at = ? WHERE job_id = ?",
  }[outcome];
  db().prepare(sql).run(new Date().toISOString(), jobId);
}
