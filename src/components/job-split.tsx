"use client";

// The Jobs page's split view: a list of jobs on the left and the selected job on the right, like LinkedIn and
// Indeed. On narrower screens there's only the list, and the selected job opens in a drawer.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Maximize2, MousePointerClick } from "lucide-react";
import { FitScore, formatAge, JobStatusBadge } from "@/components/job-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { JobStatus } from "@/lib/job-status.ts";
import { cn } from "@/lib/utils";

const WIDE = "(min-width: 1280px)";

// True when the screen is wide enough to show the list and the job side by side.
export function useWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(WIDE);
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

// Keeps ?job=<id> in the address in step with the selected job, so a reload or a shared link opens it again.
export function selectInUrl(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("job", id);
  else url.searchParams.delete("job");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

export type ListCardJob = {
  title: string;
  company: string;
  location: string;
  salary?: string | null;
  postedAt?: string | null;
  source?: string;
  isNew?: boolean;
  fit?: number | null;
  status?: JobStatus | null;
  note?: string;
};

export function JobListCard({ job, selected, onSelect }: { job: ListCardJob; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected || undefined}
      className={cn(
        "relative grid w-full gap-1.5 rounded-lg border border-transparent px-3 py-3 text-left transition-colors hover:bg-muted/60",
        selected &&
          "border-[color-mix(in_oklch,var(--brand),transparent_60%)] bg-brand-soft/70 before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-r-full before:bg-brand hover:bg-brand-soft/70",
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-sm leading-snug font-medium">{job.title || "Untitled job"}</span>
        {job.isNew && <Badge className="shrink-0">New</Badge>}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {[job.company, job.location].filter(Boolean).join(" · ") || "No company added"}
      </span>
      {job.salary && <span className="truncate text-xs font-medium">{job.salary}</span>}
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <FitScore score={job.fit} />
        {job.status && <JobStatusBadge status={job.status} />}
        {job.postedAt && <span>{formatAge(job.postedAt)}</span>}
        {job.source && <span>via {job.source}</span>}
        {job.note && <span>{job.note}</span>}
      </span>
    </button>
  );
}

// The list and the selected job side by side on wide screens; on narrow ones, the job opens in a drawer.
export function SplitLayout({
  list,
  detail,
  open,
  onClose,
  title,
  fullPage,
  wide,
}: {
  list: React.ReactNode;
  detail: React.ReactNode;
  open: boolean;
  onClose: () => void;
  title: string;
  fullPage?: string;
  wide: boolean;
}) {
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="min-w-0">{list}</div>
      {wide ? (
        <div className="sticky top-6 max-h-[calc(100dvh-3rem)] min-w-0 overflow-y-auto overscroll-contain rounded-xl pr-1">
          {open ? (
            detail
          ) : (
            <div className="grid h-72 place-items-center rounded-xl border border-dashed bg-surface/40 px-6 text-center">
              <div className="grid justify-items-center gap-2">
                <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand-strong">
                  <MousePointerClick className="size-5" />
                </span>
                <p className="text-sm font-medium">Pick a job to see it here</p>
                <p className="max-w-xs text-sm text-muted-foreground">
                  Its fit with your profile, the cover letter and answers, and where you&apos;re up to.
                </p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <DetailDrawer open={open} onClose={onClose} title={title} fullPage={fullPage}>
          {detail}
        </DetailDrawer>
      )}
    </div>
  );
}

// A job in a drawer on the right.
export function DetailDrawer({
  open,
  onClose,
  title,
  fullPage,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  fullPage?: string;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-[min(64rem,94vw)]"
      >
        <SheetHeader className="sticky top-0 z-10 flex-row items-center justify-between gap-2 border-b bg-background/90 px-5 py-3.5 pr-14 backdrop-blur-md">
          <div className="grid min-w-0 gap-0.5">
            <SheetTitle className="truncate">{title}</SheetTitle>
            <SheetDescription>Changes save as you go. You always apply yourself.</SheetDescription>
          </div>
          {fullPage && (
            <Button asChild size="sm" variant="ghost">
              <Link href={fullPage}>
                <Maximize2 />
                Full page
              </Link>
            </Button>
          )}
        </SheetHeader>
        <div className="p-4 sm:p-5">{open && children}</div>
      </SheetContent>
    </Sheet>
  );
}
