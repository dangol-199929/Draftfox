"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarDays, Eraser, Info, Library, Loader2, PencilLine, Sparkles, Square, UserRound } from "lucide-react";
import { CommandLine } from "@/components/command-line";
import { PostDrawer, usePostDrawer } from "@/components/post-drawer";
import type { PostStream } from "@/components/post-editor";
import { PostsList } from "@/components/posts-list";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { PostRecord } from "@/lib/db.ts";
import type { GenerationSnapshot } from "@/lib/generation.ts";
import type { Profile } from "@/lib/profile.ts";
import type { PostInput } from "@/lib/prompts.ts";
import { useSavedState } from "@/lib/use-saved-state.ts";
import { cn } from "@/lib/utils";

type Length = NonNullable<PostInput["length"]>;

type GenerateError = { message: string; code?: string; model?: string };

// What's kept across page switches and reloads: the form, and a generation that's still running.
type SavedGenerate = {
  topic: string;
  experience: string;
  audience: string;
  tone: string;
  length: Length;
  // Set while a generation runs on the server, so the page can reconnect to it after a page switch or reload.
  generationId: string | null;
  // The draft it writes into.
  postId?: string | null;
};

const NEED_MORE_CONTEXT = "NEED MORE CONTEXT:";

const LENGTHS: { value: Length; label: string }[] = [
  { value: "short", label: "Short" },
  { value: "medium", label: "Medium" },
  { value: "long", label: "Long" },
];

