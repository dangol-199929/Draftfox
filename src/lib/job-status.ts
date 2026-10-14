// The tracker's statuses, shared by the server and the Jobs page.
export const JOB_STATUSES = ["saved", "applied", "interview", "offer", "rejected"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export function isJobStatus(value: unknown): value is JobStatus {
  return (JOB_STATUSES as readonly unknown[]).includes(value);
}
