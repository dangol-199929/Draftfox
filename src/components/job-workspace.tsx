"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  FileText,
  ListChecks,
  Loader2,
  MessageSquareText,
  Pencil,
  Sparkles,
  Trash2,
} from "lucide-react";
import { FitScore, formatAge, formatDate, formatDay, JobStatusBadge, MatchBadge, STATUS_LABELS } from "@/components/job-badges";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { JobAnswer, JobRecord } from "@/lib/db.ts";
import { DEFAULT_JOB_SETTINGS, JOB_STATUSES, keywordScore, PREPARE_OPTIONS, type JobSettings, type JobStatus } from "@/lib/job-status.ts";
import { cn } from "@/lib/utils";

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

// onDeleted replaces going back to /jobs after you delete the job (the Find jobs drawer closes instead).
// onChange hears about every change to the job (its status, say), so a list next to it can stay up to date.
// prepareOnOpen starts Prepare application as soon as the job has loaded.
export function JobWorkspace({
  id,
  onDeleted,
  onChange,
  prepareOnOpen = false,
}: {
  id: string;
  onDeleted?: () => void;
  onChange?: (job: JobRecord) => void;
  prepareOnOpen?: boolean;
}) {
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
  const [settings, setSettings] = useState<JobSettings | null>(null);
  const [kitTab, setKitTab] = useState("letter");
  const [preparing, setPreparing] = useState(false);
  const [showDescription, setShowDescription] = useState(false);

  useEffect(() => {
    fetch("/api/settings/jobs")
      .then((response) => response.json() as Promise<{ settings: JobSettings }>)
      .then((data) => setSettings(data.settings))
      .catch(() => setSettings(DEFAULT_JOB_SETTINGS));
  }, []);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    if (job) onChangeRef.current?.(job);
  }, [job]);

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
      if (onDeleted) onDeleted();
      else router.push("/jobs");
    } catch (error) {
      setSaveError((error as Error).message);
    }
  }

  // Prepare application: writes what the Settings page says (cover letter; and CV; and fit and interview
  // questions), skipping drafts the job already has so your edits stay.
  async function prepare() {
    if (!job || preparing) return;
    const makes = (settings ?? DEFAULT_JOB_SETTINGS).prepareMakes;
    setPreparing(true);
    setKitTab("letter");
    try {
      if (makes === "everything" && !job.fit) await write("fit");
      const kinds: WriteKind[] = [];
      if (!job.letter) kinds.push("letter");
      if (makes !== "letter" && !job.tailoredCv) kinds.push("cv");
      if (makes === "everything" && !job.interview) kinds.push("interview");
      await Promise.all(kinds.map((kind) => write(kind)));
    } finally {
      setPreparing(false);
    }
  }

  // Once the job and the settings are in: Prepare application if asked to, or start the cover letter when the
  // Settings page says so. Only once per opening.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !job || !settings || !job.description.trim()) return;
    started.current = true;
    if (prepareOnOpen) void prepare();
    else if (settings.autoLetter && job.status === "saved" && !job.letter && !writing.includes("letter")) void write("letter");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, when both have loaded
  }, [job, settings]);

  async function markApplied() {
    await patch({ status: "applied" });
    setOpenedLink(false);
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

  const fit = keywordScore(keywords ?? { found: [], missing: [] });
  const makes = PREPARE_OPTIONS.find((option) => option.value === (settings ?? DEFAULT_JOB_SETTINGS).prepareMakes)!;
  const prepareDone =
    Boolean(job.letter) &&
    (makes.value === "letter" || Boolean(job.tailoredCv)) &&
    (makes.value !== "everything" || Boolean(job.interview));
  const kitWriting = (["letter", "cv", "interview", "fit"] as WriteKind[]).filter(isWriting);
  const applied = job.status !== "saved";
  const longDescription = draft.description.length > 600;

  return (
    <div className="grid gap-6">
      {/* The job and where you are with it */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg leading-snug">{draft.title || "Untitled job"}</CardTitle>
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
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            <JobStatusBadge status={job.status} />
            <FitScore score={fit} />
            {job.salary && <span className="font-medium text-foreground">{job.salary}</span>}
            {job.postedAt && <span>Posted {formatAge(job.postedAt)}</span>}
            {job.source && <span>via {job.source}</span>}
          </div>

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
              <Button asChild variant="outline">
                <a href={job.url} target="_blank" rel="noopener noreferrer" onClick={() => setOpenedLink(true)}>
                  <ExternalLink />
                  Open job page
                </a>
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setEditingDetails(true)}>
                <Pencil />
                Add the job link
              </Button>
            )}
            <Button
              disabled={preparing || kitWriting.length > 0 || prepareDone || !draft.description.trim()}
              onClick={() => void prepare()}
              title={`Writes: ${makes.label.toLowerCase()} (change this on the Settings page)`}
            >
              {preparing || kitWriting.length > 0 ? <Loader2 className="animate-spin" /> : prepareDone ? <Check /> : <Sparkles />}
              {preparing || kitWriting.length > 0 ? "Preparing…" : prepareDone ? "Application ready" : "Prepare application"}
            </Button>
            {job.status === "saved" && (
              <Button variant="outline" onClick={() => void markApplied()}>
                <Check />
                Mark applied
              </Button>
            )}
          </div>
          {(preparing || kitWriting.length > 0) && (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              Writing {kitWriting.map((kind) => ({ fit: "the fit check", letter: "the cover letter", cv: "your CV for this job", interview: "interview questions" })[kind as "fit"]).join(", ") || "…"} from
              your profile. This can take a minute; you can keep working.
            </p>
          )}
          {!draft.description.trim() && (
            <p className="text-xs text-muted-foreground">Add the job description (Edit, above) to prepare an application.</p>
          )}
          {openedLink && job.status === "saved" && (
            <Alert>
              <Check />
              <AlertTitle>Did you apply?</AlertTitle>
              <AlertDescription>
                <p>Mark it as applied to keep track. Nothing is sent anywhere; this only updates your list.</p>
                <Button size="sm" className="mt-2" onClick={() => void markApplied()}>
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

      {/* Application kit: what you send */}
      <section className="grid gap-3" aria-labelledby={`kit-${id}`}>
        <h2 id={`kit-${id}`} className="text-sm font-medium text-muted-foreground">
          Application kit
        </h2>
        <Tabs value={kitTab} onValueChange={setKitTab}>
          <TabsList>
            <TabsTrigger value="letter">
              {isWriting("letter") ? <Loader2 className="animate-spin" /> : job.letter && <Check />}
              Cover letter
            </TabsTrigger>
            <TabsTrigger value="cv">
              {isWriting("cv") ? <Loader2 className="animate-spin" /> : job.tailoredCv && <Check />}
              CV
            </TabsTrigger>
            <TabsTrigger value="answers">
              {isWriting("answers") ? <Loader2 className="animate-spin" /> : job.answers.length > 0 && <Check />}
              Answers
            </TabsTrigger>
          </TabsList>

          <TabsContent value="letter">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="size-4" /> Cover letter
                </CardTitle>
                <CardDescription>Written only from your profile. Read it and make it yours before you send it.</CardDescription>
                {draft.letter && (
                  <CardAction className="flex gap-2">
                    <CopyButton text={draft.letter} />
                    {job.letter && <DownloadButton href={`/api/jobs/${id}/docx?doc=letter`} label=".docx" />}
                  </CardAction>
                )}
              </CardHeader>
              <CardContent className="grid gap-4">
                {isWriting("letter") && !draft.letter && <WritingPlaceholder what="your cover letter" />}
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
          </TabsContent>

          <TabsContent value="cv">
            <TailoredCvCard {...parts} />
          </TabsContent>

          <TabsContent value="answers">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquareText className="size-4" /> Application questions
                </CardTitle>
                <CardDescription>
                  Paste the questions from the application form. Answers use only your profile; anything it can&apos;t
                  answer is left for you.
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
                            <Label htmlFor={`answer-${id}-${i}`} className="leading-snug">
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
                            id={`answer-${id}-${i}`}
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
                <Field id={`questions-${id}`} label={draft.answers.length > 0 ? "More questions" : "Questions"}>
                  <Textarea
                    id={`questions-${id}`}
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
          </TabsContent>
        </Tabs>
      </section>

      {/* About the job: the posting, its keywords, how it fits, your notes */}
      <section className="grid gap-3" aria-labelledby={`about-${id}`}>
        <h2 id={`about-${id}`} className="text-sm font-medium text-muted-foreground">
          About the job
        </h2>
        <Card>
          <CardContent className="grid gap-5">
            <div className="grid gap-2">
              <h3 className="text-sm font-medium">Job description</h3>
              {draft.description.trim() ? (
                <>
                  <p className={cn("text-sm whitespace-pre-line", !showDescription && longDescription && "line-clamp-6")}>
                    {draft.description}
                  </p>
                  {longDescription && (
                    <button
                      type="button"
                      aria-expanded={showDescription}
                      onClick={() => setShowDescription((open) => !open)}
                      className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {showDescription ? "Show less" : "Show the whole description"}
                      <ChevronDown className={cn("size-3.5 transition-transform", showDescription && "rotate-180")} />
                    </button>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No description yet. Paste it with Edit, above.</p>
              )}
            </div>
            <Keywords keywords={keywords} />
            <div className="grid gap-4 border-t pt-4 sm:grid-cols-[14rem_1fr]">
              <Field id={`follow-up-${id}`} label="Next step on">
                <Input
                  id={`follow-up-${id}`}
                  type="date"
                  value={job.followUp ?? ""}
                  onChange={(event) => void patch({ followUp: event.target.value || null })}
                />
                <p className="text-xs text-muted-foreground">An interview, or when to follow up.</p>
              </Field>
              <Field id={`notes-${id}`} label="Notes">
                <Textarea
                  id={`notes-${id}`}
                  rows={3}
                  maxLength={10_000}
                  value={draft.notes}
                  onChange={set("notes")}
                  placeholder="Who you spoke to, what to prepare, salary range…"
                />
              </Field>
            </div>
          </CardContent>
        </Card>

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
                    {job.fit.gaps.length === 0 ? <p className="text-sm text-muted-foreground">No gaps found.</p> : <Gaps gaps={job.fit.gaps} />}
                    {job.fit.gaps.length > 0 && (
                      <p className="text-xs text-muted-foreground">If some of these are true, add them to your profile, then check again.</p>
                    )}
                  </div>
                </div>
                <ToCheck items={job.fit.unverified} />
              </>
            )}
            <WriteButton
              kind="fit"
              done={Boolean(job.fit)}
              writing={isWriting("fit")}
              disabled={!draft.description.trim()}
              label={job.fit ? "Check again" : "Check fit"}
              onClick={() => void write("fit")}
            />
            <WriteError message={writeErrors.fit} />
          </CardContent>
        </Card>
      </section>

      {/* After applying: interviews, follow-ups, people and the offer */}
      <section className="grid gap-3" aria-labelledby={`after-${id}`}>
        <h2 id={`after-${id}`} className="text-sm font-medium text-muted-foreground">
          After applying
        </h2>
        {applied ? (
          <>
            <InterviewCard {...parts} />
            <EmailCard {...parts} />
            <ContactsCard {...parts} />
            <OfferCard {...parts} />
          </>
        ) : (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            Once you mark it applied, interview prep, follow-up emails, contacts and offer details show up here.
            {job.interview && " Your interview questions are already prepared."}
          </p>
        )}
      </section>

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

// Shown in place of a draft while the model writes it.
function WritingPlaceholder({ what }: { what: string }) {
  return (
    <div className="grid gap-2" aria-live="polite">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Writing {what} from your profile…
      </p>
      <div className="grid gap-2">
        {[92, 100, 85, 96, 60].map((width, i) => (
          <div key={i} className="h-3 animate-pulse rounded bg-muted" style={{ width: `${width}%` }} />
        ))}
      </div>
    </div>
  );
}
