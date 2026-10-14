// The tracker's statuses, shared by the server and the Jobs page.
export const JOB_STATUSES = ["saved", "applied", "interview", "offer", "rejected"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export function isJobStatus(value: unknown): value is JobStatus {
  return (JOB_STATUSES as readonly unknown[]).includes(value);
}

// Labels for the offer details on a job's page and the offer comparison, in the order they're shown.
export const OFFER_LABELS: Record<OfferField, { label: string; placeholder?: string }> = {
  salary: { label: "Salary", placeholder: "AUD 110,000 + super" },
  bonus: { label: "Bonus" },
  equity: { label: "Equity or shares" },
  leave: { label: "Leave", placeholder: "20 days + 5 wellbeing days" },
  benefits: { label: "Benefits", placeholder: "Health cover, learning budget…" },
  workMode: { label: "Remote, hybrid or office" },
  startDate: { label: "Start date" },
  deadline: { label: "Reply by" },
  notes: { label: "Notes" },
};

export type OfferField = "salary" | "bonus" | "equity" | "leave" | "benefits" | "workMode" | "startDate" | "deadline" | "notes";
