"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Loader2, Play, Save, TriangleAlert } from "lucide-react";
import { formatWhen } from "@/components/post-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { AutopilotSettings, AutopilotState } from "@/lib/autopilot.ts";

type Form = Omit<AutopilotSettings, "topics"> & { topics: string };

const FREQUENCY_LABELS: Record<AutopilotSettings["frequency"], string> = {
  daily: "Every day",
  every3days: "Every 3 days",
  weekly: "Every week",
};

function toForm(settings: AutopilotSettings): Form {
  return { ...settings, topics: settings.topics.join("\n") };
}

function fromForm(form: Form): AutopilotSettings {
  return { ...form, topics: form.topics.split("\n").map((topic) => topic.trim()).filter(Boolean) };
}

// Settings for automatic posting: how often, at what time, about what, and whether to post or ask first.
export function AutopilotPanel() {
  const router = useRouter();
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [state, setState] = useState<AutopilotState | null>(null);
  const [busy, setBusy] = useState<"" | "saving" | "running">("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/autopilot")
      .then((response) => response.json() as Promise<{ settings: AutopilotSettings; state: AutopilotState }>)
      .then(({ settings, state }) => {
        setForm(toForm(settings));
        setSaved(JSON.stringify(toForm(settings)));
        setState(state);
      })
      .catch(() => setError("Couldn't load the automatic posting settings."));
  }, []);

  if (!form) {
    return error ? <p className="text-sm text-destructive">{error}</p> : null;
  }

  const dirty = JSON.stringify(form) !== saved;
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => current && { ...current, [key]: value });
  const topicCount = fromForm(form).topics.length;

  async function save(next: Form) {
    setBusy("saving");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/autopilot", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fromForm(next)),
      });
      const data = (await response.json()) as { settings?: AutopilotSettings; state?: AutopilotState; error?: string };
      if (!response.ok || !data.settings) throw new Error(data.error ?? `Request failed with status ${response.status}.`);
      setForm(toForm(data.settings));
      setSaved(JSON.stringify(toForm(data.settings)));
      setState(data.state ?? null);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy("");
    }
  }

  async function runNow() {
    if (dirty && !(await save(form!))) return;
    setBusy("running");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/autopilot", { method: "POST" });
      const data = (await response.json()) as { result?: string; state?: AutopilotState; error?: string; post?: { id: string } };
      if (data.state) setState(data.state);
      if (!response.ok) throw new Error(data.error ?? data.result ?? `Request failed with status ${response.status}.`);
      if (data.post) router.push(`/posts/${data.post.id}`);
      else setMessage(data.result ?? "");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="size-4" /> Automatic posting
        </CardTitle>
        <CardDescription>
          {form.enabled && state?.nextRunAt
            ? `On. Next post ${formatWhen(state.nextRunAt)}${form.mode === "auto" ? ", posted without review." : ", saved as a draft for you to review."}`
            : "Writes a post about the next topic in your list on a schedule."}
        </CardDescription>
        <CardAction>
          <Switch
            aria-label="Automatic posting"
            checked={form.enabled}
            disabled={busy !== ""}
            onCheckedChange={(enabled) => void save({ ...form, enabled })}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <p className="text-sm font-medium" id="frequency-label">
              How often
            </p>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              aria-labelledby="frequency-label"
              value={form.frequency}
              onValueChange={(value) => value && set("frequency", value as Form["frequency"])}
              className="flex-wrap"
            >
              {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                <ToggleGroupItem key={value} value={value}>
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="autopilot-time">At</Label>
            <Input
              id="autopilot-time"
              type="time"
              className="w-32"
              value={form.time}
              onChange={(event) => set("time", event.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="autopilot-topics">Topics, one per line</Label>
          <Textarea
            id="autopilot-topics"
            className="min-h-28"
            placeholder={"What I learned moving our app to TypeScript\nHow I review pull requests\nA mistake that taught me to write tests first"}
            value={form.topics}
            onChange={(event) => set("topics", event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {topicCount === 0
              ? "Each run takes the next topic, then starts over at the top."
              : `${topicCount} topic${topicCount === 1 ? "" : "s"}. Next up: “${fromForm(form).topics[(state?.nextTopic ?? 0) % topicCount]}”. Real details make better posts, so add a sentence of your own experience to each topic.`}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="autopilot-audience">Audience</Label>
            <Input
              id="autopilot-audience"
              placeholder="e.g. Software developers"
              value={form.audience}
              onChange={(event) => set("audience", event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="autopilot-tone">Tone</Label>
            <Input
              id="autopilot-tone"
              placeholder="e.g. Friendly and practical"
              value={form.tone}
              onChange={(event) => set("tone", event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <p className="text-sm font-medium" id="autopilot-length-label">
              Length
            </p>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              aria-labelledby="autopilot-length-label"
              value={form.length}
              onValueChange={(value) => value && set("length", value as Form["length"])}
            >
              <ToggleGroupItem value="short">Short</ToggleGroupItem>
              <ToggleGroupItem value="medium">Medium</ToggleGroupItem>
              <ToggleGroupItem value="long">Long</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="autopilot-image" className="grid gap-0.5">
            Add a generated image
            <span className="text-xs font-normal text-muted-foreground">Uses the local image model; adds a minute or two per post.</span>
          </Label>
          <Switch id="autopilot-image" checked={form.withImage} onCheckedChange={(value) => set("withImage", value)} />
        </div>

        <div className="grid gap-2">
          <p className="text-sm font-medium" id="autopilot-mode-label">
            When a post is written
          </p>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-labelledby="autopilot-mode-label"
            value={form.mode}
            onValueChange={(value) => value && set("mode", value as Form["mode"])}
            className="flex-wrap"
          >
            <ToggleGroupItem value="review">Save a draft for me to review</ToggleGroupItem>
            <ToggleGroupItem value="auto">Post it right away</ToggleGroupItem>
          </ToggleGroup>
          {form.mode === "auto" && (
            <div className="grid gap-2">
              <Alert>
                <TriangleAlert />
                <AlertTitle>Posts go out without you seeing them first</AlertTitle>
                <AlertDescription>
                  The model can get facts wrong or invent details. Posts are written only from your topics and
                  profile, but check your LinkedIn after each run.
                </AlertDescription>
              </Alert>
              <div className="flex items-center gap-2">
                <p className="text-sm" id="autopilot-visibility-label">
                  Who can see them
                </p>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  aria-labelledby="autopilot-visibility-label"
                  value={form.visibility}
                  onValueChange={(value) => value && set("visibility", value as Form["visibility"])}
                >
                  <ToggleGroupItem value="PUBLIC">Anyone</ToggleGroupItem>
                  <ToggleGroupItem value="CONNECTIONS">Connections</ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>
          )}
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              {error}
              {/LinkedIn page/.test(error) && (
                <>
                  {" "}
                  <Link href="/linkedin" className="underline underline-offset-2">
                    Open the LinkedIn page
                  </Link>
                </>
              )}
            </AlertDescription>
          </Alert>
        )}
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
        {state?.lastResult && (
          <p className="text-xs text-muted-foreground">
            Last run{state.lastRunAt ? ` ${formatWhen(state.lastRunAt)}` : ""}: {state.lastResult}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!dirty || busy !== ""} onClick={() => void save(form)}>
            {busy === "saving" ? <Loader2 className="animate-spin" /> : <Save />}
            Save settings
          </Button>
          <Button variant="outline" size="sm" disabled={topicCount === 0 || busy !== ""} onClick={runNow}>
            {busy === "running" ? <Loader2 className="animate-spin" /> : <Play />}
            {busy === "running" ? "Writing…" : "Write one now"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Write one now always saves a draft. Runs only happen while this app is running.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
