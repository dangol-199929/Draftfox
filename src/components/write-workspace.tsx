"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, Eraser, FileText, Info, Loader2, PencilLine, Sparkles } from "lucide-react";
import { AutopilotPanel } from "@/components/autopilot-panel";
import { CommandLine } from "@/components/command-line";
import { PostEditor, type PostStream } from "@/components/post-editor";
import { PostsList } from "@/components/posts-list";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { PostRecord } from "@/lib/db.ts";
import type { GenerationSnapshot } from "@/lib/generation.ts";
import type { Profile } from "@/lib/profile.ts";
import type { PostInput } from "@/lib/prompts.ts";
import { useSavedState } from "@/lib/use-saved-state.ts";

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

type Tab = "posts" | "schedule";

// The Write page: the generate box, your posts, automatic posting, and the post editor in a drawer.
export function WriteWorkspace({ initialPost, initialTab }: { initialPost: string | null; initialTab: Tab }) {
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
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [refreshKey, setRefreshKey] = useState(0);
  const [updated, setUpdated] = useState<PostRecord | null>(null);
  const [profileNote, setProfileNote] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const experienceRef = useRef<HTMLTextAreaElement>(null);

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

  const setUrl = useCallback((postId: string | null, nextTab: Tab) => {
    const params = new URLSearchParams();
    if (postId) params.set("post", postId);
    if (nextTab === "schedule") params.set("tab", "schedule");
    const query = params.toString();
    window.history.replaceState(null, "", query ? `/?${query}` : "/");
  }, []);

  const open = useCallback(
    (postId: string) => {
      setOpenId(postId);
      setUrl(postId, "posts");
    },
    [setUrl],
  );

  // Links like /?post=<id> (from automatic posting or the Jobs page) open that post.
  useEffect(() => {
    if (initialPost) open(initialPost);
  }, [initialPost, open]);

  function close() {
    setOpenId(null);
    // A finished stream has done its job; reopening the post shows what was saved, edits included.
    setStream((current) => (current?.running ? current : null));
    setUrl(null, tab);
    setRefreshKey((key) => key + 1);
  }

  function changeTab(next: string) {
    setTab(next as Tab);
    setUrl(openId, next as Tab);
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
    setOpenId((current) => (current === postId ? null : current));
    setUrl(null, tab);
    setError(problem);
    setRefreshKey((key) => key + 1);
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

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-brand" />
            Write a post with AI
          </CardTitle>
          <CardDescription>
            Only the topic is required. The post opens in the editor as it&apos;s written and is saved as a draft.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-5"
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
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="grid content-start gap-5">
                <div className="grid gap-2">
                  <Label htmlFor="topic">Topic</Label>
                  <Input
                    id="topic"
                    required
                    value={topic}
                    onChange={(event) => setTopic(event.target.value)}
                    placeholder="e.g. What I learned from using Docker"
                  />
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
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
                </div>
                <div className="grid gap-2">
                  <Label id="length-label">Length</Label>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    aria-labelledby="length-label"
                    value={length}
                    onValueChange={(value) => value && setLength(value as Length)}
                  >
                    {LENGTHS.map((option) => (
                      <ToggleGroupItem key={option.value} value={option.value}>
                        {option.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              </div>
              <div className="grid content-start gap-2">
                <Label htmlFor="experience">Your experience</Label>
                <Textarea
                  id="experience"
                  ref={experienceRef}
                  rows={6}
                  className="lg:min-h-44"
                  value={experience}
                  onChange={(event) => setExperience(event.target.value)}
                  placeholder="e.g. I spent several hours debugging Docker networking."
                />
                <p className="text-xs text-muted-foreground">
                  Only what really happened. The post won&apos;t invent anything beyond this.
                </p>
              </div>
            </div>

            {questions && (
              <Alert>
                <Info />
                <AlertTitle>The model needs more context</AlertTitle>
                <AlertDescription>
                  <p>Answer these in “Your experience”, then generate again:</p>
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

            <div className="flex flex-wrap items-center gap-2">
              {running ? (
                <>
                  <Button type="button" variant="outline" onClick={() => stream && open(stream.postId)}>
                    <Loader2 className="animate-spin" />
                    Writing… open the draft
                  </Button>
                  <Button type="button" variant="ghost" onClick={stop}>
                    Stop
                  </Button>
                </>
              ) : (
                <Button type="submit" disabled={!canGenerate}>
                  {starting ? <Loader2 className="animate-spin" /> : <Sparkles />}
                  Generate
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                disabled={!restored || running || !(topic || experience || audience || tone)}
                onClick={clear}
              >
                <Eraser />
                Clear
              </Button>
              {profileNote !== null && (
                <p className="ml-auto text-xs text-muted-foreground">
                  {profileNote ? `${profileNote} · ` : "Add your profile for more personal posts · "}
                  <Link href="/profile" className="underline underline-offset-2 hover:text-foreground">
                    {profileNote ? "Edit" : "Add profile"}
                  </Link>
                </p>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList aria-label="Posts or automatic posting">
          <TabsTrigger value="posts">
            <FileText />
            Drafts &amp; scheduled
          </TabsTrigger>
          <TabsTrigger value="schedule">
            <Bot />
            Automatic posting
          </TabsTrigger>
        </TabsList>
        <TabsContent value="posts">
          <PostsList onOpen={open} refreshKey={refreshKey} updated={updated} activeId={openId} />
        </TabsContent>
        <TabsContent value="schedule">
          <AutopilotPanel onOpen={open} />
        </TabsContent>
      </Tabs>

      <Sheet open={openId !== null} onOpenChange={(next) => !next && close()}>
        <SheetContent
          side="right"
          className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-[min(72rem,94vw)]"
        >
          <SheetHeader className="sticky top-0 z-10 border-b bg-popover/95 pr-12 backdrop-blur">
            <SheetTitle>Edit post</SheetTitle>
            <SheetDescription>Nothing is posted unless you choose to.</SheetDescription>
          </SheetHeader>
          <div className="p-4">
            {openId && (
              <PostEditor
                key={openId}
                id={openId}
                stream={stream?.postId === openId ? stream : null}
                onStop={stop}
                onDeleted={close}
                onOpen={open}
                onChange={setUpdated}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
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
