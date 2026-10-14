"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, CircleAlert, Loader2, Plus, Search, X } from "lucide-react";
import { formatDay, JobStatusBadge, MatchBadge, STATUS_LABELS } from "@/components/job-badges";
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

export function JobsBoard() {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobRecord[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [profileEmpty, setProfileEmpty] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    fetch("/api/jobs")
      .then((response) => response.json() as Promise<{ jobs: JobRecord[] }>)
      .then(({ jobs }) => {
        setJobs(jobs);
        if (jobs.length === 0) setAdding(true);
      })
      .catch(() => setError("Couldn't load your jobs."));
    fetch("/api/profile")
      .then((response) => response.json() as Promise<{ profile: Profile; exists: boolean }>)
      .then(({ profile, exists }) =>
        setProfileEmpty(!exists || (!profile.headline && !profile.summary && !profile.facts && !profile.cv && profile.positions.length === 0 && profile.skills.length === 0)),
      )
      .catch(() => {});
  }, []);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await response.json()) as { job?: JobRecord; error?: string };
      if (!response.ok || !data.job) throw new Error(data.error ?? "Couldn't save the job.");
      router.push(`/jobs/${data.job.id}`);
    } catch (err) {
      setFormError((err as Error).message);
      setSaving(false);
    }
  }

  const set = (field: keyof typeof EMPTY_FORM) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const shown = (jobs ?? []).filter((job) => filter === "all" || job.status === filter);

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

      {adding ? (
        <Card>
          <CardHeader>
            <CardTitle>Add a job</CardTitle>
            <CardDescription>
              Paste the details of a job you found, or{" "}
              <Link href="/jobs/find" className="text-foreground underline underline-offset-4">
                find jobs that match your profile
              </Link>
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
          <CardContent>
            <form onSubmit={add} className="grid gap-4">
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
              {formError && <p className="text-sm text-destructive">{formError}</p>}
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
          <CardAction className="flex gap-2">
            <Button asChild size="sm" variant={adding ? "default" : "outline"}>
              <Link href="/jobs/find">
                <Search />
                Find jobs
              </Link>
            </Button>
            {!adding && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus />
                Add a job
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
              {jobs.length === 0 ? "No jobs yet. Add one you found above." : "Nothing here."}
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
        </CardContent>
      </Card>
    </div>
  );
}