// The Studio: the AI composer, your latest posts, and the post editor in a drawer.
export function WriteWorkspace({ initialPost }: { initialPost: string | null }) {
  const [topic, setTopic] = useState("");
  const [experience, setExperience] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("");
  const [length, setLength] = useState<Length>("medium");
  const [error, setError] = useState<GenerateError | null>(null);
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [generationId, setGenerationId] = useState<string | null>(null);
  // The draft being written by the model, and what it has written so far.
  const [stream, setStream] = useState<(PostStream & { postId: string }) | null>(null);
  const [updated, setUpdated] = useState<PostRecord | null>(null);
  const [profileNote, setProfileNote] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const experienceRef = useRef<HTMLTextAreaElement>(null);
  const drawer = usePostDrawer("/write", initialPost);
  const open = drawer.open;

  const running = stream?.running ?? false;

  const restored = useSavedState<SavedGenerate>(
    "generate",
    { topic, experience, audience, tone, length, generationId, postId: stream?.postId ?? null },
    (saved) => {
      setTopic(saved.topic ?? "");
      setExperience(saved.experience ?? "");
      setAudience(saved.audience ?? "");
      setTone(saved.tone ?? "");
      if (LENGTHS.some((option) => option.value === saved.length)) setLength(saved.length);
      if (saved.generationId && saved.postId) {
        const postId = saved.postId;
        setGenerationId(saved.generationId);
        setStream({ postId, text: "", running: true });
        open(postId);
        void watch(saved.generationId, postId, null, track());
      }
    },
  );

  // Leaving the page only stops listening; the generation itself keeps running on the server.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    fetch("/api/profile")
      .then((response) => response.json() as Promise<{ profile?: Profile; exists?: boolean }>)
      .then(({ profile, exists }) => setProfileNote(exists && profile ? describeProfileUse(profile) : ""))
      .catch(() => setProfileNote(null));
  }, []);

  function close() {
    drawer.close();
    // A finished stream has done its job; reopening the post shows what was saved, edits included.
    setStream((current) => (current?.running ? current : null));
  }

  function track() {
    const controller = new AbortController();
    abortRef.current = controller;
    return controller;
  }

  const canGenerate = restored && topic.trim() !== "" && !running && !starting;

  // Creates a draft, opens it in the editor and streams the model's post into it.
  // The server saves the finished text into the draft too, so closing the page doesn't lose it.
  async function generate(input: PostInput) {
    setError(null);
    setQuestions(null);
    setStarting(true);
    let postId: string;
    try {
      const response = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "", source: "generate", topic: input.topic }),
      });
      if (!response.ok) throw new Error();
      postId = ((await response.json()) as { post: PostRecord }).post.id;
    } catch {
      setError({ message: "Couldn't create a draft for the post." });
      setStarting(false);
      return;
    }
    setStream({ postId, text: "", running: true });
    open(postId);
    setStarting(false);

    const controller = track();
    let response: Response;
    try {
      response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, postId }),
        signal: controller.signal,
      });
    } catch (err) {
      if (!controller.signal.aborted) await failed(postId, { message: (err as Error).message });
      return;
    }
    const id = response.headers.get("X-Generation-Id");
    if (!response.ok || !response.body || !id) {
      const data = (await response.json().catch(() => ({}))) as Partial<GenerateError> & { error?: string };
      await failed(postId, {
        message: data.error ?? `Request failed with status ${response.status}.`,
        code: data.code,
        model: data.model,
      });
      return;
    }
    setGenerationId(id);
    await watch(id, postId, response, controller);
  }

  // The model couldn't start: drop the empty draft, close the editor and show why.
  async function failed(postId: string, problem: GenerateError) {
    await fetch(`/api/posts/${postId}`, { method: "DELETE" }).catch(() => {});
    setStream(null);
    drawer.closeIf(postId);
    setError(problem);
  }

  // Streams a server-side generation into the draft (from its start), then applies how it ended.
  // `response` is the POST that started it; without one, this reconnects to it.
  async function watch(id: string, postId: string, response: Response | null, controller: AbortController) {
    let text = "";
    try {
      const body = response ?? (await fetch(`/api/generate?follow=${id}`, { signal: controller.signal }));
      if (body.ok && body.body) {
        const reader = body.body.pipeThrough(new TextDecoderStream()).getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          text += value;
          setStream({ postId, text, running: true });
        }
      }
    } catch {
      // The final state below says what happened; an abort means the page went away.
    }
    if (controller.signal.aborted) return;

    const generation = await fetch("/api/generate")
      .then((res) => res.json() as Promise<{ generation: GenerationSnapshot | null }>)
      .then((data) => data.generation)
      .catch(() => null);
    if (generation?.id === id) text = generation.text;
    text = text.trim();
    setGenerationId(null);

    if (text.startsWith(NEED_MORE_CONTEXT)) {
      await failed(postId, { message: "" });
      setError(null);
      setQuestions(parseQuestions(text));
      experienceRef.current?.focus();
      return;
    }
    if (!text && generation?.status === "failed") {
      await failed(postId, { message: generation.error ?? "", code: generation.code, model: generation.model });
      return;
    }
    setStream({ postId, text, running: false });
    if (generation?.id === id && generation.status === "failed") {
      setError({
        message: generation.error ?? "The post couldn't be finished. The partial post is kept.",
        code: generation.code,
        model: generation.model,
      });
    } else if (!generation) {
      setError({ message: "Lost touch with the app's server. The partial post is kept." });
    }
  }

  // Stops the generation on the server; the stream then ends and the partial post is kept.
  function stop() {
    fetch("/api/generate", { method: "DELETE" }).catch(() => {});
  }

  function submit() {
    if (!canGenerate) return;
    generate({ topic, experience, audience, tone, length });
  }

  // Empties the form, keeping the chosen length. Drafts stay in the list.
  function clear() {
    setTopic("");
    setExperience("");
    setAudience("");
    setTone("");
    setError(null);
    setQuestions(null);
  }

  const hasInput = Boolean(topic || experience || audience || tone);

  return (
    <div className="grid gap-8">
      <section
        aria-labelledby="composer-heading"
        className={cn(
          "overflow-hidden rounded-2xl border bg-card shadow-card transition-shadow",
          (running || starting) && "ai-glow",
        )}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-surface/60 px-5 py-3">
          <span className="grid size-7 place-items-center rounded-md bg-brand-soft text-brand-strong">
            <Sparkles className="size-4" />
          </span>
          <h2 id="composer-heading" className="text-sm font-semibold tracking-tight">
            Write a post with AI
          </h2>
          <p className="text-xs text-muted-foreground">Only the topic is required. The draft opens as it&apos;s written.</p>
        </div>
        <form
          className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_18rem]"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
        >
          <div className="grid content-start gap-5 p-5">
            <div className="grid gap-2">
              <Label htmlFor="topic" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Topic
              </Label>
              <Input
                id="topic"
                required
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder="What do you want to post about?"
                className="h-11 text-base md:text-base"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="experience" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                What really happened
              </Label>
              <Textarea
                id="experience"
                ref={experienceRef}
                rows={5}
                className="min-h-32 leading-relaxed"
                value={experience}
                onChange={(event) => setExperience(event.target.value)}
                placeholder="e.g. I spent several hours debugging Docker networking. The fix was one line."
              />
              <p className="text-xs text-muted-foreground">
                The post sticks to what you write here and in your profile. It won&apos;t invent results or numbers.
              </p>
            </div>

            {questions && (
              <Alert variant="info">
                <Info />
                <AlertTitle>The model needs a bit more to go on</AlertTitle>
                <AlertDescription>
                  <p>Answer these in “What really happened”, then generate again:</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {questions.map((question) => (
                      <li key={question}>{question}</li>
                    ))}
                  </ul>
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => experienceRef.current?.focus()}>
                    <PencilLine />
                    Add details
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            {error && error.message && <ErrorAlert error={error} />}
          </div>

          <div className="grid content-start gap-5 border-t bg-surface/40 p-5 lg:border-t-0 lg:border-l">
            <div className="grid gap-2">
              <Label htmlFor="audience">Audience</Label>
              <Input
                id="audience"
                value={audience}
                onChange={(event) => setAudience(event.target.value)}
                placeholder="e.g. Software developers"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tone">Tone</Label>
              <Input
                id="tone"
                value={tone}
                onChange={(event) => setTone(event.target.value)}
                placeholder="e.g. Casual and technical"
              />
            </div>
            <div className="grid gap-2">
              <Label id="length-label">Length</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                aria-labelledby="length-label"
                className="w-full"
                value={length}
                onValueChange={(value) => value && setLength(value as Length)}
              >
                {LENGTHS.map((option) => (
                  <ToggleGroupItem key={option.value} value={option.value} className="flex-1">
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            {profileNote !== null && (
              <div className="flex items-start gap-2 rounded-lg border bg-card px-3 py-2.5 text-xs">
                <UserRound className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <p className="text-muted-foreground">
                  {profileNote || "No profile yet, so posts are less personal."}{" "}
                  <Link href="/profile" className="font-medium text-foreground underline underline-offset-2">
                    {profileNote ? "Edit profile" : "Add profile"}
                  </Link>
                  {" · "}
                  <Link href="/instructions" className="font-medium text-foreground underline underline-offset-2">
                    AI instructions
                  </Link>
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3.5 lg:col-span-2">
            {running ? (
              <>
                <Button type="button" variant="brand" onClick={() => stream && open(stream.postId)}>
                  <Loader2 className="animate-spin" />
                  Writing your draft… open it
                </Button>
                <Button type="button" variant="ghost" onClick={stop}>
                  <Square />
                  Stop
                </Button>
              </>
            ) : (
              <Button type="submit" size="lg" disabled={!canGenerate}>
                {starting ? <Loader2 className="animate-spin" /> : <Sparkles />}
                Generate draft
              </Button>
            )}
            <kbd className="hidden rounded border bg-surface px-1.5 py-0.5 font-mono text-[0.7rem] text-muted-foreground sm:inline">
              ⌘ ↵
            </kbd>
            <Button
              type="button"
              variant="ghost"
              className="ml-auto"
              disabled={!restored || running || !hasInput}
              onClick={clear}
            >
              <Eraser />
              Clear
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="recent-heading" className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="grid gap-0.5">
            <h2 id="recent-heading" className="text-base font-semibold tracking-tight">
              Recent posts
            </h2>
            <p className="text-sm text-muted-foreground">Your latest drafts and scheduled posts.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/calendar">
                <CalendarDays />
                Calendar
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/posts">
                <Library />
                All posts
              </Link>
            </Button>
          </div>
        </div>
        <PostsList onOpen={open} refreshKey={drawer.closedCount} updated={updated} activeId={drawer.openId} limit={5} />
      </section>

      <PostDrawer
        openId={drawer.openId}
        onClose={close}
        onOpen={open}
        onChange={setUpdated}
        stream={stream}
        onStop={stop}
      />
    </div>
  );
}

// Turns "NEED MORE CONTEXT: 1. Foo? 2. Bar?" (one per line or all on one line) into ["Foo?", "Bar?"].
function parseQuestions(text: string): string[] {
  const body = text.slice(NEED_MORE_CONTEXT.length).trim();
  let lines = body
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
  if (lines.length === 1) lines = lines[0].split(/(?<=\?)\s+/).filter(Boolean);
  return lines.length > 0 ? lines : [body];
}

function ErrorAlert({ error }: { error: GenerateError }) {
  if (error.code === "ollama_unreachable") {
    return (
      <Alert variant="destructive">
        <AlertTitle>Ollama isn&apos;t running</AlertTitle>
        <AlertDescription>
          <p>Open the Ollama app, or start it in a terminal, then try again:</p>
          <CommandLine command="ollama serve" />
        </AlertDescription>
      </Alert>
    );
  }
  if (error.code === "model_missing" && error.model) {
    return (
      <Alert variant="destructive">
        <AlertTitle>The model isn&apos;t downloaded</AlertTitle>
        <AlertDescription>
          <p>Download it in a terminal (this takes a few minutes), then try again:</p>
          <CommandLine command={`ollama pull ${error.model}`} />
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive">
      <AlertTitle>Couldn&apos;t generate a post</AlertTitle>
      <AlertDescription>{error.message}</AlertDescription>
    </Alert>
  );
}

// Mirrors what buildPostContext sends: facts when on and present, up to 3 past posts as style examples.
function describeProfileUse(profile: Profile): string {
  const hasFacts =
    profile.useFacts &&
    Boolean(
      profile.headline ||
        profile.facts.trim() ||
        profile.skills.length ||
        profile.positions.some((position) => !position.finishedOn),
    );
  const examples = profile.useStyle ? Math.min(3, profile.posts.length) : 0;
  const parts = [
    hasFacts && "your profile facts",
    examples > 0 && `${examples} style example${examples === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return parts.length > 0 ? `Using ${parts.join(" and ")}` : "Profile saved but switched off";
}
