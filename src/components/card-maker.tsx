"use client";

import { useEffect, useRef, useState } from "react";
import { LayoutTemplate, Loader2, RefreshCw, Sparkles, Square } from "lucide-react";
import { CommandLine } from "@/components/command-line";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CARTOON_SIZE, PALETTES, type Layout, type Palette } from "@/lib/card-styles.ts";
import { cn } from "@/lib/utils";

type Content = { tag: string; hook: string; points: string[]; illustration: string };
type Failure = { message: string; command?: string };

const PALETTE_OPTIONS = Object.entries(PALETTES).map(([value, colors]) => ({
  value: value as Palette,
  label: colors.label,
  bg: colors.bg,
  accent: colors.accent,
}));

const EMPTY: Content = { tag: "", hook: "", points: ["", "", ""], illustration: "" };

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed with status ${response.status}.`);
  return data;
}

// A designed image: hook and key points laid out on a grid around a simple 2D cartoon.
// The text is filled in from the post and stays editable; the cartoon is made once and reused when you redraw.
// onImage gets the card's id and alt text that repeats the words on the card for screen readers.
export function CardMaker({ postText, onImage }: { postText: string; onImage: (id: string, alt: string) => void }) {
  const [content, setContent] = useState<Content>(EMPTY);
  const [palette, setPalette] = useState<Palette>("cream");
  const [layout, setLayout] = useState<Layout>("portrait");
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState<"" | "cartoon" | "drawing">("");
  const [progress, setProgress] = useState<{ completed: number; total: number; label?: string } | null>(null);
  const [error, setError] = useState<Failure | null>(null);
  // The cartoon already made, and for which idea, so changing only the text doesn't make a new one.
  const [cartoon, setCartoon] = useState<{ id: string; idea: string; layout: Layout } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const set = <K extends keyof Content>(key: K, value: Content[K]) => setContent((current) => ({ ...current, [key]: value }));
  const ready = content.hook.trim() !== "";
  // A new cartoon is needed when the idea changed, or the shape did (the cartoon is wide for portrait, tall for square).
  const needsCartoon =
    content.illustration.trim() !== "" && (cartoon?.idea !== content.illustration.trim() || cartoon?.layout !== layout);

  async function write() {
    setWriting(true);
    setError(null);
    try {
      const { content: written } = await postJson<{ content: Content }>("/api/cards/content", { text: postText });
      const points = [...written.points, "", "", ""].slice(0, Math.max(3, written.points.length));
      setContent({ ...written, points });
    } catch (err) {
      setError({ message: (err as Error).message });
    } finally {
      setWriting(false);
    }
  }

  // Makes the cartoon with the image engine, streaming progress. Returns its image id.
  async function makeCartoon(idea: string): Promise<string | null> {
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy("cartoon");
    setProgress(null);
    try {
      const response = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: idea, style: "cartoon", size: CARTOON_SIZE[layout] }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed with status ${response.status}.`);
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let id: string | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        buffer += value ?? "";
        const lines = buffer.split("\n");
        buffer = done ? "" : (lines.pop() ?? "");
        for (const line of lines) {
          if (!line.trim()) continue;
          const message = JSON.parse(line) as {
            progress?: { completed: number; total: number; label?: string };
            image?: { id: string };
            error?: string;
            command?: string;
          };
          if (message.progress) setProgress(message.progress);
          if (message.error) setError({ message: message.error, command: message.command });
          if (message.image) id = message.image.id;
        }
        if (done) break;
      }
      if (id) setCartoon({ id, idea, layout });
      return id;
    } catch (err) {
      if (!controller.signal.aborted) setError({ message: (err as Error).message });
      return null;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setProgress(null);
    }
  }

  async function make(redoCartoon = false) {
    setError(null);
    try {
      const idea = content.illustration.trim();
      let cartoonId = cartoon?.id ?? null;
      if (idea && (redoCartoon || needsCartoon || !cartoonId)) {
        cartoonId = await makeCartoon(idea);
        if (!cartoonId) return;
      }
      if (!idea) cartoonId = null;
      setBusy("drawing");
      const { image } = await postJson<{ image: { id: string } }>("/api/cards/render", {
        content: { ...content, points: content.points.filter((point) => point.trim()) },
        palette,
        layout,
        illustrationId: cartoonId,
      });
      const points = content.points.filter((point) => point.trim());
      onImage(image.id, [content.hook.replace(/\*/g, ""), ...points].join(". ").slice(0, 1000));
    } catch (err) {
      setError({ message: (err as Error).message });
    } finally {
      setBusy("");
    }
  }

  const percent = progress ? Math.round((progress.completed / progress.total) * 100) : null;

  return (
    <div className="grid gap-4 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Designed card</p>
        <Button variant="outline" size="sm" disabled={writing || busy !== "" || !postText.trim()} onClick={write}>
          {writing ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {writing ? "Writing…" : content.hook ? "Rewrite from post" : "Write from post"}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <div className="grid gap-1.5">
          <Label htmlFor="card-tag">Label</Label>
          <Input id="card-tag" placeholder="e.g. Career tip" maxLength={40} value={content.tag} onChange={(event) => set("tag", event.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="card-hook">Hook</Label>
          <Input
            id="card-hook"
            placeholder="Short and punchy. *Stars* color a word."
            maxLength={90}
            value={content.hook}
            onChange={(event) => set("hook", event.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <p className="text-sm font-medium">Key points</p>
        {content.points.map((point, index) => (
          <Input
            key={index}
            aria-label={`Point ${index + 1}`}
            placeholder={`Point ${index + 1} (optional)`}
            maxLength={90}
            value={point}
            onChange={(event) =>
              set(
                "points",
                content.points.map((item, i) => (i === index ? event.target.value : item)),
              )
            }
          />
        ))}
        {content.points.length < 4 && (
          <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => set("points", [...content.points, ""])}>
            Add a point
          </Button>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="card-cartoon">Cartoon</Label>
        <Textarea
          id="card-cartoon"
          className="min-h-16"
          placeholder="What the cartoon shows, e.g. a friendly robot handing a notebook to a person. Leave empty for text only."
          value={content.illustration}
          onChange={(event) => set("illustration", event.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Colors">
          {PALETTE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={palette === option.value}
              aria-label={option.label}
              title={option.label}
              onClick={() => setPalette(option.value)}
              className={cn(
                "flex size-7 items-center justify-center rounded-full border transition-shadow",
                palette === option.value && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
              )}
              style={{ background: option.bg }}
            >
              <span className="size-3 rounded-full" style={{ background: option.accent }} />
            </button>
          ))}
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Shape"
          value={layout}
          onValueChange={(value) => value && setLayout(value as Layout)}
        >
          <ToggleGroupItem value="portrait">Portrait</ToggleGroupItem>
          <ToggleGroupItem value="square">Square</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {busy === "cartoon" ? (
          <Button variant="outline" size="sm" onClick={() => abortRef.current?.abort()}>
            <Square />
            Stop
          </Button>
        ) : (
          <Button size="sm" disabled={!ready || busy !== "" || writing} onClick={() => make()}>
            {busy === "drawing" ? <Loader2 className="animate-spin" /> : <LayoutTemplate />}
            {cartoon && !needsCartoon ? "Make card" : content.illustration.trim() ? "Make card and cartoon" : "Make card"}
          </Button>
        )}
        {cartoon && !needsCartoon && busy === "" && (
          <Button variant="ghost" size="sm" disabled={!ready || writing} onClick={() => make(true)}>
            <RefreshCw />
            New cartoon
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          {cartoon && !needsCartoon ? "Edits to the text redraw instantly with the same cartoon." : "Each card is added to the post below the others."}
        </span>
      </div>

      {busy === "cartoon" && (
        <div className="grid gap-1.5" aria-live="polite">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full bg-foreground transition-[width] ${percent === null ? "w-1/4 animate-pulse" : ""}`}
              style={percent === null ? undefined : { width: `${percent}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {percent === null ? "Loading the image model…" : `${progress?.label ?? "Drawing the cartoon"}… ${percent}%`}
            {!progress?.label && " This can take a minute or two."}
          </p>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t make the card</AlertTitle>
          <AlertDescription>
            <p>{error.message}</p>
            {error.command && <CommandLine command={error.command} />}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
