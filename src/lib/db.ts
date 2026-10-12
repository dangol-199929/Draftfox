// Server-only: the local SQLite database in data/app.db, through Node's built-in node:sqlite (no native build step).
// Holds what you're working on (form contents and unsaved edits) so it survives page switches and reloads.
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

// One connection per server process; kept on globalThis so dev hot reloads don't open a new one each time.
const globalForDb = globalThis as typeof globalThis & { appDb?: DatabaseSync };

function db(): DatabaseSync {
  if (!globalForDb.appDb) {
    mkdirSync(DATA_DIR, { recursive: true });
    const database = new DatabaseSync(DB_FILE);
    database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS page_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    globalForDb.appDb = database;
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
