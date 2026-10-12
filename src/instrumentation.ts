// Runs once when the server starts: starts the scheduler for scheduled posts and automatic posting.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startScheduler } = await import("./lib/scheduler.ts");
    startScheduler();
  }
}
