import { Badge } from "@/components/ui/badge";
import type { JobFit, JobStatus } from "@/lib/db.ts";

export const STATUS_LABELS: Record<JobStatus, string> = {
  saved: "Saved",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Closed",
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const variant = ({ saved: "outline", applied: "info", interview: "brand", offer: "success", rejected: "muted" } as const)[status];
  return <Badge variant={variant}>{STATUS_LABELS[status]}</Badge>;
}

// How many of the job's keywords your profile mentions, as a small colored pill.
export function FitScore({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) return null;
  const tone =
    score >= 60
      ? "bg-success-soft text-success"
      : score >= 30
        ? "bg-muted text-foreground"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-xs font-medium tabular-nums ${tone}`}
      title="Share of the job's keywords your profile mentions"
    >
      {score}% match
    </span>
  );
}

// "posted 3 days ago" for an ISO date.
export function formatAge(iso: string) {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (Number.isNaN(days)) return "";
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" });
}

const MATCH_LABELS: Record<JobFit["match"], string> = { strong: "Strong fit", partial: "Partial fit", weak: "Weak fit" };

export function MatchBadge({ match }: { match: JobFit["match"] }) {
  return <Badge variant={match === "strong" ? "success" : match === "weak" ? "destructive" : "warning"}>{MATCH_LABELS[match]}</Badge>;
}

// "2026-10-20" (a date with no time) shown as a short local date.
export function formatDay(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" });
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
}
