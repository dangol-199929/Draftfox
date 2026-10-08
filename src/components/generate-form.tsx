"use client";

import { useState } from "react";
import { Check, Copy, Loader2, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { PostInput } from "@/lib/prompts.ts";

type Length = NonNullable<PostInput["length"]>;

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
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastInput, setLastInput] = useState<PostInput | null>(null);

  const canGenerate = topic.trim() !== "" && !loading;
  const words = post.split(/\s+/).filter(Boolean).length;

  async function generate(input: PostInput) {
    setLoading(true);
    setError("");
    setLastInput(input);
    const start = Date.now();
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = (await response.json()) as { post?: string; error?: string };
      if (!response.ok || data.post === undefined) {
        throw new Error(data.error ?? `Request failed with status ${response.status}.`);
      }
      setPost(data.post);
      setSeconds((Date.now() - start) / 1000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function submit() {
    if (!canGenerate) return;
    generate({ topic, experience, audience, tone, length });
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
          <CardTitle>Generate a post</CardTitle>
          <CardDescription>Drafts only. Nothing is posted to LinkedIn.</CardDescription>
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

            <Button type="submit" disabled={!canGenerate}>
              {loading ? (
                <>
                  <Loader2 className="animate-spin" />
                  Writing…
                </>
              ) : (
                "Generate"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Couldn&apos;t generate a post</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Your post</CardTitle>
            <CardDescription>Edit freely, then copy it into LinkedIn.</CardDescription>
          </CardHeader>
          <CardContent>
            {post ? (
              <div className="grid gap-3">
                <Textarea
                  aria-label="Generated post"
                  className="min-h-64 leading-relaxed"
                  value={post}
                  onChange={(event) => setPost(event.target.value)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={copy}>
                    {copied ? <Check /> : <Copy />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading || !lastInput}
                    onClick={() => lastInput && generate(lastInput)}
                  >
                    <RefreshCw className={loading ? "animate-spin" : undefined} />
                    Regenerate
                  </Button>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {words} words{seconds !== null && ` · ${seconds.toFixed(1)}s`}
                  </span>
                </div>
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
