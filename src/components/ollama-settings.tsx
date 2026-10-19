"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Cpu, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { CommandLine } from "@/components/command-line";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OllamaStatus } from "@/lib/ollama-status.ts";
import { cn } from "@/lib/utils";

function formatSize(bytes: number) {
  if (!bytes) return "";
  const gb = bytes / 1e9;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

// Whether Ollama is running, which model writes the posts, and how to fix it when something's missing.
export function OllamaSettings() {
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");

  function check() {
    setChecking(true);
    setError("");
    fetch("/api/ollama/status")
      .then((response) => response.json() as Promise<OllamaStatus>)
      .then(setStatus)
      .catch(() => setError("Couldn't check Ollama. Is the app's server still running?"))
      .finally(() => setChecking(false));
  }

  useEffect(check, []);

  const state = !status ? null : !status.reachable ? "down" : status.installed ? "ready" : "missing";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="size-4 text-muted-foreground" />
          Ollama
        </CardTitle>
        <CardDescription>Writes every post, letter and answer on this computer. Nothing goes to a cloud AI.</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" disabled={checking} onClick={check}>
            {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Check again
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!status && !error && (
          <div className="grid gap-2" aria-label="Checking Ollama">
            <span className="skeleton h-14 rounded-lg" />
          </div>
        )}
        {status && (
          <div
            className={cn(
              "flex items-start gap-3 rounded-lg border p-3.5",
              state === "ready" && "border-success/25 bg-success-soft",
              state === "missing" && "border-warning/30 bg-warning-soft",
              state === "down" && "border-destructive/30 bg-destructive-soft",
            )}
          >
            {state === "ready" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            ) : state === "missing" ? (
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            ) : (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            )}
            <div className="grid min-w-0 flex-1 gap-1">
              <p className="text-sm font-medium">
                {state === "ready"
                  ? `Ready: posts are written with ${status.model}`
                  : state === "missing"
                    ? `Ollama is running, but ${status.model} isn't downloaded`
                    : "Ollama isn't running"}
              </p>
              <p className="text-sm text-muted-foreground">
                {state === "ready"
                  ? `Answering at ${status.url}.`
                  : state === "missing"
                    ? "Download it in a terminal (it takes a few minutes), then check again:"
                    : `Nothing answered at ${status.url}. Open the Ollama app, or start it in a terminal, then check again:`}
              </p>
              {state === "missing" && <CommandLine command={`ollama pull ${status.model}`} />}
              {state === "down" && <CommandLine command="ollama serve" />}
            </div>
          </div>
        )}

        {status?.reachable && (
          <div className="grid gap-2">
            <p className="text-sm font-medium">Models on this computer</p>
            {status.models.length === 0 ? (
              <p className="text-sm text-muted-foreground">None downloaded yet.</p>
            ) : (
              <ul className="grid divide-y rounded-lg border">
                {status.models.map((model) => {
                  const active = model.name === status.model || model.name === `${status.model}:latest`;
                  return (
                    <li key={model.name} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <code className="min-w-0 flex-1 truncate font-mono text-[0.8rem]">{model.name}</code>
                      <span className="text-xs text-muted-foreground tabular-nums">{formatSize(model.size)}</span>
                      {active && <Badge variant="brand">In use</Badge>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <p className="text-xs leading-relaxed text-muted-foreground">
          To use a different model, set <code className="font-mono text-foreground">OLLAMA_MODEL</code> (and{" "}
          <code className="font-mono text-foreground">OLLAMA_URL</code> if Ollama runs elsewhere) in the .env file, then
          restart the app.
        </p>
      </CardContent>
    </Card>
  );
}
