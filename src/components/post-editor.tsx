"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  Loader2,
  Send,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { foldIndex, LinkedInPreview, type PreviewAuthor } from "@/components/linkedin-preview";
import { CardMaker } from "@/components/card-maker";
import { ImageGenerator } from "@/components/image-generator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { PostImage, PostRecord } from "@/lib/db.ts";
import type { LinkedInStatus } from "@/lib/linkedin.ts";
import type { Profile } from "@/lib/profile.ts";

const MAX_LENGTH = 3000;
const MAX_IMAGES = 20;
const SAVE_DELAY = 600;

type Draft = Pick<PostRecord, "text" | "images" | "visibility">;

// Text being written into this post by the model, from the Write page.
export type PostStream = { text: string; running: boolean };

const REWRITES = [
  { action: "shorter", label: "Shorter" },
  { action: "hook", label: "Punchier hook" },
  { action: "personal", label: "More personal" },
  { action: "grammar", label: "Fix grammar" },
] as const;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed with status ${response.status}.`);
  return data;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export function PostEditor({
  id,
  stream = null,
  onStop,
  onDeleted,
  onOpen,
  onChange,
}: {
  id: string;
  stream?: PostStream | null;
  // Stops the model writing into this post.
  onStop?: () => void;
  onDeleted: () => void;
  // Opens another post (a copy of this one) in the editor.
  onOpen: (id: string) => void;
  // After every save or status change, so a list can show it.
  onChange?: (post: PostRecord) => void;
}) {
  const [post, setPost] = useState<PostRecord | null>(null);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<Draft>({ text: "", images: [], visibility: "PUBLIC" });
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [linkedIn, setLinkedIn] = useState<LinkedInStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState<"" | "publishing" | "scheduling" | "deleting" | "unpublishing">("");
  const [actionError, setActionError] = useState("");
  const [when, setWhen] = useState(defaultScheduleTime);
  const [maker, setMaker] = useState<"card" | "picture">("card");
  const [author, setAuthor] = useState<PreviewAuthor>({ name: "", headline: "" });
  const [rewriting, setRewriting] = useState<string | null>(null);
  const [rewriteError, setRewriteError] = useState("");
  const [undo, setUndo] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const rewriteAbort = useRef<AbortController | null>(null);
  const lastSaved = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    request<{ post: PostRecord }>(`/api/posts/${id}`)
      .then(({ post }) => {
        setPost(post);
        setDraft({ text: post.text, images: post.images, visibility: post.visibility });
        lastSaved.current = JSON.stringify({ text: post.text, images: post.images, visibility: post.visibility });
        if (post.scheduledAt) setWhen(toLocalInput(post.scheduledAt));
      })
      .catch((error: Error) => setLoadError(error.message));
    Promise.all([
      request<LinkedInStatus>("/api/linkedin/status").catch(() => null),
      request<{ profile: Profile }>("/api/profile").catch(() => null),
    ]).then(([status, local]) => {
      setLinkedIn(status);
      setAuthor({
        name: local?.profile.name || status?.profile?.name || "",
        headline: local?.profile.headline ?? "",
        picture: status?.profile?.picture,
      });
    });
    return () => rewriteAbort.current?.abort();
  }, [id]);

  // While the model writes this post, its text follows the stream (and is saved as it goes).
  const loaded = post !== null;
  useEffect(() => {
    if (stream && loaded) setDraft((current) => ({ ...current, text: stream.running ? stream.text : stream.text.trim() }));
  }, [stream, loaded]);
  const writing = Boolean(stream?.running) || rewriting !== null;

  useEffect(() => {
    if (post) onChange?.(post);
    // Only when the server's copy changes, not when the callback does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post]);

  const editable = post !== null && ["draft", "scheduled", "failed"].includes(post.status);
  const draftJson = JSON.stringify(draft);

  // Saves the draft now if it changed. Returns false if saving failed.
  const save = useCallback(async (): Promise<boolean> => {
    if (!editable || draftJson === lastSaved.current) return true;
    const sending = draftJson;
    setSaving("saving");
    try {
      const { post: saved } = await request<{ post: PostRecord }>(`/api/posts/${id}`, json("PATCH", JSON.parse(sending)));
      lastSaved.current = sending;
      // Keep what's being typed; take the status from the server (a failed post becomes a draft when edited).
      setPost(saved);
      setSaving("saved");
      setSaveError("");
      return true;
    } catch (error) {
      setSaving("error");
      setSaveError((error as Error).message);
      return false;
    }
  }, [editable, draftJson, id]);

  useEffect(() => {
    if (!editable || draftJson === lastSaved.current) return;
    const timer = setTimeout(() => void save(), SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [editable, draftJson, save]);

  // Save right away when leaving the page.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => () => void saveRef.current(), []);

  function setImages(update: (images: PostImage[]) => PostImage[]) {
    setDraft((current) => ({ ...current, images: update(current.images) }));
  }

  function addImage(id: string, alt: string) {
    setImages((current) => [...current, { id, alt }]);
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploadError("");
    const room = MAX_IMAGES - draft.images.length;
    if (files.length > room) {
      setUploadError(`A post can have at most ${MAX_IMAGES} images.`);
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      const { images } = await request<{ images: { id: string }[] }>("/api/images", { method: "POST", body: form });
      setImages((current) => [...current, ...images.map((image) => ({ id: image.id, alt: "" }))]);
    } catch (error) {
      setUploadError((error as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function move(index: number, by: number) {
    setImages((current) => {
      const next = [...current];
      const [image] = next.splice(index, 1);
      next.splice(index + by, 0, image);
      return next;
    });
  }

  // Rewrites the text with the model, streaming it in. The text before is kept for Undo.
  async function rewrite(action: (typeof REWRITES)[number]["action"]) {
    const before = draft.text;
    const controller = new AbortController();
    rewriteAbort.current = controller;
    setRewriting(action);
    setRewriteError("");
    try {
      const response = await fetch("/api/rewrite", { ...json("POST", { text: before, action }), signal: controller.signal });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed with status ${response.status}.`);
      }
      setUndo((stack) => [...stack.slice(-19), before]);
      let text = "";
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += value;
        setDraft((current) => ({ ...current, text }));
      }
      setDraft((current) => ({ ...current, text: text.trim() || before }));
    } catch (error) {
      if (controller.signal.aborted) {
        // Stopped: keep what was written so far; Undo brings the old text back.
      } else {
        setDraft((current) => ({ ...current, text: before }));
        setRewriteError((error as Error).message);
      }
    } finally {
      if (rewriteAbort.current === controller) rewriteAbort.current = null;
      setRewriting(null);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(draft.text.trim());
    // For the Reports page; a failed log doesn't matter here.
    fetch("/api/events", json("POST", { type: "draft_copied", characters: draft.text.trim().length })).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function undoRewrite() {
    const previous = undo.at(-1);
    if (previous === undefined) return;
    setUndo((stack) => stack.slice(0, -1));
    setDraft((current) => ({ ...current, text: previous }));
  }

  async function act(kind: typeof busy, work: () => Promise<void>) {
    setBusy(kind);
    setActionError("");
    try {
      await work();
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setBusy("");
    }
  }

  const publish = () =>
    act("publishing", async () => {
      if (!(await save())) throw new Error("Couldn't save your changes, so nothing was posted.");
      try {
        const { post: posted } = await request<{ post: PostRecord }>(`/api/posts/${id}/publish`, { method: "POST" });
        setPost(posted);
        setConfirmOpen(false);
      } catch (error) {
        // The server saved the error on the post; show the post as failed too.
        setPost((current) => (current ? { ...current, status: "failed", error: (error as Error).message } : current));
        setConfirmOpen(false);
        throw error;
      }
    });

  const schedule = (scheduledAt: string | null) =>
    act("scheduling", async () => {
      if (!(await save())) throw new Error("Couldn't save your changes.");
      const { post: saved } = await request<{ post: PostRecord }>(`/api/posts/${id}`, json("PATCH", { scheduledAt }));
      setPost(saved);
    });

  const remove = () =>
    act("deleting", async () => {
      if (!window.confirm("Delete this draft and its images? This can't be undone.")) return;
      lastSaved.current = draftJson; // nothing left to save
      await request(`/api/posts/${id}`, { method: "DELETE" });
      onDeleted();
    });

  const unpublish = () =>
    act("unpublishing", async () => {
      if (!window.confirm("Delete this post from LinkedIn? The copy here stays.")) return;
      const { post: saved } = await request<{ post: PostRecord }>(`/api/posts/${id}/publish`, { method: "DELETE" });
      setPost(saved);
    });

  const duplicate = () =>
    act("publishing", async () => {
      const { post: created } = await request<{ post: PostRecord }>("/api/posts", json("POST", { text: draft.text }));
      onOpen(created.id);
    });

  if (loadError) {
    return (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>Couldn&apos;t open the post</AlertTitle>
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }
  if (!post) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </p>
    );
  }

  const text = draft.text.trim();
  const tooLong = text.length > MAX_LENGTH;
  const canPost = linkedIn !== null && linkedIn.connected && !linkedIn.expired && linkedIn.canPost;
  const ready = editable && text !== "" && !tooLong && !writing;
  const fold = foldIndex(text);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Post
              {writing && (
                <span className="inline-flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  {stream?.running ? (stream.text ? "Writing…" : "Starting the model…") : "Rewriting…"}
                </span>
              )}
            </CardTitle>
            <CardDescription>
              {editable ? <SaveStatus state={saving} error={saveError} /> : "This post is on LinkedIn, so it can't be edited here."}
            </CardDescription>
            {writing && (
              <CardAction>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => (stream?.running ? onStop?.() : rewriteAbort.current?.abort())}
                >
                  <Square />
                  Stop
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="grid gap-2">
            {stream?.running && !stream.text ? (
              <div className="grid min-h-72 content-start gap-2.5 rounded-lg border p-3" aria-label="Writing your post">
                {[92, 100, 85, 0, 96, 78, 100, 64].map((width, index) =>
                  width ? (
                    <div key={index} className="h-3 animate-pulse rounded bg-muted" style={{ width: `${width}%` }} />
                  ) : (
                    <div key={index} className="h-2" />
                  ),
                )}
              </div>
            ) : (
              <Textarea
                aria-label="Post text"
                className="min-h-72 leading-relaxed"
                placeholder="Write your post…"
                value={draft.text}
                readOnly={!editable || writing}
                onChange={(event) => setDraft((current) => ({ ...current, text: event.target.value }))}
              />
            )}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className={`text-xs ${tooLong ? "text-destructive" : "text-muted-foreground"}`}>
                {text.length.toLocaleString("en")} / {MAX_LENGTH.toLocaleString("en")} characters
                {tooLong && " (too long for LinkedIn)"}
                {fold !== null && !tooLong && ` · "see more" after ${fold} characters`}
              </p>
              <Button variant="ghost" size="xs" disabled={!text || writing} onClick={copy}>
                {copied ? <Check /> : <Copy />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            {editable && (
              <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
                <Sparkles className="size-3.5 text-brand" aria-hidden />
                <span className="sr-only">Quick rewrites:</span>
                {REWRITES.map((option) => (
                  <Button
                    key={option.action}
                    variant="outline"
                    size="xs"
                    disabled={writing || !text}
                    onClick={() => rewrite(option.action)}
                  >
                    {rewriting === option.action && <Loader2 className="animate-spin" />}
                    {option.label}
                  </Button>
                ))}
                {undo.length > 0 && (
                  <Button variant="ghost" size="xs" disabled={writing} onClick={undoRewrite}>
                    <Undo2 />
                    Undo
                  </Button>
                )}
              </div>
            )}
            {rewriteError && <p className="text-sm text-destructive">{rewriteError}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Images</CardTitle>
            <CardDescription>
              {editable
                ? "Optional. Add up to 20 PNG, JPG or GIF images, or generate one. Describe each for people using screen readers."
                : draft.images.length === 0
                  ? "No images."
                  : `${draft.images.length} image${draft.images.length === 1 ? "" : "s"}.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {draft.images.length > 0 && (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {draft.images.map((image, index) => (
                  <li key={image.id} className="grid gap-2 rounded-lg border p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local images served by the app */}
                    <img
                      src={`/api/images/${image.id}`}
                      alt={image.alt || `Image ${index + 1}`}
                      className="aspect-video w-full rounded-md bg-muted object-contain"
                    />
                    {editable ? (
                      <>
                        <Input
                          aria-label={`Description of image ${index + 1}`}
                          placeholder="Describe the image (alt text)"
                          value={image.alt}
                          maxLength={1000}
                          onChange={(event) =>
                            setImages((current) =>
                              current.map((item) => (item.id === image.id ? { ...item, alt: event.target.value } : item)),
                            )
                          }
                        />
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Move earlier"
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          >
                            <ArrowLeft />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Move later"
                            disabled={index === draft.images.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            <ArrowRight />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="ml-auto"
                            onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))}
                          >
                            <X />
                            Remove
                          </Button>
                        </div>
                      </>
                    ) : (
                      image.alt && <p className="text-xs text-muted-foreground">{image.alt}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {editable && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/png,image/jpeg,image/gif"
                    multiple
                    className="sr-only"
                    id="image-upload"
                    onChange={(event) => void upload(event.target.files)}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={uploading || draft.images.length >= MAX_IMAGES}
                    onClick={() => fileInput.current?.click()}
                  >
                    {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
                    {uploading ? "Uploading…" : "Add your images"}
                  </Button>
                  {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}
                </div>
                {draft.images.length < MAX_IMAGES && (
                  <div className="grid gap-3">
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      size="sm"
                      aria-label="Kind of image to make"
                      className="justify-self-start"
                      value={maker}
                      onValueChange={(value) => value && setMaker(value as typeof maker)}
                    >
                      <ToggleGroupItem value="card">Designed card</ToggleGroupItem>
                      <ToggleGroupItem value="picture">Picture only</ToggleGroupItem>
                    </ToggleGroup>
                    {maker === "card" ? (
                      <CardMaker postText={draft.text} onImage={addImage} />
                    ) : (
                      <ImageGenerator postText={draft.text} onImage={(imageId) => addImage(imageId, "")} />
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:sticky lg:top-0">
        <div className="grid gap-2">
          <p className="text-sm font-medium">Preview</p>
          <LinkedInPreview text={draft.text} images={draft.images} author={author} visibility={draft.visibility} />
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Publish <StatusBadge post={post} />
            </CardTitle>
            <CardDescription>
              <PublishSummary post={post} />
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {post.error && post.status === "failed" && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertDescription>{post.error}</AlertDescription>
              </Alert>
            )}
            {post.error && post.status === "draft" && (
              <Alert>
                <CircleAlert />
                <AlertDescription>{post.error}</AlertDescription>
              </Alert>
            )}
            {actionError && (
              <Alert variant="destructive">
                <AlertDescription>{actionError}</AlertDescription>
              </Alert>
            )}

            {editable && (
              <>
                <div className="grid gap-2">
                  <p className="text-sm font-medium" id="visibility-label">
                    Who can see it
                  </p>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    aria-labelledby="visibility-label"
                    value={draft.visibility}
                    onValueChange={(value) =>
                      value && setDraft((current) => ({ ...current, visibility: value as Draft["visibility"] }))
                    }
                  >
                    <ToggleGroupItem value="PUBLIC">Anyone</ToggleGroupItem>
                    <ToggleGroupItem value="CONNECTIONS">Connections</ToggleGroupItem>
                  </ToggleGroup>
                </div>

                {!canPost && linkedIn && (
                  <p className="text-xs text-muted-foreground">
                    <Link href="/profile" className="underline underline-offset-2 hover:text-foreground">
                      {!linkedIn.connected
                        ? "Connect LinkedIn"
                        : linkedIn.expired
                          ? "Reconnect LinkedIn"
                          : "Enable posting on the Profile page"}
                    </Link>{" "}
                    to post or schedule. You can keep editing the draft meanwhile.
                  </p>
                )}

                <Button disabled={!ready || !canPost || busy !== ""} onClick={() => setConfirmOpen(true)}>
                  <Send />
                  Post now
                </Button>

                <div className="grid gap-2 border-t pt-4">
                  <Label htmlFor="schedule-at">{post.status === "scheduled" ? "Change the time" : "Post later"}</Label>
                  <Input
                    id="schedule-at"
                    type="datetime-local"
                    value={when}
                    min={toLocalInput(new Date().toISOString())}
                    onChange={(event) => setWhen(event.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!ready || !canPost || !when || busy !== ""}
                      onClick={() => schedule(new Date(when).toISOString())}
                    >
                      {busy === "scheduling" ? <Loader2 className="animate-spin" /> : <CalendarClock />}
                      {post.status === "scheduled" ? "Reschedule" : "Schedule"}
                    </Button>
                    {post.status === "scheduled" && (
                      <Button variant="ghost" size="sm" disabled={busy !== ""} onClick={() => schedule(null)}>
                        Unschedule
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Scheduled posts go out while this app is running on your computer. If it&apos;s off at that time,
                    the post goes out when you start it again (up to 12 hours late).
                  </p>
                </div>

                <Button variant="ghost" size="sm" className="justify-self-start" disabled={busy !== ""} onClick={remove}>
                  <Trash2 />
                  Delete draft
                </Button>
              </>
            )}

            {post.status === "posted" && post.url && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" asChild>
                  <a href={post.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink />
                    View on LinkedIn
                  </a>
                </Button>
                <Button variant="ghost" size="sm" disabled={busy !== ""} onClick={unpublish}>
                  {busy === "unpublishing" ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  Delete from LinkedIn
                </Button>
              </div>
            )}
            {(post.status === "posted" || post.status === "deleted") && (
              <Button variant="outline" size="sm" className="justify-self-start" disabled={busy !== ""} onClick={duplicate}>
                <Copy />
                Copy into a new draft
              </Button>
            )}
            {post.status === "publishing" && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Posting to LinkedIn…
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={(next) => busy !== "publishing" && setConfirmOpen(next)}>
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Post to LinkedIn?</AlertDialogTitle>
            <AlertDialogDescription>
              {draft.visibility === "PUBLIC"
                ? `This posts publicly to your LinkedIn as ${linkedIn?.profile?.name ?? "you"}.`
                : `This posts to your LinkedIn connections as ${linkedIn?.profile?.name ?? "you"}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-3">
            <div
              aria-label="Post preview"
              className="max-h-56 overflow-y-auto rounded-lg border bg-muted/50 px-3 py-2 text-sm whitespace-pre-wrap"
            >
              {text}
            </div>
            {draft.images.length > 0 && (
              <div className="flex gap-2 overflow-x-auto">
                {draft.images.map((image) => (
                  // eslint-disable-next-line @next/next/no-img-element -- local images served by the app
                  <img
                    key={image.id}
                    src={`/api/images/${image.id}`}
                    alt={image.alt || ""}
                    className="h-16 w-auto shrink-0 rounded border object-cover"
                  />
                ))}
              </div>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "publishing"}>Cancel</AlertDialogCancel>
            <Button disabled={busy === "publishing" || !ready} onClick={publish}>
              {busy === "publishing" ? <Loader2 className="animate-spin" /> : <Send />}
              {busy === "publishing" ? "Posting…" : "Post"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SaveStatus({ state, error }: { state: "idle" | "saving" | "saved" | "error"; error: string }) {
  if (state === "saving") return <>Saving…</>;
  if (state === "error") return <span className="text-destructive">Not saved: {error}</span>;
  if (state === "saved")
    return (
      <span className="inline-flex items-center gap-1">
        <Check className="size-3.5" /> Saved
      </span>
    );
  return <>Changes are saved as you type.</>;
}

export function StatusBadge({ post }: { post: Pick<PostRecord, "status"> }) {
  const labels: Record<PostRecord["status"], string> = {
    draft: "Draft",
    scheduled: "Scheduled",
    publishing: "Posting…",
    posted: "Posted",
    failed: "Failed",
    deleted: "Deleted",
  };
  const variants = {
    draft: "outline",
    scheduled: "info",
    publishing: "brand",
    posted: "success",
    failed: "destructive",
    deleted: "muted",
  } as const;
  return (
    <Badge variant={variants[post.status]}>
      <span aria-hidden className="size-1.5 rounded-full bg-current opacity-80" />
      {labels[post.status]}
    </Badge>
  );
}

function PublishSummary({ post }: { post: PostRecord }) {
  switch (post.status) {
    case "scheduled":
      return <>Goes out {formatWhen(post.scheduledAt!)}.</>;
    case "posted":
      return <>Posted {formatWhen(post.postedAt!)}.</>;
    case "deleted":
      return <>Was posted {post.postedAt ? formatWhen(post.postedAt) : ""}, then deleted from LinkedIn.</>;
    case "failed":
      return <>Didn&apos;t go out. Fix the problem below, then post or schedule it again.</>;
    case "publishing":
      return <>Posting now.</>;
    default:
      return <>Post it now, or pick a time to post it later.</>;
  }
}

export function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// "YYYY-MM-DDTHH:MM" in local time, the format a datetime-local input uses.
function toLocalInput(iso: string) {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Tomorrow at 9:00, a sensible first suggestion.
function defaultScheduleTime() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return toLocalInput(date.toISOString());
}
