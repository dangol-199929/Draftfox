"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ban,
  Check,
  Clapperboard,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  Film,
  ImageIcon,
  ListPlus,
  Loader2,
  Mic,
  RefreshCw,
  RotateCcw,
  Save,
  ScrollText,
  Subtitles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TopicIdeas } from "@/components/video-topics";
import { toast } from "@/components/ui/toaster";
import type { GpuLease } from "@/lib/gpu-lock.ts";
import type { CaptionGroup, VideoEvent, VideoJob, VideoStatus, WorkerStatus } from "@/lib/video-jobs.ts";
import type { VideoPublication } from "@/lib/video-publications.ts";
import { VIDEO_LENGTH, WORDS_PER_SECOND } from "@/lib/video-length.ts";
import { cn } from "@/lib/utils";

type Tone = "brand" | "success" | "warning" | "info" | "muted" | "destructive";

const STATUS: Record<VideoStatus, { label: string; tone: Tone }> = {
  WAITING: { label: "Waiting", tone: "muted" },
  GENERATING_SCRIPT: { label: "Writing script", tone: "info" },
  GENERATING_VISUALS: { label: "Drawing scenes", tone: "info" },
  GENERATING_AUDIO: { label: "Recording voice", tone: "info" },
  RENDERING: { label: "Rendering", tone: "info" },
  QUALITY_CHECK: { label: "Checking", tone: "info" },
  AWAITING_APPROVAL: { label: "Ready for review", tone: "brand" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "muted" },
  FAILED: { label: "Failed", tone: "destructive" },
  RETRYING: { label: "Retrying", tone: "warning" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
};
const RUNNING: VideoStatus[] = ["GENERATING_SCRIPT", "GENERATING_VISUALS", "GENERATING_AUDIO", "RENDERING", "QUALITY_CHECK"];
const ACTIVE: VideoStatus[] = [...RUNNING, "WAITING", "RETRYING"];
const STAGE_NAMES = ["script", "visuals", "audio", "render", "qc"] as const;

type WorkerInfo = { worker: (WorkerStatus & { online: boolean }) | null; gpu: { lease: GpuLease | null; waiting: number } };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

function fileUrl(job: VideoJob, name: string, download = false) {
  return `/api/video/jobs/${job.id}/file/${name}?v=${encodeURIComponent(job.updatedAt)}${download ? "&download=1" : ""}`;
}

function since(iso: string) {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function VideoStudio() {
  const [jobs, setJobs] = useState<VideoJob[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [worker, setWorker] = useState<WorkerInfo | null>(null);
  const [loadError, setLoadError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [list, status] = await Promise.all([
        api<{ jobs: VideoJob[] }>("/api/video/jobs"),
        api<WorkerInfo>("/api/video/worker"),
      ]);
      setJobs(list.jobs);
      setWorker(status);
      setLoadError("");
      setSelected((current) => current ?? list.jobs[0]?.id ?? null);
    } catch (error) {
      setLoadError((error as Error).message);
    }
  }, []);

  const busy = jobs?.some((job) => ACTIVE.includes(job.status)) ?? false;
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), busy ? 3000 : 15000);
    return () => clearInterval(timer);
  }, [refresh, busy]);

  const job = jobs?.find((item) => item.id === selected) ?? null;

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <AddTopics
          onAdded={(added) => {
            setSelected(added[0]?.id ?? null);
            void refresh();
          }}
        />
        <WorkerCard info={worker} />
      </div>
      <TopicIdeas
        onMade={(job) => {
          setSelected(job.id);
          void refresh();
        }}
      />
      {loadError && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load the videos</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <JobList jobs={jobs} selected={selected} onSelect={setSelected} />
        {job ? (
          <JobDetail key={job.id} job={job} onChanged={refresh} onDeleted={() => { setSelected(null); void refresh(); }} />
        ) : (
          <Card>
            <CardContent className="grid place-items-center gap-2 py-16 text-center text-sm text-muted-foreground">
              <Clapperboard className="size-6" />
              {jobs?.length ? "Pick a video to see it." : "Add a topic above to make your first video."}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function AddTopics({ onAdded }: { onAdded: (jobs: VideoJob[]) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const topics = text.split("\n").map((line) => line.trim()).filter(Boolean);

  async function add() {
    setBusy(true);
    try {
      const { jobs } = await api<{ jobs: VideoJob[] }>("/api/video/jobs", { method: "POST", body: JSON.stringify({ topics }) });
      toast(jobs.length === 1 ? "Added to the queue" : `Added ${jobs.length} videos to the queue`);
      setText("");
      onAdded(jobs);
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListPlus className="size-4 text-muted-foreground" />
          New videos
        </CardTitle>
        <CardDescription>
          One topic per line. Each becomes a {VIDEO_LENGTH.seconds}-second vertical video: script, scene images, voice, captions and music,
          made on this PC. Nothing is posted anywhere.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={"Why sleep makes you a better programmer\nWhat CSS grid is, explained simply"}
          rows={3}
          aria-label="Video topics"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {topics.length ? `${topics.length} topic${topics.length === 1 ? "" : "s"}` : "Up to 20 at a time"}
          </p>
          <Button size="sm" disabled={busy || !topics.length} onClick={add}>
            {busy ? <Loader2 className="animate-spin" /> : <ListPlus />}
            Add to queue
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkerCard({ info }: { info: WorkerInfo | null }) {
  const worker = info?.worker;
  const lease = info?.gpu.lease;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="size-4 text-muted-foreground" />
          Worker
        </CardTitle>
        <CardDescription>Makes the videos one at a time.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {!info ? (
          <span className="skeleton h-12 rounded-lg" />
        ) : !worker ? (
          <p className="text-muted-foreground">The worker hasn&apos;t started yet. Run it on this PC (see worker/README.md).</p>
        ) : (
          <>
            <p className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn("size-2 rounded-full", worker.online ? "bg-success" : "bg-muted-foreground/50")}
              />
              <span className="font-medium">{worker.online ? "Online" : "Offline"}</span>
              <span className="text-muted-foreground">· last seen {since(worker.lastHeartbeat)}</span>
            </p>
            {worker.online && (
              <p className="text-muted-foreground">
                {worker.jobId ? `Working: ${worker.stage ?? "starting"}` : "Idle, waiting for videos"}
              </p>
            )}
            {worker.gpu && <p className="truncate text-xs text-muted-foreground" title={worker.gpu}>{worker.gpu}</p>}
            {worker.freeDiskGb !== null && <p className="text-xs text-muted-foreground">{worker.freeDiskGb} GB free on disk</p>}
          </>
        )}
        {lease && (
          <p className="text-xs text-muted-foreground">
            Graphics card: <span className="text-foreground">{lease.purpose}</span>
            {info?.gpu.waiting ? ` (${info.gpu.waiting} waiting)` : ""}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: VideoStatus }) {
  const { label, tone } = STATUS[status];
  return (
    <Badge variant={tone} className="gap-1">
      {RUNNING.includes(status) && <Loader2 className="animate-spin" />}
      {label}
    </Badge>
  );
}

function stageProgress(job: VideoJob) {
  const done = job.completedStages.length;
  return Math.min(1, (done + (RUNNING.includes(job.status) ? job.progress : 0)) / STAGE_NAMES.length);
}

function JobList({ jobs, selected, onSelect }: { jobs: VideoJob[] | null; selected: string | null; onSelect: (id: string) => void }) {
  if (!jobs) return <span className="skeleton h-64 rounded-xl" />;
  return (
    <ul className="grid content-start gap-2" aria-label="Videos">
      {jobs.map((job) => (
        <li key={job.id}>
          <button
            type="button"
            onClick={() => onSelect(job.id)}
            aria-current={job.id === selected ? "true" : undefined}
            className={cn(
              "grid w-full gap-2 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/60",
              job.id === selected && "ring-2 ring-brand/60",
            )}
          >
            <span className="line-clamp-2 text-sm font-medium">{job.script?.title ?? job.topic}</span>
            <span className="flex items-center justify-between gap-2">
              <StatusBadge status={job.status} />
              <span className="text-xs text-muted-foreground">{since(job.createdAt)}</span>
            </span>
            {ACTIVE.includes(job.status) && (
              <span className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span className="block h-full rounded-full bg-primary transition-[width]" style={{ width: `${stageProgress(job) * 100}%` }} />
              </span>
            )}
          </button>
        </li>
      ))}
      {!jobs.length && <li className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No videos yet.</li>}
    </ul>
  );
}

function JobDetail({ job, onChanged, onDeleted }: { job: VideoJob; onChanged: () => Promise<void>; onDeleted: () => void }) {
  const [events, setEvents] = useState<VideoEvent[]>([]);
  const [publications, setPublications] = useState<VideoPublication[]>([]);
  const [busy, setBusy] = useState("");
  const running = RUNNING.includes(job.status);
  const locked = running || busy !== "";

  useEffect(() => {
    api<{ events: VideoEvent[]; publications: VideoPublication[] }>(`/api/video/jobs/${job.id}`)
      .then((body) => {
        setEvents(body.events);
        setPublications(body.publications ?? []);
      })
      .catch(() => {});
  }, [job.id, job.updatedAt]);

  async function act(label: string, body: object, done?: string) {
    setBusy(label);
    try {
      await api(`/api/video/jobs/${job.id}`, { method: "PATCH", body: JSON.stringify(body) });
      if (done) toast(done);
      await onChanged();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy("");
    }
  }

  async function remove() {
    if (!window.confirm("Delete this video and its files?")) return;
    setBusy("delete");
    try {
      await api(`/api/video/jobs/${job.id}`, { method: "DELETE" });
      toast("Deleted");
      onDeleted();
    } catch (error) {
      toast((error as Error).message, "error");
      setBusy("");
    }
  }

  const hasVideo = Boolean(job.outputPath && job.completedStages.includes("render"));
  const youtube = publications.find((publication) => publication.platform === "youtube");
  const timings = job.assets.timings as Record<string, number> | undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Film className="size-4 text-muted-foreground" />
          <span className="min-w-0">{job.script?.title ?? job.topic}</span>
          <StatusBadge status={job.status} />
        </CardTitle>
        <CardDescription>{job.topic}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {job.status === "FAILED" && job.error && (
          <Alert variant="destructive">
            <AlertTitle>Stopped at the {job.stage} step</AlertTitle>
            <AlertDescription>{job.error}</AlertDescription>
          </Alert>
        )}
        {ACTIVE.includes(job.status) && (
          <ol className="flex flex-wrap gap-1.5 text-xs" aria-label="Steps">
            {STAGE_NAMES.map((stage) => (
              <li
                key={stage}
                className={cn(
                  "rounded-md border px-2 py-0.5 text-muted-foreground",
                  job.completedStages.includes(stage) && "border-success/30 bg-success-soft text-success",
                  job.stage === stage && running && "border-info/30 bg-info-soft text-info",
                )}
              >
                {stage === "qc" ? "check" : stage}
                {job.stage === stage && running ? ` ${Math.round(job.progress * 100)}%` : ""}
              </li>
            ))}
          </ol>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
          <div className="grid content-start gap-3">
            <div className="aspect-[9/16] w-full max-w-60 overflow-hidden rounded-xl border bg-muted">
              {hasVideo ? (
                <video key={job.updatedAt} src={fileUrl(job, "video.mp4")} controls playsInline preload="metadata" className="size-full bg-black object-contain" />
              ) : (
                <div className="grid size-full place-items-center p-4 text-center text-xs text-muted-foreground">
                  {ACTIVE.includes(job.status) ? "The video appears here when it's rendered." : "No video yet."}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {job.status === "AWAITING_APPROVAL" && (
                <>
                  <Button size="sm" disabled={locked} onClick={() => act("approve", { action: "approve" }, "Approved")}>
                    <Check />
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={locked} onClick={() => act("reject", { action: "reject" }, "Rejected")}>
                    <X />
                    Reject
                  </Button>
                </>
              )}
              {hasVideo && (
                <Button size="sm" variant="outline" asChild>
                  <a href={fileUrl(job, "video.mp4", true)} download>
                    <Download />
                    MP4
                  </a>
                </Button>
              )}
              {["FAILED", "CANCELLED", "REJECTED"].includes(job.status) && (
                <Button size="sm" variant="outline" disabled={locked} onClick={() => act("retry", { action: "retry" }, "Queued again")}>
                  <RotateCcw />
                  Try again
                </Button>
              )}
              {ACTIVE.includes(job.status) && (
                <Button size="sm" variant="outline" disabled={busy !== ""} onClick={() => act("cancel", { action: "cancel" }, "Cancelled")}>
                  <Ban />
                  Cancel
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={busy !== ""} onClick={remove} aria-label="Delete video">
                <Trash2 />
              </Button>
            </div>
            {timings && (
              <p className="text-xs text-muted-foreground">
                Times: {Object.entries(timings).map(([stage, seconds]) => `${stage === "qc" ? "check" : stage} ${seconds} s`).join(" · ")}
              </p>
            )}
          </div>

          {job.script ? (
            <Tabs defaultValue="script">
              <TabsList>
                <TabsTrigger value="script"><ScrollText />Script</TabsTrigger>
                <TabsTrigger value="scenes"><ImageIcon />Scenes</TabsTrigger>
                <TabsTrigger value="captions"><Subtitles />Captions</TabsTrigger>
                <TabsTrigger value="log">Log</TabsTrigger>
              </TabsList>
              {/* Keyed on updatedAt so they reload when the worker changes the job (they're locked while it runs). */}
              <TabsContent value="script">
                <ScriptEditor key={job.updatedAt} job={job} locked={locked} act={act} />
              </TabsContent>
              <TabsContent value="scenes">
                <SceneEditor key={job.updatedAt} job={job} locked={locked} act={act} />
              </TabsContent>
              <TabsContent value="captions">
                <CaptionEditor key={job.updatedAt} job={job} locked={locked} act={act} />
              </TabsContent>
              <TabsContent value="log">
                <EventLog events={events} />
              </TabsContent>
            </Tabs>
          ) : (
            <div className="grid content-start gap-3">
              <p className="text-sm text-muted-foreground">The script is written first; then you can edit it here.</p>
              <EventLog events={events} />
            </div>
          )}
        </div>

        {(job.status === "APPROVED" || youtube?.status === "uploaded") && hasVideo && job.script && (
          <YouTubeUpload
            key={job.id}
            job={job}
            publication={youtube}
            onDone={async (next) => {
              setPublications(next);
              await onChanged();
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

const PRIVACY = [
  { value: "private", label: "Private", hint: "Only you can see it." },
  { value: "unlisted", label: "Unlisted", hint: "Anyone with the link can see it." },
  { value: "public", label: "Public", hint: "Everyone can find and see it." },
] as const;

// The upload form for an approved video, or its YouTube link once it's uploaded. Privacy has no default on purpose.
function YouTubeUpload({
  job,
  publication,
  onDone,
}: {
  job: VideoJob;
  publication: VideoPublication | undefined;
  onDone: (publications: VideoPublication[]) => Promise<void>;
}) {
  const script = job.script!;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(script.title.slice(0, 100));
  const [description, setDescription] = useState(
    [script.post_caption, script.hashtags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" ")].filter(Boolean).join("\n\n"),
  );
  const [tags, setTags] = useState(script.hashtags.map((tag) => tag.replace(/^#/, "")).join(", "));
  const [privacy, setPrivacy] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  if (publication?.status === "uploaded" && publication.url) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-success/25 bg-success-soft p-3 text-sm text-success">
        <Check className="size-4" />
        On YouTube:
        <a href={publication.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium underline underline-offset-2">
          {publication.url}
          <ExternalLink className="size-3.5" />
        </a>
      </div>
    );
  }

  const lastError = error || (publication?.status === "failed" ? publication.error ?? "" : "");
  const needsReconnect = /reconnect/i.test(lastError);

  async function upload() {
    const choice = PRIVACY.find((option) => option.value === privacy);
    if (!choice) return;
    if (!window.confirm(`Upload "${title}" to YouTube as ${choice.label}?`)) return;
    setUploading(true);
    setError("");
    try {
      const response = await fetch(`/api/video/jobs/${job.id}/youtube`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean), privacy }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; publications?: VideoPublication[] };
      if (body.publications) await onDone(body.publications);
      if (!response.ok) throw new Error(body.error ?? `Upload failed (${response.status})`);
      toast("Uploaded to YouTube");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  if (!open) {
    return (
      <div className="grid gap-2">
        <div>
          <Button size="sm" onClick={() => setOpen(true)} disabled={publication?.status === "uploading"}>
            <Upload />
            {publication?.status === "uploading" ? "Uploading to YouTube…" : "Upload to YouTube"}
          </Button>
        </div>
        {lastError && <UploadError message={lastError} needsReconnect={needsReconnect} />}
      </div>
    );
  }

  return (
    <div className="grid gap-4 rounded-lg border p-4">
      <p className="text-sm font-medium">Upload to YouTube</p>
      <div className="grid gap-2">
        <Label htmlFor="yt-title">Title</Label>
        <Input id="yt-title" maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} disabled={uploading} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="yt-description">Description</Label>
        <Textarea id="yt-description" rows={4} maxLength={5000} value={description} onChange={(event) => setDescription(event.target.value)} disabled={uploading} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="yt-tags">Tags (separated by commas)</Label>
        <Input id="yt-tags" value={tags} onChange={(event) => setTags(event.target.value)} disabled={uploading} />
      </div>
      <div className="grid gap-2">
        <Label>Visibility</Label>
        <ToggleGroup type="single" variant="outline" aria-label="Visibility" value={privacy} onValueChange={setPrivacy} disabled={uploading}>
          {PRIVACY.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value}>
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          {PRIVACY.find((option) => option.value === privacy)?.hint ?? "Pick one before uploading."} The video is marked as
          made with AI (altered or synthetic content) and not made for kids.
        </p>
      </div>
      {lastError && <UploadError message={lastError} needsReconnect={needsReconnect} />}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={upload} disabled={uploading || !privacy || !title.trim()}>
          {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
          {uploading ? "Uploading…" : "Upload"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={uploading}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function UploadError({ message, needsReconnect }: { message: string; needsReconnect: boolean }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>YouTube upload failed</AlertTitle>
      <AlertDescription>
        {message}
        {needsReconnect && (
          <>
            {" "}
            <a href="/settings#youtube" className="font-medium underline underline-offset-2">
              Open Settings › YouTube
            </a>
          </>
        )}
      </AlertDescription>
    </Alert>
  );
}

type Act =(label: string, body: object, done?: string) => Promise<void>;

function ScriptEditor({ job, locked, act }: { job: VideoJob; locked: boolean; act: Act }) {
  const script = job.script!;
  const [title, setTitle] = useState(script.title);
  const [narration, setNarration] = useState(script.narration);
  const [caption, setCaption] = useState(script.post_caption);
  const [hashtags, setHashtags] = useState(script.hashtags.join(" "));
  const words = narration.trim().split(/\s+/).filter(Boolean).length;
  const edits = {
    title,
    narration,
    post_caption: caption,
    hashtags: hashtags.split(/[\s,]+/).filter(Boolean),
    scenes: job.scenes.map((scene) => ({ image_prompt: scene.image_prompt, on_screen_text: scene.on_screen_text })),
  };
  const narrationChanged = narration.trim() !== script.narration;

  async function copyCaption() {
    await navigator.clipboard.writeText(`${caption}\n\n${hashtags}`.trim());
    toast("Caption copied");
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="video-title">Title</Label>
        <Input id="video-title" value={title} onChange={(event) => setTitle(event.target.value)} disabled={locked} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="video-narration">Narration</Label>
        <Textarea id="video-narration" rows={4} value={narration} onChange={(event) => setNarration(event.target.value)} disabled={locked} />
        <p className={cn("text-xs text-muted-foreground", (words < VIDEO_LENGTH.words.min - 4 || words > VIDEO_LENGTH.words.max + 4) && "text-warning")}>
          {words} words · about {Math.round(words / WORDS_PER_SECOND)} s spoken (aim for about {VIDEO_LENGTH.words.target} words, under {VIDEO_LENGTH.maxSpokenSeconds} s)
          {job.assets.narration_seconds ? ` · recorded: ${job.assets.narration_seconds as number} s` : ""}
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="video-caption">Post caption</Label>
        <Textarea id="video-caption" rows={2} value={caption} onChange={(event) => setCaption(event.target.value)} disabled={locked} />
        <Input value={hashtags} onChange={(event) => setHashtags(event.target.value)} disabled={locked} aria-label="Hashtags" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={locked} onClick={() => act("save", { action: "edit", script: edits }, "Saved")}>
          <Save />
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={locked || !job.completedStages.includes("audio")}
          onClick={async () => {
            await act("save", { action: "edit", script: edits });
            await act("narration", { action: "redo", what: "narration" }, "Recording the narration again");
          }}
          title={narrationChanged ? "Save the new narration and record it again" : "Record the narration again"}
        >
          <Mic />
          {narrationChanged ? "Save and re-record voice" : "Re-record voice"}
        </Button>
        <Button size="sm" variant="ghost" disabled={locked} onClick={() => act("script", { action: "redo", what: "script" }, "Starting over")}>
          <RefreshCw />
          New script
        </Button>
        <Button size="sm" variant="ghost" onClick={copyCaption}>
          <Copy />
          Copy caption
        </Button>
      </div>
    </div>
  );
}

function SceneEditor({ job, locked, act }: { job: VideoJob; locked: boolean; act: Act }) {
  const [prompts, setPrompts] = useState(() => job.scenes.map((scene) => scene.image_prompt));
  const files = (job.assets.files ?? {}) as Record<string, string>;

  function edits() {
    const script = job.script!;
    return {
      title: script.title,
      narration: script.narration,
      post_caption: script.post_caption,
      hashtags: script.hashtags,
      scenes: job.scenes.map((scene, index) => ({ image_prompt: prompts[index], on_screen_text: scene.on_screen_text })),
    };
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {job.scenes.map((scene, index) => (
        <div key={index} className="grid content-start gap-2">
          <div className="aspect-[9/16] overflow-hidden rounded-lg border bg-muted">
            {files[`scene-${index + 1}`] ? (
              // eslint-disable-next-line @next/next/no-img-element -- generated file served by the API
              <img src={fileUrl(job, `scene-${index + 1}.png`)} alt={`Scene ${index + 1}`} className="size-full object-cover" />
            ) : (
              <div className="grid size-full place-items-center text-xs text-muted-foreground">Not drawn yet</div>
            )}
          </div>
          <Label htmlFor={`scene-${index}`}>Scene {index + 1}</Label>
          <Textarea
            id={`scene-${index}`}
            rows={4}
            value={prompts[index]}
            onChange={(event) => setPrompts((current) => current.map((value, i) => (i === index ? event.target.value : value)))}
            disabled={locked}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={locked || !job.completedStages.includes("visuals")}
            onClick={async () => {
              await act("save", { action: "edit", script: edits() });
              await act(`scene-${index}`, { action: "redo", what: "scene", scene: index }, `Drawing scene ${index + 1} again`);
            }}
          >
            <RefreshCw />
            Draw again
          </Button>
        </div>
      ))}
    </div>
  );
}

function CaptionEditor({ job, locked, act }: { job: VideoJob; locked: boolean; act: Act }) {
  const groups = useMemo(() => (job.assets.caption_groups as CaptionGroup[] | undefined) ?? [], [job.assets.caption_groups]);
  const [texts, setTexts] = useState(() => groups.map((group) => group.text));
  if (!groups.length) return <p className="text-sm text-muted-foreground">Captions are made with the voice.</p>;
  return (
    <div className="grid gap-3">
      <ol className="grid gap-1.5">
        {groups.map((group, index) => (
          <li key={index} className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums">
              {group.start.toFixed(1)}–{group.end.toFixed(1)} s
            </span>
            <Input
              value={texts[index] ?? ""}
              onChange={(event) => setTexts((current) => current.map((value, i) => (i === index ? event.target.value : value)))}
              disabled={locked}
              aria-label={`Caption ${index + 1}`}
            />
          </li>
        ))}
      </ol>
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={locked || !job.completedStages.includes("render")}
          onClick={async () => {
            await act("save", { action: "edit", captions: texts.map((text) => ({ text })) });
            await act("render", { action: "redo", what: "render" }, "Rendering again with your captions");
          }}
        >
          <Film />
          Save and re-render
        </Button>
      </div>
    </div>
  );
}

function EventLog({ events }: { events: VideoEvent[] }) {
  if (!events.length) return <p className="text-sm text-muted-foreground">Nothing yet.</p>;
  return (
    <ol className="grid max-h-80 gap-1 overflow-y-auto rounded-lg border p-3 font-mono text-xs">
      {events.map((event) => (
        <li key={event.id} className={cn("flex gap-2", event.level === "error" && "text-destructive")}>
          <span className="shrink-0 text-muted-foreground tabular-nums">{new Date(event.at).toLocaleTimeString()}</span>
          <span>{event.message}</span>
        </li>
      ))}
    </ol>
  );
}
