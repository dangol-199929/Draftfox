"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PREPARE_OPTIONS, type JobSettings } from "@/lib/job-status.ts";

// Options for the Jobs page: when the cover letter starts, and what Prepare application writes.
export function JobSettingsCard() {
  const [settings, setSettings] = useState<JobSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings/jobs")
      .then((response) => response.json() as Promise<{ settings: JobSettings }>)
      .then(({ settings }) => setSettings(settings))
      .catch(() => setError("Couldn't load the job settings."));
  }, []);

  async function update(changes: Partial<JobSettings>) {
    setSettings((current) => current && { ...current, ...changes });
    setError("");
    try {
      const response = await fetch("/api/settings/jobs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      if (!response.ok) throw new Error();
      setSettings(((await response.json()) as { settings: JobSettings }).settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      setError("Couldn't save that setting.");
    }
  }

  const prepare = PREPARE_OPTIONS.find((option) => option.value === settings?.prepareMakes);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Applications
          {saved && (
            <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <Check className="size-3.5 text-brand" /> Saved
            </span>
          )}
        </CardTitle>
        <CardDescription>What the Jobs page writes for you. You always apply yourself.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {error && <p className="text-sm text-destructive">{error}</p>}
        <label className="flex items-start justify-between gap-4 text-sm">
          <span className="grid gap-0.5">
            <span className="font-medium">Start writing the cover letter when I open a job</span>
            <span className="text-xs text-muted-foreground">
              For jobs in My jobs that don&apos;t have one yet. Off means it waits until you ask.
            </span>
          </span>
          <Switch
            aria-label="Start writing the cover letter when I open a job"
            disabled={!settings}
            checked={settings?.autoLetter ?? false}
            onCheckedChange={(autoLetter) => void update({ autoLetter })}
          />
        </label>
        <div className="grid gap-2">
          <p className="text-sm font-medium" id="prepare-label">
            Prepare application makes
          </p>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-labelledby="prepare-label"
            className="flex-wrap justify-self-start"
            disabled={!settings}
            value={settings?.prepareMakes ?? ""}
            onValueChange={(value) => value && void update({ prepareMakes: value as JobSettings["prepareMakes"] })}
          >
            {PREPARE_OPTIONS.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value}>
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {prepare && <p className="text-xs text-muted-foreground">{prepare.description}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
