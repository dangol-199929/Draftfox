"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Lightbulb, Loader2, Square } from "lucide-react";
import { CommandLine } from "@/components/command-line";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Size = "landscape" | "square" | "portrait";

const SIZES: { value: Size; label: string }[] = [
  { value: "landscape", label: "Landscape" },
  { value: "square", label: "Square" },
  { value: "portrait", label: "Portrait" },
];

type GenerateError = { message: string; code?: string; command?: string };

type EngineStatus = { id: string; label: string; ready: boolean; message?: string; command?: string };

// Makes an image with the local image model, from a prompt you write or one suggested from the post.
export function ImageGenerator({ postText, onImage }: { postText: string; onImage: (id: string) => void }) {
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<Size>("landscape");
  const [suggesting, setSuggesting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number; label?: string } | null>(null);
  const [error, setError] = useState<GenerateError | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [engine, setEngine] = useState<EngineStatus | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Recheck whenever an error clears or appears, so installing the engine shows up without a reload.
  useEffect(() => {
    fetch("/api/images/engine")
      .then((response) => response.json() as Promise<EngineStatus>)
      .then(setEngine)
      .catch(() => setEngine(null));
  }, [error]);

  async function suggest() {
    setSuggesting(true);
    setError(null);
    try {
      const response = await fetch("/api/images/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: postText }),
      });
      const data = (await response.json().catch(() => ({}))) as { prompt?: string; error?: string };
      if (!response.ok || !data.prompt) throw new Error(data.error ?? `Request failed with status ${response.status}.`);
      setPrompt(data.prompt);
    } catch (err) {
      setError({ message: (err as Error).message });
    } finally {
      setSuggesting(false);
    }
  }

  async function generate() {
    const controller = new AbortController();
    abortRef.current = controller;
    setGenerating(true);
    setProgress(null);
    setError(null);
    try {
      const response = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, size }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed with status ${response.status}.`);
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let done = false;
      while (!done) {
        const chunk = await reader.read();
        done = chunk.done;
        buffer += chunk.value ?? "";
        const lines = buffer.split("\n");
        buffer = done ? "" : (lines.pop() ?? "");
        for (const line of lines) {
          if (!line.trim()) continue;
          const message = JSON.parse(line) as {
            progress?: { completed: number; total: number; label?: string };
            image?: { id: string };
            error?: string;
            code?: string;
            command?: string;
          };
          if (message.progress) setProgress(message.progress);
          if (message.error) setError({ message: message.error, code: message.code, command: message.command });
          if (message.image) onImage(message.image.id);
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) setError({ message: (err as Error).message });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setGenerating(false);
      setProgress(null);
    }
  }

  const percent = progress ? Math.round((progress.completed / progress.total) * 100) : null;

  return (
    <div className="grid gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor="image-prompt">Generate an image</Label>
        <Button
          variant="ghost"
          size="sm"
          disabled={suggesting || generating || !postText.trim()}
          onClick={suggest}
        >
          {suggesting ? <Loader2 className="animate-spin" /> : <Lightbulb />}
          {suggesting ? "Thinking…" : "Suggest from post"}
        </Button>
      </div>
      <Textarea
        id="image-prompt"
        placeholder="Describe the image, e.g. a tidy desk with a laptop showing code, soft morning light"
        className="min-h-20"
        value={prompt}
        disabled={generating}
        onChange={(event) => setPrompt(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Image shape"
          value={size}
          disabled={generating}
          onValueChange={(value) => value && setSize(value as Size)}
        >
          {SIZES.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value}>
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {generating ? (
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => abortRef.current?.abort()}>
            <Square />
            Stop
          </Button>
        ) : (
          <Button size="sm" className="ml-auto" disabled={!prompt.trim()} onClick={generate}>
            <ImagePlus />
            Generate image
          </Button>
        )}
      </div>
      {generating && (
        <div className="grid gap-1.5" aria-live="polite">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full bg-foreground transition-[width] ${percent === null ? "w-1/4 animate-pulse" : ""}`}
              style={percent === null ? undefined : { width: `${percent}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {percent === null
              ? "Loading the image model…"
              : `${progress?.label ?? "Making the image"}… ${percent}%`}{" "}
            {progress?.label ? "" : "This can take a minute or two."}
          </p>
        </div>
      )}
      {engine && !error && (
        engine.ready ? (
          <p className="text-xs text-muted-foreground">Images are made on this computer with {engine.label}.</p>
        ) : (
          <Alert>
            <AlertTitle>Set up image generation</AlertTitle>
            <AlertDescription>
              <p>{engine.message}</p>
              {engine.command && <CommandLine command={engine.command} />}
            </AlertDescription>
          </Alert>
        )
      )}
      {error && <ImageError error={error} />}
    </div>
  );
}

function ImageError({ error }: { error: GenerateError }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Couldn&apos;t make the image</AlertTitle>
      <AlertDescription>
        <p>{error.message}</p>
        {error.command && <CommandLine command={error.command} />}
      </AlertDescription>
    </Alert>
  );
}
