"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, Eraser, Info, Loader2, PencilLine, RefreshCw, Square } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PostToLinkedIn } from "@/components/post-to-linkedin";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Profile } from "@/lib/profile.ts";
import type { PostInput } from "@/lib/prompts.ts";
import { useSavedState } from "@/lib/use-saved-state.ts";

type Length = NonNullable<PostInput["length"]>;

type GenerateError = { message: string; code?: string; model?: string };

// What's kept across page switches and reloads: the form, the current draft and what produced it.
type SavedGenerate = {
  topic: string;
  experience: string;
  audience: string;
  tone: string;
  length: Length;
  post: string;
  seconds: number | null;
  lastInput: PostInput | null;
};

const NEED_MORE_CONTEXT = "NEED MORE CONTEXT:";

const LENGTHS: { value: Length; label: string }[] = [
  { value: "short", label: "Short" },
  { value: "medium", label: "Medium" },
  { value: "long", label: "Long" },
];

export function GenerateForm() {
  const [topic, setTopic] = useState("");
  const [experience, setExperience] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("");
  const [length, setLength] = useState<Length>("medium");

  const [post, setPost] = useState("");
  const [seconds, setSeconds] = useState<number | null>(null);
  const [error, setError] = useState<GenerateError | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastInput, setLastInput] = useState<PostInput | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const experienceRef = useRef<HTMLTextAreaElement>(null);
  const [profileNote, setProfileNote] = useState<string | null>(null);

  const restored = useSavedState<SavedGenerate>(
    "generate",
    { topic, experience, audience, tone, length, post, seconds, lastInput },
    (saved) => {
      setTopic(saved.topic ?? "");
      setExperience(saved.experience ?? "");
      setAudience(saved.audience ?? "");
      setTone(saved.tone ?? "");
      if (LENGTHS.some((option) => option.value === saved.length)) setLength(saved.length);
      setPost(saved.post ?? "");
      setSeconds(saved.seconds ?? null);
      setLastInput(saved.lastInput ?? null);
    },
  );

  useEffect(() => {
    fetch("/api/profile")
      .then((response) => response.json() as Promise<{ profile?: Profile; exists?: boolean }>)
      .then(({ profile, exists }) => setProfileNote(exists && profile ? describeProfileUse(profile) : ""))
      .catch(() => setProfileNote(null));
  }, []);

  const canGenerate = restored && topic.trim() !== "" && !loading;
  const words = post.split(/\s+/).filter(Boolean).length;
  const questions = !loading && post.startsWith(NEED_MORE_CONTEXT) ? parseQuestions(post) : null;

  async function generate(input: PostInput) {
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setLastInput(input);
    const start = Date.now();
    let streamed = false;
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as Partial<GenerateError> & { error?: string };
        setError({
          message: data.error ?? `Request failed with status ${response.status}.`,
          code: data.code,
          model: data.model,
        });
        return;
      }

      streamed = true;
      setPost("");
      setSeconds(null);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        setPost((current) => current + text);
      }
    } catch (err) {
      // Stopping on purpose keeps the partial post without an error.
      if (!controller.signal.aborted) {
        setError({
          message: streamed
            ? "The connection dropped before the post was finished. The partial post is kept."
            : (err as Error).message,
        });
      }
    } finally {
      if (streamed) {
        setPost((current) => current.trim());
        setSeconds((Date.now() - start) / 1000);
      }
      setLoading(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function submit() {
    if (!canGenerate) return;
    generate({ topic, experience, audience, tone, length });
  }

  // Empties the form and the draft (and so the saved copy), keeping the chosen length.
  function clear() {
    if (post && !window.confirm("Clear the form and your current draft?")) return;
    setTopic("");
    setExperience("");
    setAudience("");
    setTone("");
    setPost("");
    setSeconds(null);
    setLastInput(null);
    setError(null);
  }

  async function copy() {
    await navigator.clipboard.writeText(post);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 md:items-start">
      <Card>
        <CardHeader>
          <CardTitle>Post details</CardTitle>
          <CardDescription>Only the topic is required.</CardDescription>
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

            <div className="grid gap-2">
              <Label htmlFor="experience">Your experience</Label>
              <Textarea
                id="experience"
                ref={experienceRef}
                rows={4}
                value={experience}
                onChange={(event) => setExperience(event.target.value)}
                placeholder="e.g. I spent several hours debugging Docker networking."
              />
              <p className="text-xs text-muted-foreground">
                Only what really happened. The post won&apos;t invent anything beyond this.
              </p>
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

            {loading ? (
              <Button type="button" variant="outline" onClick={stop}>
                <Square />
                Stop
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button type="submit" className="flex-1" disabled={!canGenerate}>
                  Generate
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!restored || !(topic || experience || audience || tone || post)}
                  onClick={clear}
                >
                  <Eraser />
                  Start over
                </Button>
              </div>
            )}
          </form>
          {profileNote !== null && (
            <p className="mt-4 text-xs text-muted-foreground">
              {profileNote ? `${profileNote} · ` : "Add your profile for more personal posts · "}
              <Link href="/profile" className="underline underline-offset-2 hover:text-foreground">
                {profileNote ? "Edit" : "Add profile"}
              </Link>
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {error && <ErrorAlert error={error} />}

        <Card>
          <CardHeader>
            <CardTitle>Your post</CardTitle>
            <CardDescription>Edit freely, then copy it into LinkedIn.</CardDescription>
          </CardHeader>
          <CardContent>
            {questions ? (
              <div className="grid gap-3">
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
                  </AlertDescription>
                </Alert>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => experienceRef.current?.focus()}>
                    <PencilLine />
                    Add details
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => lastInput && generate(lastInput)}>
                    <RefreshCw />
                    Regenerate
                  </Button>
                </div>
              </div>
            ) : post ? (
              <div className="grid gap-3">
                <Textarea
                  aria-label="Generated post"
                  className="min-h-64 leading-relaxed"
                  value={post}
                  readOnly={loading}
                  onChange={(event) => setPost(event.target.value)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" disabled={loading || !post} onClick={copy}>
                    {copied ? <Check /> : <Copy />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading || !lastInput}
                    onClick={() => lastInput && generate(lastInput)}
                  >
                    <RefreshCw />
                    Regenerate
                  </Button>
                  <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                    {loading ? (
                      <>
                        <Loader2 className="size-3 animate-spin" />
                        Writing… {words} words
                      </>
                    ) : (
                      <>
                        {words} words{seconds !== null && ` · ${seconds.toFixed(1)}s`}
                      </>
                    )}
                  </span>
                </div>
                <PostToLinkedIn text={post} disabled={loading} />
              </div>
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                {loading ? "Writing your post…" : "Your post will appear here."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
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

function CommandLine({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-2 flex items-center gap-1 rounded-md bg-muted pl-3 text-foreground">
      <code className="min-w-0 flex-1 overflow-x-auto py-1.5 font-mono text-xs whitespace-nowrap">{command}</code>
      <Button variant="ghost" size="icon-sm" aria-label={`Copy "${command}"`} onClick={copy}>
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
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
