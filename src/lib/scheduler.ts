// Server-only: checks every 30 seconds for scheduled posts that are due and for automatic posting runs,
// and every few hours deletes images no post uses.
// It only works while the app's server is running (pnpm dev or pnpm start) on a Mac that's awake.
import { autopilotTick, LATE_LIMIT } from "./autopilot.ts";
import { duePosts, updatePost } from "./db.ts";
import { cleanupImages } from "./images.ts";
import { publishPost } from "./publish.ts";

const INTERVAL = 30_000;
const CLEANUP_INTERVAL = 6 * 60 * 60 * 1000;

// Kept on globalThis so a dev hot reload doesn't start a second timer.
const globalForScheduler = globalThis as typeof globalThis & {
  schedulerTimer?: NodeJS.Timeout;
  schedulerBusy?: boolean;
  lastCleanup?: number;
};

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
    if (now.getTime() - (globalForScheduler.lastCleanup ?? 0) > CLEANUP_INTERVAL) {
      globalForScheduler.lastCleanup = now.getTime();
      const { deleted, bytes } = await cleanupImages(now.getTime());
      if (deleted) console.log(`Cleaned up ${deleted} unused image${deleted === 1 ? "" : "s"} (${(bytes / 1e6).toFixed(1)} MB).`);
    }
  } catch (error) {
    console.error("Scheduler check failed:", error);
  } finally {
    globalForScheduler.schedulerBusy = false;
  }
}
