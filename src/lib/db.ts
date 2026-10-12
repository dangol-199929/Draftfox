// Server-only: the local SQLite database in data/app.db, through Node's built-in node:sqlite (no native build step).
// Holds what you're working on (form contents and unsaved edits) so it survives page switches and reloads,
// and every generated post, so a post finished while you were on another page isn't lost.
// Also an activity log (posts published, drafts copied, LinkedIn connected...) that the Reports page reads,
// the posts you edit, schedule or publish from the Posts page, their images (files in data/images), and settings.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DATA_DIR = join(process.cwd(), "data");
const DB_FILE = join(DATA_DIR, "app.db");

// Pages whose state is kept. Anything else is refused so the table can't fill with junk.
export const STATE_KEYS = ["generate", "prompt", "profile"] as const;
export type StateKey = (typeof STATE_KEYS)[number];

export function isStateKey(key: string): key is StateKey {
  return (STATE_KEYS as readonly string[]).includes(key);
}

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS page_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS generations (
    id TEXT PRIMARY KEY,
    input TEXT NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    code TEXT,
    started_at TEXT NOT NULL,
    seconds REAL
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS events_at ON events (at);
  CREATE INDEX IF NOT EXISTS generations_started_at ON generations (started_at);
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    images TEXT NOT NULL,
    visibility TEXT NOT NULL,
    status TEXT NOT NULL,
    source TEXT NOT NULL,
    topic TEXT,
    scheduled_at TEXT,
    posted_at TEXT,
    urn TEXT,
    url TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS posts_status ON posts (status, scheduled_at);
  CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    file TEXT NOT NULL,
    mime TEXT NOT NULL,
    source TEXT NOT NULL,
    prompt TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

// One connection per server process; kept on globalThis so dev hot reloads don't open a new one each time.
// The schema is re-applied when SCHEMA changes, so a running dev server picks up new tables without a restart.
const globalForDb = globalThis as typeof globalThis & { appDb?: DatabaseSync; appDbSchema?: string };

function db(): DatabaseSync {
  if (!globalForDb.appDb) {
    mkdirSync(DATA_DIR, { recursive: true });
    globalForDb.appDb = new DatabaseSync(DB_FILE);
  }
  if (globalForDb.appDbSchema !== SCHEMA) {
    globalForDb.appDb.exec(SCHEMA);
    globalForDb.appDbSchema = SCHEMA;
  }
  return globalForDb.appDb;
}

export function readState(key: StateKey): unknown {
  const row = db().prepare("SELECT value FROM page_state WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

export function writeState(key: StateKey, value: unknown): void {
  db()
    .prepare(
      `INSERT INTO page_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(value), new Date().toISOString());
}

export function deleteState(key: StateKey): void {
  db().prepare("DELETE FROM page_state WHERE key = ?").run(key);
}

// --- Generations ---

export type GenerationRow = {
  id: string;
  input: string;
  text: string;
  status: string;
  error: string | null;
  code: string | null;
  started_at: string;
  seconds: number | null;
};

export function saveGeneration(row: GenerationRow): void {
  db()
    .prepare(
      `INSERT INTO generations (id, input, text, status, error, code, started_at, seconds)
       VALUES (:id, :input, :text, :status, :error, :code, :started_at, :seconds)
       ON CONFLICT (id) DO UPDATE SET text = excluded.text, status = excluded.status, error = excluded.error,
         code = excluded.code, seconds = excluded.seconds`,
    )
    .run(row);
}

export function latestGeneration(): GenerationRow | null {
  return (db().prepare("SELECT * FROM generations ORDER BY started_at DESC LIMIT 1").get() as GenerationRow) ?? null;
}

export function listGenerations(since: string | null): GenerationRow[] {
  const query = since
    ? db().prepare("SELECT * FROM generations WHERE started_at >= ? ORDER BY started_at")
    : db().prepare("SELECT * FROM generations ORDER BY started_at");
  return (since ? query.all(since) : query.all()) as GenerationRow[];
}

// --- Activity log ---

export const EVENT_TYPES = [
  "post_published",
  "post_deleted",
  "post_failed",
  "post_scheduled",
  "draft_copied",
  "image_generated",
  "image_uploaded",
  "autopilot_ran",
  "linkedin_connected",
  "linkedin_disconnected",
  "profile_saved",
  "profile_imported",
  "prompt_saved",
  "prompt_reset",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type EventRow = { id: number; type: EventType; data: Record<string, unknown>; at: string };

// Never throws: a failed log line must not break the action it describes.
export function logEvent(type: EventType, data: Record<string, unknown> = {}): void {
  try {
    db()
      .prepare("INSERT INTO events (type, data, at) VALUES (?, ?, ?)")
      .run(type, JSON.stringify(data), new Date().toISOString());
  } catch (error) {
    console.error(`Could not log the ${type} event:`, error);
  }
}

export function listEvents(since: string | null): EventRow[] {
  const query = since
    ? db().prepare("SELECT * FROM events WHERE at >= ? ORDER BY at")
    : db().prepare("SELECT * FROM events ORDER BY at");
  const rows = (since ? query.all(since) : query.all()) as { id: number; type: EventType; data: string; at: string }[];
  return rows.map((row) => {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(row.data) as Record<string, unknown>;
    } catch {
      // Keep the event with empty details.
    }
    return { ...row, data };
  });
}

// --- Posts (drafts, scheduled and published) ---

export type PostImage = { id: string; alt: string };
export type PostStatus = "draft" | "scheduled" | "publishing" | "posted" | "failed" | "deleted";
export type PostSource = "editor" | "generate" | "autopilot";

export type PostRecord = {
  id: string;
  text: string;
  images: PostImage[];
  visibility: "PUBLIC" | "CONNECTIONS";
  status: PostStatus;
  source: PostSource;
  topic: string | null;
  scheduledAt: string | null;
  postedAt: string | null;
  urn: string | null;
  url: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type PostRow = {
  id: string;
  text: string;
  images: string;
  visibility: string;
  status: string;
  source: string;
  topic: string | null;
  scheduled_at: string | null;
  posted_at: string | null;
  urn: string | null;
  url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

function toPost(row: PostRow): PostRecord {
  let images: PostImage[] = [];
  try {
    images = JSON.parse(row.images) as PostImage[];
  } catch {
    // Keep the post without images.
  }
  return {
    id: row.id,
    text: row.text,
    images,
    visibility: row.visibility === "CONNECTIONS" ? "CONNECTIONS" : "PUBLIC",
    status: row.status as PostStatus,
    source: row.source as PostSource,
    topic: row.topic,
    scheduledAt: row.scheduled_at,
    postedAt: row.posted_at,
    urn: row.urn,
    url: row.url,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function insertPost(post: PostRecord): void {
  db()
    .prepare(
      `INSERT INTO posts (id, text, images, visibility, status, source, topic, scheduled_at, posted_at, urn, url, error,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      post.id,
      post.text,
      JSON.stringify(post.images),
      post.visibility,
      post.status,
      post.source,
      post.topic,
      post.scheduledAt,
      post.postedAt,
      post.urn,
      post.url,
      post.error,
      post.createdAt,
      post.updatedAt,
    );
}

export function getPost(id: string): PostRecord | null {
  const row = db().prepare("SELECT * FROM posts WHERE id = ?").get(id) as PostRow | undefined;
  return row ? toPost(row) : null;
}

export function listPosts(): PostRecord[] {
  return (db().prepare("SELECT * FROM posts ORDER BY updated_at DESC").all() as PostRow[]).map(toPost);
}

export function duePosts(now: string): PostRecord[] {
  return (
    db().prepare("SELECT * FROM posts WHERE status = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at").all(now) as PostRow[]
  ).map(toPost);
}

const POST_COLUMNS: Record<string, string> = {
  text: "text",
  images: "images",
  visibility: "visibility",
  status: "status",
  topic: "topic",
  scheduledAt: "scheduled_at",
  postedAt: "posted_at",
  urn: "urn",
  url: "url",
  error: "error",
};

type PostChanges = Partial<Omit<PostRecord, "id" | "source" | "createdAt" | "updatedAt">>;

// Updates the given fields. With `onlyIfStatus`, only when the post still has that status, so two callers
// (say, the scheduler and a click on Post now) can't both publish it. Returns whether a row changed.
export function updatePost(id: string, changes: PostChanges, onlyIfStatus?: PostStatus): boolean {
  const sets: string[] = [];
  const values: (string | null)[] = [];
  for (const [field, value] of Object.entries(changes)) {
    const column = POST_COLUMNS[field];
    if (!column || value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(field === "images" ? JSON.stringify(value) : (value as string | null));
  }
  sets.push("updated_at = ?");
  values.push(new Date().toISOString());
  let sql = `UPDATE posts SET ${sets.join(", ")} WHERE id = ?`;
  values.push(id);
  if (onlyIfStatus) {
    sql += " AND status = ?";
    values.push(onlyIfStatus);
  }
  return Number(db().prepare(sql).run(...values).changes) > 0;
}

export function deletePostRecord(id: string): void {
  db().prepare("DELETE FROM posts WHERE id = ?").run(id);
}

// Images still used by any post, so deleting a draft doesn't remove an image another post shares.
export function imageInUse(imageId: string): boolean {
  const pattern = `%"id":"${imageId}"%`;
  return db().prepare("SELECT 1 FROM posts WHERE images LIKE ? LIMIT 1").get(pattern) !== undefined;
}

// --- Images (the files live in data/images) ---

export type ImageRecord = {
  id: string;
  file: string;
  mime: string;
  source: "upload" | "generated";
  prompt: string | null;
  created_at: string;
};

export function insertImage(image: ImageRecord): void {
  db()
    .prepare("INSERT INTO images (id, file, mime, source, prompt, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(image.id, image.file, image.mime, image.source, image.prompt, image.created_at);
}

export function getImage(id: string): ImageRecord | null {
  return (db().prepare("SELECT * FROM images WHERE id = ?").get(id) as ImageRecord | undefined) ?? null;
}

export function deleteImageRecord(id: string): void {
  db().prepare("DELETE FROM images WHERE id = ?").run(id);
}

// --- Settings ---

export function readSetting<T>(key: string): T | null {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export function writeSetting(key: string, value: unknown): void {
  db()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(value), new Date().toISOString());
}
