"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, ExternalLink, FileText, ListChecks, Loader2, MessageSquareText, Pencil, Trash2 } from "lucide-react";
import { formatDate, formatDay, JobStatusBadge, MatchBadge, STATUS_LABELS } from "@/components/job-badges";
import { ContactsCard, EmailCard, InterviewCard, Keywords, OfferCard, TailoredCvCard, type PartProps } from "@/components/job-parts";
import {
  CopyButton,
  DownloadButton,
  Field,
  Gaps,
  SaveState,
  ToCheck,
  WriteButton,
  WriteError,
  type WriteKind,
} from "@/components/job-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { JobAnswer, JobRecord } from "@/lib/db.ts";
import { JOB_STATUSES, type JobStatus } from "@/lib/job-status.ts";

type Keywords = { found: string[]; missing: string[] };
type JobResponse = { job: JobRecord; writing: WriteKind[]; keywords: Keywords };

// The text you edit on this page. Saved shortly after you stop typing.
type Draft = Pick<JobRecord, "title" | "company" | "location" | "url" | "description" | "notes"> & {
  letter: string;
  answers: Pick<JobAnswer, "question" | "answer">[];
};

const SAVE_DELAY = 600;
const POLL_DELAY = 4000;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed with status ${response.status}.`);
  return data;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function toDraft(job: JobRecord): Draft {
  return {
    title: job.title,
    company: job.company,
    location: job.location,
    url: job.url,
    description: job.description,
    notes: job.notes,
    letter: job.letter?.text ?? "",
    answers: job.answers.map(({ question, answer }) => ({ question, answer })),
  };
}

export function JobWorkspace({ id }: { id: string }) {
  const router = useRouter();
  const [job, setJob] = useState<JobRecord | null>(null);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [writing, setWriting] = useState<WriteKind[]>([]);
  const [writeErrors, setWriteErrors] = useState<Partial<Record<WriteKind, string>>>({});
  const [editingDetails, setEditingDetails] = useState(false);
  const [questions, setQuestions] = useState("");
  const [openedLink, setOpenedLink] = useState(false);
  const [keywords, setKeywords] = useState<Keywords | null>(null);
  const lastSaved = useRef<string | null>(null);

  // Takes the job from the server. Fields the server wrote (a new letter or answers) replace what's on the page.
  const receive = useCallback((data: JobResponse, replace: (keyof Draft)[] = []) => {
    setJob(data.job);
    setWriting(data.writing);
    setKeywords(data.keywords);
    const fresh = toDraft(data.job);
    setDraft((current) => {
      if (!current) {
        lastSaved.current = JSON.stringify(fresh);
        return fresh;
      }
      const next = { ...current };
      for (const field of replace) (next as Record<string, unknown>)[field] = fresh[field];
      const saved = JSON.parse(lastSaved.current ?? "{}") as Draft;
      for (const field of replace) (saved as Record<string, unknown>)[field] = fresh[field];
      lastSaved.current = JSON.stringify(saved);
      return next;
    });
  }, []);

  useEffect(() => {
    request<JobResponse>(`/api/jobs/${id}`)
      .then((data) => receive(data))
      .catch((error: Error) => setLoadError(error.message));
  }, [id, receive]);

  // Drafts this page asked for and is waiting on. Anything else in `writing` was started before you came back
  // to the page, so check every few seconds until it's done, then show it.
  const [busy, setBusy] = useState<WriteKind[]>([]);
  const background = writing.filter((kind) => !busy.includes(kind)).join(",");
  useEffect(() => {
    if (!background) return;
    const timer = setTimeout(() => {
      request<JobResponse>(`/api/jobs/${id}`)
        .then((data) => {
          const finished = background.split(",").filter((kind) => !data.writing.includes(kind as WriteKind));
          receive(data, finished.filter((kind): kind is "letter" | "answers" => kind === "letter" || kind === "answers"));
        })
        .catch(() => {});
    }, POLL_DELAY);
    return () => clearTimeout(timer);
  }, [id, background, writing, receive]);

  const draftJson = draft ? JSON.stringify(draft) : null;

  const save = useCallback(async (): Promise<boolean> => {
    if (!draftJson || draftJson === lastSaved.current) return true;
    const sending = draftJson;
    const before = JSON.parse(lastSaved.current ?? "{}") as Partial<Draft>;
    const now = JSON.parse(sending) as Draft;
    const changes = Object.fromEntries(
      Object.entries(now).filter(([field, value]) => JSON.stringify(value) !== JSON.stringify(before[field as keyof Draft])),
    );
    setSaving("saving");
    try {
      const data = await request<JobResponse>(`/api/jobs/${id}`, json("PATCH", changes));
      lastSaved.current = sending;
      setJob(data.job);
      setKeywords(data.keywords);
      setSaving("saved");
      setSaveError("");
      return true;
    } catch (error) {
      setSaving("error");
      setSaveError((error as Error).message);
      return false;
    }
  }, [draftJson, id]);

  useEffect(() => {
    if (!draftJson || draftJson === lastSaved.current) return;
    const timer = setTimeout(() => void save(), SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [draftJson, save]);

  // Save right away when leaving the page.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => () => void saveRef.current(), []);

  // Saves fields right away (status, date, and the cards' own edits).
  async function patch(changes: Record<string, unknown>) {
    try {
      const data = await request<JobResponse>(`/api/jobs/${id}`, json("PATCH", changes));
      setJob(data.job);
      setSaveError("");
    } catch (error) {
      setSaveError((error as Error).message);
    }
  }

  async function write(kind: WriteKind, body: Record<string, unknown> = {}) {
    // Save edits first, so the model works from the job description as it is on the page.
    if (!(await save())) return;
    setBusy((current) => [...current, kind]);
    setWriting((current) => [...current, kind]);
    setWriteErrors((current) => ({ ...current, [kind]: "" }));
    try {
      const data = await request<JobResponse>(`/api/jobs/${id}/generate`, json("POST", { kind, ...body }));
      receive(data, kind === "letter" ? ["letter"] : kind === "answers" ? ["answers"] : []);
      if (kind === "answers") setQuestions("");
    } catch (error) {
      setWriteErrors((current) => ({ ...current, [kind]: (error as Error).message }));
      setWriting((current) => current.filter((item) => item !== kind));
    } finally {
      setBusy((current) => current.filter((item) => item !== kind));
    }
  }

  async function remove() {
    try {
      await request(`/api/jobs/${id}`, { method: "DELETE" });
      lastSaved.current = draftJson;
      router.push("/jobs");
    } catch (error) {
      setSaveError((error as Error).message);
    }
  }

  if (loadError) {
    return (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>Couldn&apos;t open this job</AlertTitle>
        <AlertDescription>
          <p>{loadError}</p>
          <Link href="/jobs" className="underline underline-offset-4">
            Back to all jobs
          </Link>
        </AlertDescription>
      </Alert>
    );
  }
  if (!job || !draft) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </p>
    );
  }

  const set = (field: "title" | "company" | "location" | "url" | "description" | "notes") =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft((current) => current && { ...current, [field]: event.target.value });
  const isWriting = (kind: WriteKind) => writing.includes(kind);
  const parts: PartProps = { job, writing, errors: writeErrors, onWrite: (kind, body) => void write(kind, body), onPatch: patch };
  const pendingQuestions = questions.split("\n").map((line) => line.trim()).filter(Boolean);

  return (
    <div className="grid gap-6">
      {/* The job and where you are with it */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{draft.title || "Untitled job"}</CardTitle>
          <CardDescription>{[draft.company, draft.location].filter(Boolean).join(" · ") || "No company added"}</CardDescription>
          <CardAction className="flex items-center gap-2">
            <SaveState state={saving} />
            <Button size="sm" variant="ghost" onClick={() => setEditingDetails((open) => !open)}>
              <Pencil />
              {editingDetails ? "Done" : "Edit"}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-5">
          {editingDetails && (
            <div className="grid gap-4 rounded-lg border p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="title" label="Job title">
                  <Input id="title" maxLength={200} value={draft.title} onChange={set("title")} />
                </Field>
                <Field id="company" label="Company">
                  <Input id="company" maxLength={200} value={draft.company} onChange={set("company")} />
                </Field>
                <Field id="location" label="Location">
                  <Input id="location" maxLength={200} value={draft.location} onChange={set("location")} />
                </Field>
                <Field id="url" label="Link to the job posting">
                  <Input id="url" type="url" maxLength={2000} value={draft.url} onChange={set("url")} placeholder="https://" />
                </Field>
              </div>
              <Field id="description" label="Job description">
                <Textarea id="description" rows={10} maxLength={20_000} value={draft.description} onChange={set("description")} className="max-h-[32rem]" />
              </Field>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {job.url ? (
              <Button asChild>
                <a href={job.url} target="_blank" rel="noopener noreferrer" onClick={() => setOpenedLink(true)}>
                  <ExternalLink />
                  Open the job to apply
                </a>
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setEditingDetails(true)}>
                <Pencil />
                Add the job link
              </Button>
            )}
            <JobStatusBadge status={job.status} />
          </div>
          {openedLink && job.status === "saved" && (
            <Alert>
              <Check />
              <AlertTitle>Did you apply?</AlertTitle>
              <AlertDescription>
                <p>Mark it as applied to keep track. Nothing is sent anywhere; this only updates your list.</p>
                <Button size="sm" className="mt-2" onClick={() => void patch({ status: "applied" }).then(() => setOpenedLink(false))}>
                  Mark as applied
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-2">
            <Label>Status</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              aria-label="Status"
              className="flex-wrap justify-self-start"
              value={job.status}
              onValueChange={(value) => value && value !== job.status && void patch({ status: value as JobStatus })}
            >
              {JOB_STATUSES.map((status) => (
                <ToggleGroupItem key={status} value={status}>
                  {STATUS_LABELS[status]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
            <Field id="follow-up" label="Next step on">
              <Input
                id="follow-up"
                type="date"
                value={job.followUp ?? ""}
                onChange={(event) => void patch({ followUp: event.target.value || null })}
              />
              <p className="text-xs text-muted-foreground">An interview, or when to follow up.</p>
            </Field>
            <Field id="notes" label="Notes">
              <Textarea
                id="notes"
                rows={3}
                maxLength={10_000}
                value={draft.notes}
                onChange={set("notes")}
                placeholder="Who you spoke to, what to prepare, salary range…"
              />
            </Field>
          </div>

          <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {job.history.map((step, i) => (
              <li key={`${step.status}-${i}`}>
                {STATUS_LABELS[step.status]} {formatDate(step.at)}
              </li>
            ))}
            {job.followUp && <li>Next step {formatDay(job.followUp)}</li>}
          </ol>
          {saveError && <p className="text-sm text-destructive">{saveError}</p>}
        </CardContent>
      </Card>

      <ContactsCard {...parts} />

      {/* How it fits your profile */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="size-4" /> Fit with your profile
          </CardTitle>
          <CardDescription>Compares the job description with your profile. Only what your profile shows counts.</CardDescription>
          {job.fit && (
            <CardAction>
              <MatchBadge match={job.fit.match} />
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="grid gap-4">
          {job.fit && (
            <>
              <p className="text-sm">{job.fit.summary}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid content-start gap-2">
                  <h3 className="text-sm font-medium">Strengths</h3>
                  {job.fit.strengths.length === 0 ? (
                    <p className="text-sm text-muted-foreground">None found in your profile.</p>
                  ) : (
                    <ul className="grid gap-2">
                      {job.fit.strengths.map((item) => (
                        <li key={item.point} className="text-sm">
                          <span className="flex gap-2">
                            <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                            {item.point}
                          </span>
                          <span className="block pl-6 text-xs text-muted-foreground">{item.evidence}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="grid content-start gap-2">
                  <h3 className="text-sm font-medium">Not in your profile</h3>
                  {job.fit.gaps.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No gaps found.</p>
                  ) : (
                    <Gaps gaps={job.fit.gaps} />
                  )}
                  {job.fit.gaps.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      If some of these are true, add them to your profile, then check again.
                    </p>
                  )}
                </div>
              </div>
              <ToCheck items={job.fit.unverified} />
            </>
          )}
          <Keywords keywords={keywords} />
          <WriteButton
            kind="fit"
            done={Boolean(job.fit)}
            writing={isWriting("fit")}
            disabled={!draft.description.trim()}
            label={job.fit ? "Check again" : "Check fit"}
            onClick={() => void write("fit")}
          />
          {!draft.description.trim() && <p className="text-xs text-muted-foreground">Add the job description first (Edit, above).</p>}
          <WriteError message={writeErrors.fit} />
        </CardContent>
      </Card>

      {/* Cover letter */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-4" /> Cover letter
          </CardTitle>
          <CardDescription>Written only from your profile. Read it and make it yours before you send it.</CardDescription>
          {draft.letter && (
            <CardAction className="flex gap-2">
              <CopyButton text={draft.letter} />
              {job.letter && <DownloadButton href={`/api/jobs/${id}/docx?doc=letter`} />}
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="grid gap-4">
          {(draft.letter || job.letter) && (
            <Textarea
              aria-label="Cover letter"
              rows={16}
              maxLength={10_000}
              value={draft.letter}
              onChange={(event) => setDraft((current) => current && { ...current, letter: event.target.value })}
              className="max-h-[40rem] leading-relaxed"
            />
          )}
          {job.letter && job.letter.gaps.length > 0 && (
            <Alert>
              <CircleAlert />
              <AlertTitle>Left out because your profile doesn&apos;t show them</AlertTitle>
              <AlertDescription>
                <Gaps gaps={job.letter.gaps} />
                <p className="mt-1">If any are true, add a line about them yourself.</p>
              </AlertDescription>
            </Alert>
          )}
          {job.letter && <ToCheck items={job.letter.unverified} />}
          <WriteButton
            kind="letter"
            done={Boolean(job.letter)}
            writing={isWriting("letter")}
            disabled={!draft.description.trim()}
            label={job.letter ? "Write a new draft" : "Write cover letter"}
            confirm={job.letter ? "This replaces the letter above, including your edits." : undefined}
            onClick={() => void write("letter")}
          />
          <WriteError message={writeErrors.letter} />
        </CardContent>
      </Card>

      <TailoredCvCard {...parts} />

      {/* Application questions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareText className="size-4" /> Application questions
          </CardTitle>
          <CardDescription>
            Paste the questions from the application form. Answers use only your profile; anything it can&apos;t answer is left
            for you.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {draft.answers.length > 0 && (
            <ul className="grid gap-5">
              {draft.answers.map((item, i) => {
                const saved = job.answers.find((answer) => answer.question === item.question);
                return (
                  <li key={`${i}-${item.question}`} className="grid gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <Label htmlFor={`answer-${i}`} className="leading-snug">
                        {item.question}
                      </Label>
                      <div className="flex shrink-0 gap-1">
                        {item.answer && <CopyButton text={item.answer} small />}
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label="Remove this question"
                          onClick={() =>
                            setDraft((current) => current && { ...current, answers: current.answers.filter((_, j) => j !== i) })
                          }
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                    <Textarea
                      id={`answer-${i}`}
                      rows={4}
                      maxLength={5000}
                      value={item.answer}
                      placeholder="Write this one yourself."
                      onChange={(event) =>
                        setDraft(
                          (current) =>
                            current && {
                              ...current,
                              answers: current.answers.map((answer, j) => (j === i ? { ...answer, answer: event.target.value } : answer)),
                            },
                        )
                      }
                    />
                    {saved?.gap && (
                      <p className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                        <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                        {saved.gap}
                      </p>
                    )}
                    {saved && saved.answer === item.answer && <ToCheck items={saved.unverified} />}
                  </li>
                );
              })}
            </ul>
          )}
          <Field id="questions" label={draft.answers.length > 0 ? "More questions" : "Questions"}>
            <Textarea
              id="questions"
              rows={4}
              value={questions}
              onChange={(event) => setQuestions(event.target.value)}
              placeholder={"One question per line, for example:\nWhy do you want to work here?\nTell us about a project you're proud of."}
            />
          </Field>
          <WriteButton
            kind="answers"
            done={false}
            writing={isWriting("answers")}
            disabled={pendingQuestions.length === 0 || pendingQuestions.length > 10}
            label={pendingQuestions.length > 1 ? `Draft ${pendingQuestions.length} answers` : "Draft answer"}
            onClick={() => void write("answers", { questions: pendingQuestions })}
          />
          {pendingQuestions.length > 10 && <p className="text-xs text-destructive">Ten questions at a time, please.</p>}
          <WriteError message={writeErrors.answers} />
        </CardContent>
      </Card>

      <InterviewCard {...parts} />
      <EmailCard {...parts} />
      <OfferCard {...parts} />

      <div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" className="text-destructive hover:text-destructive">
              <Trash2 />
              Delete this job
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this job?</AlertDialogTitle>
              <AlertDialogDescription>
                Its notes, cover letter and answers are deleted too. This only removes it from Draftfox.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void remove()}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

