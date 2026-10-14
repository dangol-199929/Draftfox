import { Badge } from "@/components/ui/badge";
import type { JobFit, JobStatus } from "@/lib/db.ts";

export const STATUS_LABELS: Record<JobStatus, string> = {
  saved: "Saved",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const variant = status === "offer" ? "default" : status === "rejected" ? "destructive" : status === "saved" ? "outline" : "secondary";
  return <Badge variant={variant}>{STATUS_LABELS[status]}</Badge>;
}

const MATCH_LABELS: Record<JobFit["match"], string> = { strong: "Strong fit", partial: "Partial fit", weak: "Weak fit" };

export function MatchBadge({ match }: { match: JobFit["match"] }) {
  return <Badge variant={match === "strong" ? "default" : match === "weak" ? "destructive" : "secondary"}>{MATCH_LABELS[match]}</Badge>;
}

// "2026-10-20" (a date with no time) shown as a short local date.
export function formatDay(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" });
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
}
