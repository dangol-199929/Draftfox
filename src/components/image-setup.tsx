"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Loader2, RefreshCw } from "lucide-react";
import { CommandLine } from "@/components/command-line";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type EngineStatus = { id: string; label: string; ready: boolean; message?: string; command?: string };

// Which image engine this computer uses, whether it's ready, and how to set it up when it isn't.
export function ImageSetup() {
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");

  function check() {
    setChecking(true);
    setError("");
    fetch("/api/images/engine")
      .then((response) => response.json() as Promise<EngineStatus>)
      .then(setEngine)
      .catch(() => setError("Couldn't check the image engine."))
      .finally(() => setChecking(false));
  }

  useEffect(check, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Image engine</CardTitle>
        <CardDescription>
          Images are made on this computer, for free. The app picks mflux on Apple silicon Macs and ComfyUI
          elsewhere; set IMAGE_ENGINE in .env to choose.
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" disabled={checking} onClick={check}>
            {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Check again
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {engine && (
          <div className="flex items-start gap-3 rounded-lg border p-3">
            {engine.ready ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" />
            ) : (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            )}
            <div className="grid min-w-0 gap-1.5">
              <p className="text-sm font-medium">
                {engine.label} {engine.ready ? "is ready" : "isn't ready yet"}
              </p>
              {engine.message && <p className="text-sm text-muted-foreground">{engine.message}</p>}
              {engine.command && <CommandLine command={engine.command} />}
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Step-by-step setup for each engine is in the README, under &quot;Images, scheduling and automatic
          posting&quot;.
        </p>
      </CardContent>
    </Card>
  );
}
