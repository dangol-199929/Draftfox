// Server-only: checks every 30 seconds for scheduled posts that are due and for automatic posting runs.
// It only works while the app's server is running (pnpm dev or pnpm start) on a Mac that's awake.
import { autopilotTick, LATE_LIMIT } from "./autopilot.ts";
import { duePosts, updatePost } from "./db.ts";
import { publishPost } from "./publish.ts";

const INTERVAL = 30_000;

// Kept on globalThis so a dev hot reload doesn't start a second timer.
const globalForScheduler = globalThis as typeof globalThis & { schedulerTimer?: NodeJS.Timeout; schedulerBusy?: boolean };

export function startScheduler(): void {
  if (globalForScheduler.schedulerTimer) return;
  globalForScheduler.schedulerTimer = setInterval(() => void tick(), INTERVAL);
  // Don't keep a process alive just for this (e.g. during next build).
  globalForScheduler.schedulerTimer.unref();
  void tick();
}

export async function tick(now = new Date()): Promise<void> {
  if (globalForScheduler.schedulerBusy) return;
  globalForScheduler.schedulerBusy = true;
  try {
    for (const post of duePosts(now.toISOString())) {
      if (now.getTime() - Date.parse(post.scheduledAt!) > LATE_LIMIT) {
        updatePost(
          post.id,
          { status: "failed", error: "Missed: the app wasn't running at the scheduled time. Post it now or schedule it again." },
          "scheduled",
        );
        continue;
      }
      try {
        await publishPost(post.id, "scheduled", "scheduled");
      } catch (error) {
        // publishPost already saved the error on the post.
        console.error(`Scheduled post ${post.id} failed:`, (error as Error).message);
      }
    }
    await autopilotTick(now);
  } catch (error) {
    console.error("Scheduler check failed:", error);
  } finally {
    globalForScheduler.schedulerBusy = false;
  }
}
