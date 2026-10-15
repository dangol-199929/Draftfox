"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BadgeDollarSign, CalendarClock, CircleAlert, ClipboardPaste, Download, Loader2, Plus, Search, X } from "lucide-react";
import { formatDay, JobStatusBadge, MatchBadge, STATUS_LABELS } from "@/components/job-badges";
import { JobDrawer } from "@/components/job-drawer";
import { JobFinder } from "@/components/job-finder";
import { OpenToWork } from "@/components/open-to-work";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { JobRecord } from "@/lib/db.ts";
import { JOB_STATUSES, type JobStatus } from "@/lib/job-status.ts";
import type { Profile } from "@/lib/profile.ts";
import { cn } from "@/lib/utils";

type Filter = "all" | JobStatus;
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  ...JOB_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] })),
];

const EMPTY_FORM = { title: "", company: "", location: "", url: "", description: "" };
// What Paste a job read besides the form's fields, saved with the job.
type Extra = { salary: string; postedAt: string | null; source: string };
const NO_EXTRA: Extra = { salary: "", postedAt: null, source: "" };

// "https://www.seek.com.au/job/123" -> "seek.com.au".
function siteName(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export type JobsTab = "mine" | "find";

export function JobsBoard({ initialTab = "mine" }: { initialTab?: JobsTab }) {
  const [tab, setTab] = useState<JobsTab>(initialTab);
  const [jobs, setJobs] = useState<JobRecord[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [profileEmpty, setProfileEmpty] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  // The saved job a new one looks like, so you can open it or save the new one anyway.
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  // Paste a job: a link or the posting's text, read into the form below for you to check.
  const [pasted, setPasted] = useState("");
  const [reading, setReading] = useState(false);
  const [extra, setExtra] = useState<Extra>(NO_EXTRA);
  // The saved job open in the drawer on the right.
  const [drawerId, setDrawerId] = useState<string | null>(null);

  function loadJobs(openAdding = false) {
    fetch("/api/jobs")
      .then((response) => response.json() as Promise<{ jobs: JobRecord[] }>)
      .then(({ jobs }) => {
        setJobs(jobs);
        if (openAdding && jobs.length === 0) setAdding(true);
      })
      .catch(() => setError("Couldn't load your jobs."));
  }

  useEffect(() => {
    loadJobs(true);
    fetch("/api/profile")
      .then((response) => response.json() as Promise<{ profile: Profile; exists: boolean }>)
      .then(({ profile, exists }) =>
        setProfileEmpty(!exists || (!profile.headline && !profile.summary && !profile.facts && !profile.cv && profile.positions.length === 0 && profile.skills.length === 0)),
      )
      .catch(() => {});
  }, []);

  async function add(event?: React.FormEvent, allowDuplicate = false) {
    event?.preventDefault();
    setSaving(true);
    setFormError("");
    setDuplicateId(null);
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, ...extra, source: extra.source || siteName(form.url), allowDuplicate }),
      });
      const data = (await response.json()) as { job?: JobRecord; error?: string; duplicateId?: string };
      if (data.duplicateId) setDuplicateId(data.duplicateId);
      if (!response.ok || !data.job) throw new Error(data.error ?? "Couldn't save the job.");
      // Open it in the drawer to prepare the application, and clear the form for the next one.
      const saved = data.job;
      setJobs((current) => [saved, ...(current ?? [])]);
      setDrawerId(saved.id);
      setForm(EMPTY_FORM);
      setExtra(NO_EXTRA);
      setPasted("");
      setAdding(false);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function readPasted() {
    setReading(true);
    setFormError("");
    setDuplicateId(null);
    try {
      const response = await fetch("/api/jobs/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: pasted }),
      });
      const data = (await response.json()) as { job?: typeof EMPTY_FORM & { salary: string; postedAt: string | null }; error?: string };
      if (!response.ok || !data.job) throw new Error(data.error ?? "Couldn't read that job.");
      const { salary, postedAt, ...fields } = data.job;
      setForm({ title: fields.title, company: fields.company, location: fields.location, url: fields.url, description: fields.description });
      setExtra({ salary, postedAt, source: siteName(fields.url) });
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setReading(false);
    }
  }

  const set = (field: keyof typeof EMPTY_FORM) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const shown = (jobs ?? []).filter((job) => filter === "all" || job.status === filter);

  // The tab is kept in the address (?tab=find), so reloading or going back shows the same one.
  function showTab(next: JobsTab) {
    setTab(next);
    window.history.replaceState(null, "", next === "find" ? "/jobs?tab=find" : "/jobs");
  }

  return (
    <div className="grid gap-6">
      {profileEmpty && (
        <Alert>
          <CircleAlert />
          <AlertTitle>Your profile is empty</AlertTitle>
          <AlertDescription>
            <p>
              Fit checks, cover letters and answers are written only from your profile, so add your experience first.{" "}
              <Link href="/profile" className="font-medium text-foreground underline underline-offset-4">
                Go to Profile
              </Link>
            </p>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-1 border-b" role="tablist" aria-label="Jobs">
        {(
          [
            ["mine", `Your jobs${jobs ? ` (${jobs.length})` : ""}`],
            ["find", "Find jobs"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => showTab(value)}
            className={cn(
              "-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground",
              tab === value && "border-foreground font-medium text-foreground",
            )}
          >
            {value === "find" && <Search className="mr-1.5 inline size-3.5" />}
            {label}
          </button>
        ))}
      </div>

      {tab === "find" ? (
        <JobFinder onSaved={(job) => setJobs((current) => [job, ...(current ?? [])])} />
      ) : (
        <>
      <NextSteps jobs={jobs ?? []} />

      {adding ? (
        <Card>
          <CardHeader>
            <CardTitle>Paste a job</CardTitle>
            <CardDescription>
              Paste a job&apos;s link (LinkedIn, SEEK, Indeed, a company&apos;s careers page…) or its text, check the details,
              and save it. Or{" "}
              <button type="button" className="text-foreground underline underline-offset-4" onClick={() => showTab("find")}>
                find jobs that match your profile
              </button>
              .
            </CardDescription>
            {jobs && jobs.length > 0 && (
              <CardAction>
                <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={() => setAdding(false)}>
                  <X />
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="job-paste">Link or job text</Label>
              <Textarea
                id="job-paste"
                rows={2}
                maxLength={50_000}
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
                placeholder="https://www.linkedin.com/jobs/view/… or paste the whole posting"
                className="max-h-48"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" disabled={reading || !pasted.trim()} onClick={() => void readPasted()}>
                  {reading ? <Loader2 className="animate-spin" /> : <ClipboardPaste />}
                  {reading ? "Reading…" : "Fill in the details"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  Only that one page is read. If a site needs you to sign in, paste the text instead.
                </span>
              </div>
            </div>
            <form onSubmit={add} className="grid gap-4 border-t pt-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="job-title">Job title</Label>
                  <Input id="job-title" required maxLength={200} value={form.title} onChange={set("title")} placeholder="Frontend Developer" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="job-company">Company</Label>
                  <Input id="job-company" maxLength={200} value={form.company} onChange={set("company")} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="job-location">Location</Label>
                  <Input id="job-location" maxLength={200} value={form.location} onChange={set("location")} placeholder="Remote, Sydney…" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="job-url">Link to the job posting</Label>
                  <Input id="job-url" type="url" maxLength={2000} value={form.url} onChange={set("url")} placeholder="https://" />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="job-description">Job description</Label>
                <Textarea
                  id="job-description"
                  rows={8}
                  maxLength={20_000}
                  value={form.description}
                  onChange={set("description")}
                  placeholder="Paste the whole posting: responsibilities, requirements, nice-to-haves."
                  className="max-h-96"
                />
              </div>
              {formError && (
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-destructive">
                  {formError}
                  {duplicateId && (
                    <>
                      <button type="button" className="text-foreground underline underline-offset-4" onClick={() => setDrawerId(duplicateId)}>
                        Open it
                      </button>
                      <button type="button" className="text-foreground underline underline-offset-4" onClick={() => void add(undefined, true)}>
                        Save it again anyway
                      </button>
                    </>
                  )}
                </p>
              )}
              {extra.salary && <p className="text-xs text-muted-foreground">Salary listed: {extra.salary}</p>}
              <Button type="submit" className="justify-self-start" disabled={saving || !form.title.trim()}>
                {saving ? <Loader2 className="animate-spin" /> : <Plus />}
                Save job
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Your jobs</CardTitle>
          <CardAction className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant={adding ? "default" : "outline"} onClick={() => showTab("find")}>
              <Search />
              Find jobs
            </Button>
            {!adding && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus />
                Paste a job
              </Button>
            )}
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Show">
            {FILTERS.map((option) => {
              const count = (jobs ?? []).filter((job) => option.value === "all" || job.status === option.value).length;
              return (
                <button
                  key={option.value}
                  role="tab"
                  aria-selected={filter === option.value}
                  onClick={() => setFilter(option.value)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    filter === option.value && "bg-muted text-foreground",
                  )}
                >
                  {option.label}
                  {jobs && <span className="ml-1 tabular-nums text-muted-foreground">{count}</span>}
                </button>
              );
            })}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {!jobs && !error && (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </p>
          )}
          {jobs && shown.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {jobs.length === 0 ? "No jobs yet. Paste one you found above, or find jobs." : "Nothing here."}
            </p>
          )}
          {shown.length > 0 && (
            <ul className="grid divide-y">
              {shown.map((job) => (
                <li key={job.id}>
                  <Link
                    href={`/jobs/${job.id}`}
                    className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted/60"
                  >
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate text-sm font-medium">{job.title}</span>
                      <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        {[job.company, job.location].filter(Boolean).join(" · ") || "No company added"}
                        {job.followUp && (
                          <span className="inline-flex items-center gap-1">
                            <CalendarClock className="size-3" /> {formatDay(job.followUp)}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-wrap justify-end gap-1">
                      {job.fit && <MatchBadge match={job.fit.match} />}
                      <JobStatusBadge status={job.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {jobs && jobs.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t pt-3">
              <Button asChild size="sm" variant="ghost">
                <a href="/api/jobs/export" download>
                  <Download />
                  Export to CSV
                </a>
              </Button>
              {jobs.some((job) => job.offer || job.status === "offer") && (
                <Button asChild size="sm" variant="ghost">
                  <Link href="/jobs/offers">
                    <BadgeDollarSign />
                    Compare offers
                  </Link>
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <OpenToWork jobs={jobs ?? []} />
        </>
      )}

      <JobDrawer
        id={drawerId}
        onClose={() => {
          setDrawerId(null);
          loadJobs();
        }}
      />
    </div>
  );
}

const DAY = 86_400_000;
const FOLLOW_UP_AFTER_DAYS = 7;

function localDay(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Next steps due today or overdue, the ones coming up this week, and applications with no answer after a week
// and no next step set, which might be worth a follow-up email.
function NextSteps({ jobs }: { jobs: JobRecord[] }) {
  const today = localDay(new Date());
  const inAWeek = localDay(new Date(Date.now() + 7 * DAY));
  const open = jobs.filter((job) => job.status !== "rejected");
  const due = open.filter((job) => job.followUp && job.followUp <= today).sort((a, b) => a.followUp!.localeCompare(b.followUp!));
  const soon = open.filter((job) => job.followUp && job.followUp > today && job.followUp <= inAWeek).sort((a, b) => a.followUp!.localeCompare(b.followUp!));
  const quiet = open.filter((job) => {
    if (job.status !== "applied" || job.followUp) return false;
    const applied = job.history.findLast((step) => step.status === "applied")?.at;
    return applied !== undefined && Date.now() - Date.parse(applied) > FOLLOW_UP_AFTER_DAYS * DAY;
  });
  if (due.length + soon.length + quiet.length === 0) return null;

  const row = (job: JobRecord, note: string, urgent = false) => (
    <li key={`${note}-${job.id}`}>
      <Link href={`/jobs/${job.id}`} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/60">
        <span className="grid min-w-0 flex-1">
          <span className="truncate text-sm font-medium">{job.title}</span>
          <span className="truncate text-xs text-muted-foreground">{job.company}</span>
        </span>
        <span className={cn("shrink-0 text-xs", urgent ? "font-medium text-destructive" : "text-muted-foreground")}>{note}</span>
      </Link>
    </li>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4" /> Next steps
        </CardTitle>
        <CardDescription>From the next-step dates on your jobs. Open a job to write a follow-up or thank-you email.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid divide-y">
          {due.map((job) => row(job, job.followUp === today ? "Due today" : `Overdue since ${formatDay(job.followUp!)}`, true))}
          {soon.map((job) => row(job, formatDay(job.followUp!)))}
          {quiet.map((job) => row(job, `No reply after ${FOLLOW_UP_AFTER_DAYS}+ days: follow up?`))}
        </ul>
      </CardContent>
    </Card>
  );
}
