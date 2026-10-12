"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useSavedState } from "@/lib/use-saved-state.ts";

type PromptState = {
  prompt: string;
  defaultPrompt: string;
  isDefault: boolean;
};

async function request(method: "GET" | "PUT" | "DELETE", prompt?: string): Promise<PromptState> {
  const response = await fetch("/api/prompt", {
    method,
    headers: prompt === undefined ? undefined : { "Content-Type": "application/json" },
    body: prompt === undefined ? undefined : JSON.stringify({ prompt }),
  });
  const data = (await response.json().catch(() => ({}))) as Partial<PromptState> & { error?: string };
  if (!response.ok || data.prompt === undefined) {
    throw new Error(data.error ?? `Request failed with status ${response.status}.`);
  }
  return data as PromptState;
}

export function PromptEditor() {
  const [saved, setSaved] = useState<PromptState | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"saving" | "resetting" | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState("");

  const dirty = saved !== null && draft !== saved.prompt;
  const words = draft.split(/\s+/).filter(Boolean).length;

  useEffect(() => {
    request("GET")
      .then((state) => {
        setSaved(state);
        setDraft(state.prompt);
      })
      .catch((err: Error) => setError(`Couldn't load the prompt: ${err.message}`));
  }, []);

  // Unsaved edits are kept in the local database until you save or discard them.
  useSavedState<string>("prompt", dirty ? draft : null, setDraft, saved !== null);

  async function update(method: "PUT" | "DELETE") {
    setBusy(method === "PUT" ? "saving" : "resetting");
    setError("");
    try {
      const state = await request(method, method === "PUT" ? draft : undefined);
      setSaved(state);
      setDraft(state.prompt);
      if (method === "PUT") {
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2000);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>System prompt</CardTitle>
          <CardDescription>Sent to the model before every post request.</CardDescription>
          {saved && (
            <CardAction>
              <Badge variant={saved.isDefault ? "secondary" : "outline"}>
                {saved.isDefault ? "Default" : "Custom"}
              </Badge>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="grid gap-3">
          {saved === null && !error ? (
            <p className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading prompt…
            </p>
          ) : (
            <>
              <Textarea
                aria-label="System prompt"
                spellCheck={false}
                className="min-h-96 max-h-[70vh] overflow-y-auto font-mono text-xs leading-relaxed md:text-xs"
                value={draft}
                disabled={saved === null}
                onChange={(event) => setDraft(event.target.value)}
              />
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {draft.length.toLocaleString("en")} characters · {words.toLocaleString("en")} words
                </span>
                {dirty && <span className="text-foreground">Unsaved changes</span>}
              </div>
              <p className="text-xs text-muted-foreground">
                Tip: keep the &apos;NEED MORE CONTEXT:&apos; instruction if you want the model to ask questions when
                a topic is too vague.
              </p>

              <div className="flex flex-wrap gap-2 pt-1">
                <Button disabled={!dirty || busy !== null || !draft.trim()} onClick={() => update("PUT")}>
                  {busy === "saving" ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Saving…
                    </>
                  ) : justSaved ? (
                    <>
                      <Check />
                      Saved
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
                <Button
                  variant="outline"
                  disabled={!dirty || busy !== null}
                  onClick={() => saved && setDraft(saved.prompt)}
                >
                  Discard changes
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      className="sm:ml-auto"
                      disabled={busy !== null || saved === null || (saved.isDefault && !dirty)}
                    >
                      {busy === "resetting" && <Loader2 className="animate-spin" />}
                      Reset to default
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Reset to the default prompt?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Your custom prompt and any unsaved changes will be replaced by the built-in default. This
                        can&apos;t be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={() => update("DELETE")}>
                        Reset
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
