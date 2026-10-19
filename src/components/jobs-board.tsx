"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BadgeDollarSign, BriefcaseBusiness, CalendarClock, CircleAlert, ClipboardPaste, Columns3, Download, List, Loader2, Plus, Search, X } from "lucide-react";
import { formatDay, JobStatusBadge, MatchBadge, STATUS_LABELS } from "@/components/job-badges";
import { JobDrawer } from "@/components/job-drawer";
import { JobFinder } from "@/components/job-finder";
import { JobListCard, selectInUrl, SplitLayout, useWide } from "@/components/job-split";
import { JobWorkspace } from "@/components/job-workspace";
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

type View = "list" | "board";
const VIEW_KEY = "draftfox.jobsView";

// initialJob: the job to select first (from ?job= in the address); a saved job's id, or a Find jobs result's.
export function JobsBoard({ initialTab = "mine", initialJob = null }: { initialTab?: JobsTab; initialJob?: string | null }) {
  const [tab, setTab] = useState<JobsTab>(initialTab);
  const wide = useWide();
  // List: your jobs beside the selected one. Board: a column per status (wide screens only).
  const [view, setView] = useState<View>("list");
  const [selected, setSelected] = useState<string | null>(initialTab === "mine" ? initialJob : null);
  const [scores, setScores] = useState<Record<string, number | null>>({});
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
      .then((response) => response.json() as Promise<{ jobs: JobRecord[]; scores?: Record<string, number | null> }>)
      .then(({ jobs, scores }) => {
        setJobs(jobs);
        setScores(scores ?? {});
        if (openAdding && jobs.length === 0) setAdding(true);
      })
      .catch(() => setError("Couldn't load your jobs."));
  }

  useEffect(() => {
    try {
      if (window.localStorage.getItem(VIEW_KEY) === "board") setView("board");
    } catch {
      // Storage blocked; start with the list.
    }
  }, []);

  function changeView(next: View) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Not remembered; fine.
    }
  }

  function select(id: string | null) {
    setSelected(id);
    selectInUrl(id);
  }

  // A job opens beside the list, or in the drawer when the board is showing.
  const board = view === "board" && wide;
  function openJob(id: string) {
    if (board) setDrawerId(id);
    else select(id);
  }

  // Keeps the list in step with what you change on the job's page.
  function updated(job: JobRecord) {
    setJobs((current) => current?.map((item) => (item.id === job.id ? job : item)) ?? current);
  }

  function removed(id: string) {
    setJobs((current) => current?.filter((item) => item.id !== id) ?? current);
    if (selected === id) select(null);
  }

  // Dropping a card in another column of the board changes its status.
  async function move(id: string, status: JobStatus) {
    const job = jobs?.find((item) => item.id === id);
    if (!job || job.status === status) return;
    updated({ ...job, status });
    try {
      const response = await fetch(`/api/jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = (await response.json()) as { job?: JobRecord; error?: string };
      if (!response.ok || !data.job) throw new Error(data.error ?? "Couldn't move the job.");
      updated(data.job);
    } catch (err) {
      updated(job);
      setError((err as Error).message);
    }
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
      openJob(saved.id);
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
    setSelected(null);
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

      <div className="inline-flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg border bg-surface p-1" role="tablist" aria-label="Jobs">
        {(
          [
            ["mine", `Applications${jobs ? ` (${jobs.length})` : ""}`],
            ["find", "Find jobs"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => showTab(value)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
              tab === value && "bg-card text-foreground shadow-xs dark:bg-muted [&_svg]:text-brand",
            )}
          >
            {value === "find" ? <Search className="size-3.5" /> : <BriefcaseBusiness className="size-3.5" />}
            {label}
          </button>
        ))}
      </div>

      {tab === "find" ? (
        <JobFinder
          initialJob={initialTab === "find" ? initialJob : null}
          onSaved={(job) => setJobs((current) => [job, ...(current ?? [])])}
          onRemoved={(id) => setJobs((current) => current?.filter((job) => job.id !== id) ?? current)}
        />
      ) : (
        <>
      <NextSteps jobs={jobs ?? []} onOpen={openJob} />

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
                      <button type="button" className="text-foreground underline underline-offset-4" onClick={() => openJob(duplicateId)}>
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

      <section className="grid gap-3" aria-labelledby="your-jobs-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="your-jobs-heading" className="text-base font-semibold tracking-tight">
            Your applications
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {wide && (
              <div className="inline-flex rounded-lg border bg-surface p-0.5" role="group" aria-label="View">
                {(
                  [
                    ["list", "List", List],
                    ["board", "Board", Columns3],
                  ] as const
                ).map(([value, label, Icon]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={view === value}
                    onClick={() => changeView(value)}
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
                      view === value && "bg-card text-foreground shadow-xs dark:bg-muted",
                    )}
                  >
                    <Icon className="size-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            )}
            <Button size="sm" variant="outline" onClick={() => showTab("find")}>
              <Search />
              Find jobs
            </Button>
            {!adding && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <ClipboardPaste />
                Paste a job
              </Button>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {!jobs && !error && (
          <div className="grid gap-2" aria-label="Loading your jobs">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-16 rounded-lg" />
            ))}
          </div>
        )}
        {jobs && jobs.length === 0 && (
          <div className="grid justify-items-center gap-3 rounded-xl border border-dashed bg-surface/40 px-4 py-12 text-center">
            <span className="grid size-11 place-items-center rounded-xl bg-brand-soft text-brand-strong">
              <BriefcaseBusiness className="size-5" />
            </span>
            <p className="text-sm font-semibold">No jobs yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Find jobs that match your profile, or paste one you found on LinkedIn, SEEK or a company&apos;s site.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => showTab("find")}>
                <Search />
                Find jobs
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                <ClipboardPaste />
                Paste a job
              </Button>
            </div>
          </div>
        )}

        {jobs && jobs.length > 0 && board && (
          <Board jobs={jobs} scores={scores} onOpen={openJob} onMove={(id, status) => void move(id, status)} />
        )}

        {jobs && jobs.length > 0 && !board && (
          <SplitLayout
            wide={wide}
            open={Boolean(selected && (jobs ?? []).find((job) => job.id === selected))}
            onClose={() => select(null)}
            title={(jobs ?? []).find((job) => job.id === selected)?.title ?? "Job"}
            fullPage={selected ? `/jobs/${selected}` : undefined}
            list={
              <Card className="gap-0 py-0">
                <div className="flex flex-wrap gap-1 border-b px-2 py-2" role="tablist" aria-label="Show">
                  {FILTERS.map((option) => {
                    const count = jobs.filter((job) => option.value === "all" || job.status === option.value).length;
                    return (
                      <button
                        key={option.value}
                        role="tab"
                        aria-selected={filter === option.value}
                        onClick={() => setFilter(option.value)}
                        className={cn(
                          "rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                          filter === option.value && "bg-muted font-medium text-foreground",
                        )}
                      >
                        {option.label}
                        <span className="ml-1 tabular-nums">{count}</span>
                      </button>
                    );
                  })}
                </div>
                {shown.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing here yet.</p>
                ) : (
                  <ul className="grid gap-0.5 p-1.5 xl:max-h-[calc(100dvh-14rem)] xl:overflow-y-auto">
                    {shown.map((job) => (
                      <li key={job.id}>
                        <JobListCard
                          selected={job.id === selected}
                          onSelect={() => select(job.id)}
                          job={{ ...job, fit: scores[job.id], note: job.followUp ? `Next step ${formatDay(job.followUp)}` : undefined }}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            }
            detail={
              selected && (
                <JobWorkspace key={selected} id={selected} onChange={updated} onDeleted={() => removed(selected)} />
              )
            }
          />
        )}

        {jobs && jobs.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="ghost">
              <a href="/api/jobs/export" download>
                <Download />
                Export to CSV
              </a>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link href="/jobs/offers">
                <BadgeDollarSign />
                Compare offers
              </Link>
            </Button>
          </div>
        )}
      </section>

      <OpenToWork jobs={jobs ?? []} />
        </>
      )}

      <JobDrawer id={drawerId} onClose={() => setDrawerId(null)} onChange={updated} />
    </div>
  );
}

// Your pipeline as columns, one per status. Drag a card to another column to change its status.
function Board({
  jobs,
  scores,
  onOpen,
  onMove,
}: {
  jobs: JobRecord[];
  scores: Record<string, number | null>;
  onOpen: (id: string) => void;
  onMove: (id: string, status: JobStatus) => void;
}) {
  const [over, setOver] = useState<JobStatus | null>(null);
  return (
    <div className="grid grid-cols-5 gap-3">
      {JOB_STATUSES.map((status) => {
        const column = jobs.filter((job) => job.status === status);
        return (
          <section
            key={status}
            aria-label={STATUS_LABELS[status]}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(status);
            }}
            onDragLeave={() => setOver((current) => (current === status ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              setOver(null);
              const id = event.dataTransfer.getData("text/plain");
              if (id) onMove(id, status);
            }}
            className={cn(
              "grid min-h-48 content-start gap-2 rounded-xl border bg-muted/30 p-2 transition-colors",
              over === status && "border-brand/50 bg-brand-soft",
            )}
          >
            <h3 className="flex items-center justify-between px-1 pt-1 text-xs font-medium text-muted-foreground">
              {STATUS_LABELS[status]}
              <span className="tabular-nums">{column.length}</span>
            </h3>
            {column.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted-foreground">Drop a job here</p>}
            {column.map((job) => (
              <div
                key={job.id}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/plain", job.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                className="cursor-grab rounded-lg border bg-card shadow-xs active:cursor-grabbing"
              >
                <JobListCard
                  selected={false}
                  onSelect={() => onOpen(job.id)}
                  job={{
                    title: job.title,
                    company: job.company,
                    location: "",
                    salary: job.salary,
                    fit: scores[job.id],
                    note: job.followUp ? `Next step ${formatDay(job.followUp)}` : undefined,
                  }}
                />
              </div>
            ))}
          </section>
        );
      })}
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
function NextSteps({ jobs, onOpen }: { jobs: JobRecord[]; onOpen: (id: string) => void }) {
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
      <button
        type="button"
        onClick={() => onOpen(job.id)}
        className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/60"
      >
        <span className="grid min-w-0 flex-1">
          <span className="truncate text-sm font-medium">{job.title}</span>
          <span className="truncate text-xs text-muted-foreground">{job.company}</span>
        </span>
        <span className={cn("shrink-0 text-xs", urgent ? "font-medium text-destructive" : "text-muted-foreground")}>{note}</span>
      </button>
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
