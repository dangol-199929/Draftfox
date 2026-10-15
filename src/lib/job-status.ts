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

// What the Jobs page does for you, set on the Settings page.
export type PrepareMakes = "letter" | "letter-cv" | "everything";
export type JobSettings = {
  // Start writing the cover letter as soon as you open a saved job that doesn't have one.
  autoLetter: boolean;
  // What Prepare application writes.
  prepareMakes: PrepareMakes;
};

export const DEFAULT_JOB_SETTINGS: JobSettings = { autoLetter: false, prepareMakes: "letter-cv" };

export const PREPARE_OPTIONS: { value: PrepareMakes; label: string; description: string }[] = [
  { value: "letter", label: "Cover letter only", description: "The quickest." },
  { value: "letter-cv", label: "Cover letter + CV", description: "A cover letter and your CV tailored to the job." },
  {
    value: "everything",
    label: "Everything",
    description: "Also checks the fit and prepares likely interview questions for later.",
  },
];

export function parseJobSettings(value: unknown): JobSettings {
  const data = (typeof value === "object" && value !== null ? value : {}) as Partial<JobSettings>;
  return {
    autoLetter: typeof data.autoLetter === "boolean" ? data.autoLetter : DEFAULT_JOB_SETTINGS.autoLetter,
    prepareMakes: PREPARE_OPTIONS.some((option) => option.value === data.prepareMakes)
      ? data.prepareMakes!
      : DEFAULT_JOB_SETTINGS.prepareMakes,
  };
}

// How much of the job's keywords your profile covers, 0 to 100; null when the job names none.
export function keywordScore({ found, missing }: { found: string[]; missing: string[] }): number | null {
  const total = found.length + missing.length;
  return total === 0 ? null : Math.round((found.length / total) * 100);
}
