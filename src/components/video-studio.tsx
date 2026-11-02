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
  Play,
  RotateCcw,
  Save,
  ScrollText,
  Settings2,
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TopicIdeas } from "@/components/video-topics";
import { VideoSettingsForm } from "@/components/video-settings-form";
import { toast } from "@/components/ui/toaster";
import type { GpuLease } from "@/lib/gpu-lock.ts";
import type { CaptionGroup, VideoEvent, VideoJob, VideoStatus, WorkerStatus } from "@/lib/video-jobs.ts";
import type { VideoPublication } from "@/lib/video-publications.ts";
import { VIDEO_LENGTH, WORDS_PER_SECOND } from "@/lib/video-length.ts";
import { DEFAULT_VIDEO_SETTINGS, normalizeVideoSettings, settingsRedo, type VideoSettings } from "@/lib/video-settings.ts";
import { cn } from "@/lib/utils";

type Tone = "brand" | "success" | "warning" | "info" | "muted" | "destructive";

const STATUS: Record<VideoStatus, { label: string; tone: Tone }> = {
  UPLOADING: { label: "Uploading", tone: "info" },
  SCRIPT_READY: { label: "Script ready to edit", tone: "brand" },
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

  const busy = jobs?.some((job) => ACTIVE.includes(job.status) || job.status === "UPLOADING") ?? false;
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), busy ? 3000 : 15000);
    return () => clearInterval(timer);
  }, [refresh, busy]);

  const job = jobs?.find((item) => item.id === selected) ?? null;

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 gap-6">
          <AddTopics
            onAdded={(added) => {
              setSelected(added[0]?.id ?? null);
              void refresh();
            }}
          />
          <UploadVideo
            onStarted={(job) => {
              setSelected(job.id);
              void refresh();
            }}
          />
        </div>
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
  const [settings, setSettings] = useState<VideoSettings>(DEFAULT_VIDEO_SETTINGS);
  const [music, setMusic] = useState<Record<string, string[]>>({});
  const [options, setOptions] = useState(false);
  const topics = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const motion = settings.motion;
  const setMotion = (value: boolean) => setSettings((current) => ({ ...current, motion: value }));

  useEffect(() => {
    api<{ defaults: VideoSettings; music: Record<string, string[]> }>("/api/video/settings")
      .then((body) => {
        setSettings(body.defaults);
        setMusic(body.music);
      })
      .catch(() => {});
  }, []);

  async function saveDefaults() {
    try {
      const body = await api<{ defaults: VideoSettings }>("/api/video/settings", { method: "PUT", body: JSON.stringify({ settings }) });
      setSettings(body.defaults);
      toast("Saved as your defaults (also used by Make video on the topic ideas)");
    } catch (error) {
      toast((error as Error).message, "error");
    }
  }

  async function add() {
    setBusy(true);
    try {
      const { jobs } = await api<{ jobs: VideoJob[] }>("/api/video/jobs", { method: "POST", body: JSON.stringify({ topics, settings }) });
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
          One topic per line. Each becomes a {settings.seconds}-second vertical video: script, scene images, voice, captions and music,
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
          <Button size="sm" variant="ghost" onClick={() => setOptions((open) => !open)} aria-expanded={options}>
            {options ? "Hide options" : "Options"}
          </Button>
          <div className="ml-auto flex items-center gap-2" title="Animate each scene with LTX-Video; off keeps still images with a slow zoom">
            <Switch id="video-motion" checked={motion} onCheckedChange={setMotion} />
            <Label htmlFor="video-motion" className="text-xs font-normal">
              Motion
            </Label>
          </div>
          <Button size="sm" disabled={busy || !topics.length} onClick={add}>
            {busy ? <Loader2 className="animate-spin" /> : <ListPlus />}
            Add to queue
          </Button>
        </div>
        {options && (
          <div className="grid gap-3">
            <VideoSettingsForm value={settings} onChange={setSettings} music={music} onMusicChange={setMusic} idPrefix="new" />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={saveDefaults}>
                <Save />
                Save as my defaults
              </Button>
              <p className="self-center text-xs text-muted-foreground">These settings apply to the videos you add here.</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// A video's own settings, changed after it was added. "Save and apply" makes again only what the change needs.
function JobSettings({ job, locked, onChanged }: { job: VideoJob; locked: boolean; onChanged: () => Promise<void> }) {
  const saved = useMemo(() => normalizeVideoSettings(job.assets.settings), [job.assets.settings]);
  const [settings, setSettings] = useState(saved);
  const [busy, setBusy] = useState(false);
  const redo = settingsRedo(saved, settings);
  const changed = JSON.stringify(saved) !== JSON.stringify(settings);
  const effect = {
    script: "Length, scenes and tone apply to a new script (Script › New script).",
    clips: "The scenes are animated again (or made still), then the voice and video.",
    audio: "The voice and captions are recorded again, then the video.",
    render: "The video is rendered again.",
  };

  async function save(apply: boolean) {
    setBusy(true);
    try {
      await api(`/api/video/jobs/${job.id}`, { method: "PATCH", body: JSON.stringify({ action: "settings", settings, apply }) });
      toast(apply && redo && redo !== "script" ? "Saved: making the changes now" : "Saved");
      await onChanged();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <VideoSettingsForm value={settings} onChange={setSettings} disabled={locked || busy} idPrefix={`job-${job.id}`} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={locked || busy || !redo || redo === "script"} onClick={() => save(true)}>
          {busy ? <Loader2 className="animate-spin" /> : <Film />}
          Save and apply
        </Button>
        <Button size="sm" variant="outline" disabled={locked || busy || !changed} onClick={() => save(false)}>
          <Save />
          Save only
        </Button>
        <p className="text-xs text-muted-foreground">
          {redo ? effect[redo] : changed ? "Applies to new pictures (Scenes › New image) and the next script." : "No changes yet."}
        </p>
      </div>
    </div>
  );
}

const FITS = [
  { value: "none", label: "Keep as is" },
  { value: "crop", label: "Crop to 1080x1920" },
  { value: "pad", label: "Fit with bars" },
] as const;

// A video you made yourself: sent in chunks (each written to disk as it arrives), checked, then reviewed like the rest.
function UploadVideo({ onStarted }: { onStarted: (job: VideoJob) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [fit, setFit] = useState<string>("none");
  const [sent, setSent] = useState<number | null>(null);
  const [inputKey, setInputKey] = useState(0);

  async function upload() {
    if (!file) return;
    setSent(0);
    try {
      const { job, chunkBytes } = await api<{ job: VideoJob; chunkBytes: number }>("/api/video/uploads", {
        method: "POST",
        body: JSON.stringify({ title, name: file.name, size: file.size }),
      });
      onStarted(job);
      let offset = 0;
      let failures = 0;
      while (offset < file.size) {
        const response = await fetch(`/api/video/uploads/${job.id}?offset=${offset}`, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: file.slice(offset, offset + chunkBytes),
        }).catch(() => null);
        const body = (await response?.json().catch(() => ({}))) as { received?: number; error?: string } | undefined;
        if (response?.ok && typeof body?.received === "number") {
          offset = body.received;
          failures = 0;
          setSent(offset);
          continue;
        }
        // A dropped connection is tried again from where the server says the file got to.
        const resume = body?.error?.match(/starting at byte (\d+)/);
        if (resume) offset = Number(resume[1]);
        if (++failures > 3) throw new Error(body?.error ?? "The upload kept breaking off. Check your connection and try again.");
        await new Promise((resolve) => setTimeout(resolve, 1000 * failures));
      }
      await api(`/api/video/uploads/${job.id}`, { method: "POST", body: JSON.stringify({ convert: fit }) });
      toast(fit === "none" ? "Uploaded: checking it now" : "Uploaded: converting it now");
      setFile(null);
      setTitle("");
      setInputKey((key) => key + 1);
      onStarted(job);
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setSent(null);
    }
  }

  const uploading = sent !== null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="size-4 text-muted-foreground" />
          Upload your own video
        </CardTitle>
        <CardDescription>
          An MP4 or MOV of up to 2 GB that you made. It&apos;s checked, then goes to review, approval and Upload to YouTube like the others.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="upload-file">Video file</Label>
            <Input
              key={inputKey}
              id="upload-file"
              type="file"
              accept="video/mp4,video/quicktime,.mp4,.mov,.m4v"
              disabled={uploading}
              onChange={(event) => {
                const picked = event.target.files?.[0] ?? null;
                setFile(picked);
                if (picked && !title) setTitle(picked.name.replace(/\.[^.]+$/, "").slice(0, 100));
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="upload-title">Title</Label>
            <Input id="upload-title" maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} disabled={uploading} />
          </div>
        </div>
        <div className="grid gap-2">
          <Label>Size</Label>
          <ToggleGroup type="single" variant="outline" aria-label="Size" value={fit} onValueChange={(value) => value && setFit(value)} disabled={uploading} className="flex-wrap justify-start">
            {FITS.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value}>
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">Shorts are 1080x1920. Crop fills the frame; bars keep the whole picture.</p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground tabular-nums">
            {uploading && file
              ? `Sending… ${Math.round(((sent ?? 0) / file.size) * 100)}% of ${(file.size / 1024 / 1024).toFixed(0)} MB`
              : file
                ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
                : "Nothing picked yet"}
          </p>
          <Button size="sm" disabled={uploading || !file || file.size > 2 * 1024 * 1024 * 1024} onClick={upload}>
            {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
            Upload
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
  const uploaded = job.assets.source === "upload";
  const warnings = ((job.qc?.warnings as string[] | undefined) ?? []).filter(Boolean);

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
        {job.status === "SCRIPT_READY" && (
          <Alert>
            <AlertTitle>The script is ready for you</AlertTitle>
            <AlertDescription>
              Edit the narration and prompts in the Script and Scenes tabs, then click Continue to draw, animate and render it.
            </AlertDescription>
          </Alert>
        )}
        {warnings.length > 0 && (
          <Alert>
            <AlertTitle>Worth a look before you post it</AlertTitle>
            <AlertDescription>{warnings.join(" ")}</AlertDescription>
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
                  {job.status === "UPLOADING"
                    ? "Your video appears here once it's uploaded and checked."
                    : ACTIVE.includes(job.status)
                      ? "The video appears here when it's rendered."
                      : "No video yet."}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {job.status === "SCRIPT_READY" && (
                <Button size="sm" disabled={locked} onClick={() => act("continue", { action: "continue" }, "Continuing: drawing the scenes")}>
                  <Play />
                  Continue
                </Button>
              )}
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
              {["FAILED", "CANCELLED", "REJECTED"].includes(job.status) && !uploaded && (
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

          {job.script && uploaded ? (
            <Tabs defaultValue="script">
              <TabsList>
                <TabsTrigger value="script"><ScrollText />Details</TabsTrigger>
                <TabsTrigger value="log">Log</TabsTrigger>
              </TabsList>
              <TabsContent value="script">
                <ScriptEditor key={job.updatedAt} job={job} locked={locked || job.status === "UPLOADING"} act={act} />
              </TabsContent>
              <TabsContent value="log">
                <EventLog events={events} />
              </TabsContent>
            </Tabs>
          ) : job.script ? (
            <Tabs defaultValue="script">
              <TabsList>
                <TabsTrigger value="script"><ScrollText />Script</TabsTrigger>
                <TabsTrigger value="scenes"><ImageIcon />Scenes</TabsTrigger>
                <TabsTrigger value="captions"><Subtitles />Captions</TabsTrigger>
                <TabsTrigger value="settings"><Settings2 />Settings</TabsTrigger>
                <TabsTrigger value="log">Log</TabsTrigger>
              </TabsList>
              {/* Keyed on updatedAt so they reload when the worker changes the job (they're locked while it runs). */}
              <TabsContent value="script">
                <ScriptEditor key={job.updatedAt} job={job} locked={locked} act={act} />
              </TabsContent>
              <TabsContent value="scenes">
                <SceneEditor key={job.updatedAt} job={job} locked={locked} act={act} onChanged={onChanged} />
              </TabsContent>
              <TabsContent value="captions">
                <CaptionEditor key={job.updatedAt} job={job} locked={locked} act={act} />
              </TabsContent>
              <TabsContent value="settings">
                <JobSettings key={job.updatedAt} job={job} locked={locked} onChanged={onChanged} />
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
  // Generated videos use AI images and an AI voice; a video you made yourself is only marked if you say so.
  const [madeWithAi, setMadeWithAi] = useState(job.assets.source !== "upload");
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
        body: JSON.stringify({ title, description, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean), privacy, madeWithAi }),
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
          {PRIVACY.find((option) => option.value === privacy)?.hint ?? "Pick one before uploading."} It&apos;s marked as not made
          for kids.
        </p>
      </div>
      <div className="flex items-start gap-3">
        <Switch id="yt-ai" checked={madeWithAi} onCheckedChange={setMadeWithAi} disabled={uploading} />
        <div className="grid gap-0.5">
          <Label htmlFor="yt-ai">Made with AI</Label>
          <p className="text-xs text-muted-foreground">
            Tells YouTube it has altered or synthetic content (AI pictures, motion or voice). On for generated videos.
          </p>
        </div>
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
  const uploaded = job.assets.source === "upload";

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
      <div className={cn("grid gap-2", uploaded && "hidden")}>
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
        {!uploaded && (
          <>
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
          </>
        )}
        <Button size="sm" variant="ghost" onClick={copyCaption}>
          <Copy />
          Copy caption
        </Button>
      </div>
    </div>
  );
}

type SceneEdit = { narration: string; image_prompt: string; motion_prompt: string };

// Sends a file in chunks to a PUT ?offset= endpoint (each chunk is written to disk as it arrives); returns when all is in.
async function sendInChunks(url: string, file: File, onProgress: (sent: number) => void, chunkBytes = 8 * 1024 * 1024) {
  let offset = 0;
  let failures = 0;
  while (offset < file.size || offset === 0) {
    const response = await fetch(`${url}?offset=${offset}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: file.slice(offset, offset + chunkBytes),
    }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { received?: number; error?: string } | undefined;
    if (response?.ok && typeof body?.received === "number") {
      offset = body.received;
      failures = 0;
      onProgress(offset);
      if (offset >= file.size) return;
      continue;
    }
    const resume = body?.error?.match(/starting at byte (\d+)/);
    if (resume) offset = Number(resume[1]);
    if (++failures > 3) throw new Error(body?.error ?? "The upload kept breaking off. Check your connection and try again.");
    await new Promise((resolve) => setTimeout(resolve, 1000 * failures));
  }
}

// Every scene as a card: its clip (or picture), narration, image prompt and motion prompt, all editable, with ways to
// make the picture or clip again or put your own in. "Re-render video" makes the voice and captions again when a
// narration changed, then the video, reusing the pictures and clips.
function SceneEditor({ job, locked, act, onChanged }: { job: VideoJob; locked: boolean; act: Act; onChanged: () => Promise<void> }) {
  const [edits, setEdits] = useState<SceneEdit[]>(() =>
    job.scenes.map((scene) => ({ narration: scene.narration ?? "", image_prompt: scene.image_prompt, motion_prompt: scene.motion_prompt ?? "" })),
  );
  const [sending, setSending] = useState<{ scene: number; percent: number } | null>(null);
  const files = (job.assets.files ?? {}) as Record<string, string>;
  const stills = new Set((job.assets.motion_stills as number[] | undefined) ?? []);
  const animated = job.assets.motion_model === "ltx";
  const motionOff = job.assets.motion === false;
  const visualsDone = job.completedStages.includes("visuals");
  const changed = edits.some(
    (edit, index) =>
      edit.narration !== (job.scenes[index].narration ?? "") ||
      edit.image_prompt !== job.scenes[index].image_prompt ||
      edit.motion_prompt !== (job.scenes[index].motion_prompt ?? ""),
  );
  const spokenChanged = edits.some((edit, index) => edit.narration.trim() !== (job.scenes[index].narration ?? "").trim());
  const busy = locked || sending !== null;

  const set = (index: number, field: keyof SceneEdit) => (event: React.ChangeEvent<HTMLTextAreaElement>) =>
    setEdits((current) => current.map((edit, i) => (i === index ? { ...edit, [field]: event.target.value } : edit)));

  async function save() {
    if (!changed) return;
    await act("save", { action: "edit", script: { title: job.script!.title, scenes: edits } });
  }

  async function useOwn(index: number, file: File) {
    if (file.size > 500 * 1024 * 1024) return toast("Use a file of up to 500 MB.", "error");
    setSending({ scene: index, percent: 0 });
    try {
      await save();
      const url = `/api/video/jobs/${job.id}/scenes/${index}`;
      await sendInChunks(url, file, (sent) => setSending({ scene: index, percent: Math.round((sent / file.size) * 100) }));
      await api(url, { method: "POST", body: JSON.stringify({ name: file.name }) });
      toast(`Scene ${index + 1} uses your ${file.type.startsWith("image/") ? "picture" : "clip"} now`);
      await onChanged();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setSending(null);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy || !changed} onClick={() => save().then(() => toast("Saved"))}>
          <Save />
          Save edits
        </Button>
        <Button
          size="sm"
          disabled={busy || !job.completedStages.includes("audio")}
          onClick={async () => {
            await save();
            await act(
              "rerender",
              { action: "redo", what: spokenChanged ? "narration" : "render" },
              spokenChanged ? "Recording the voice again, then rendering" : "Rendering again",
            );
          }}
          title="Uses the pictures and clips you have; the voice and captions are made again if a narration changed"
        >
          <Film />
          Re-render video
        </Button>
        <p className="text-xs text-muted-foreground">
          {spokenChanged ? "A narration changed: re-rendering records the voice and captions again." : "Edits are kept when you re-render."}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {job.scenes.map((scene, index) => {
          const n = index + 1;
          const clip = files[`clip-${n}`];
          const ownClip = scene.clip_source === "upload";
          const showClip = clip && (ownClip || (animated && !stills.has(n)));
          return (
            <div key={index} className="grid content-start gap-2 rounded-xl border p-3">
              <div className="relative aspect-[9/16] overflow-hidden rounded-lg border bg-muted">
                {showClip ? (
                  <video
                    key={`${clip}-${job.updatedAt}`}
                    src={fileUrl(job, clip)}
                    poster={files[`scene-${n}`] ? fileUrl(job, `scene-${n}.png`) : undefined}
                    muted
                    loop
                    autoPlay
                    playsInline
                    className="size-full object-cover"
                  />
                ) : files[`scene-${n}`] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- generated file served by the API
                  <img src={fileUrl(job, `scene-${n}.png`)} alt={`Scene ${n}`} className="size-full object-cover" />
                ) : (
                  <div className="grid size-full place-items-center text-xs text-muted-foreground">Not drawn yet</div>
                )}
                <div className="absolute left-2 top-2 flex flex-wrap gap-1">
                  <Badge variant="muted">Scene {n}</Badge>
                  {ownClip ? <Badge variant="brand">Your clip</Badge> : scene.image_source === "upload" ? <Badge variant="brand">Your picture</Badge> : null}
                  {!ownClip && animated && stills.has(n) && <Badge variant="warning">Still</Badge>}
                </div>
                {sending?.scene === index && (
                  <div className="absolute inset-0 grid place-items-center bg-background/70 text-xs font-medium">Sending… {sending.percent}%</div>
                )}
              </div>
              <Label htmlFor={`scene-${index}-narration`}>Narration</Label>
              <Textarea id={`scene-${index}-narration`} rows={3} value={edits[index].narration} onChange={set(index, "narration")} disabled={busy} />
              <Label htmlFor={`scene-${index}-image`}>Image prompt</Label>
              <Textarea id={`scene-${index}-image`} rows={4} value={edits[index].image_prompt} onChange={set(index, "image_prompt")} disabled={busy || ownClip} />
              <Label htmlFor={`scene-${index}-motion`}>Motion prompt</Label>
              <Textarea
                id={`scene-${index}-motion`}
                rows={2}
                value={edits[index].motion_prompt}
                onChange={set(index, "motion_prompt")}
                disabled={busy || ownClip || motionOff}
                placeholder={motionOff ? "Motion is off for this video" : "Slow push-in, leaves moving gently in the breeze"}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !visualsDone}
                  onClick={async () => {
                    await save();
                    await act(`scene-${index}`, { action: "redo", what: "scene", scene: index }, `Drawing scene ${n} again`);
                  }}
                >
                  <RefreshCw />
                  New image
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !visualsDone || motionOff || !files[`scene-${n}`]}
                  onClick={async () => {
                    await save();
                    await act(`clip-${index}`, { action: "redo", what: "clip", scene: index }, `Animating scene ${n} again`);
                  }}
                  title={motionOff ? "Motion is off for this video" : "Animate this scene's picture again with the motion prompt"}
                >
                  <Film />
                  New clip
                </Button>
                <Button size="sm" variant="ghost" disabled={busy || !visualsDone} asChild>
                  <label className="cursor-pointer">
                    <Upload />
                    Use my own
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm,.mov,.m4v"
                      className="sr-only"
                      disabled={busy || !visualsDone}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void useOwn(index, file);
                      }}
                    />
                  </label>
                </Button>
              </div>
            </div>
          );
        })}
      </div>
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
