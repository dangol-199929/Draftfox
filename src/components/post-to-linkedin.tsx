"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ExternalLink, Loader2, Send, Undo2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { LinkedInStatus, Visibility } from "@/lib/linkedin.ts";

const MAX_LENGTH = 3000;

type Posted = { urn: string; url: string; state: "posted" | "deleting" | "deleted"; error?: string };

async function call(method: "POST" | "DELETE", body: object) {
  const response = await fetch("/api/linkedin/post", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { urn?: string; url?: string; error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed with status ${response.status}.`);
  return data;
}

// The only way the app posts: an explicit click on Post inside this confirmation dialog.
export function PostToLinkedIn({ text, disabled }: { text: string; disabled: boolean }) {
  const [status, setStatus] = useState<LinkedInStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>("PUBLIC");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [posted, setPosted] = useState<Posted | null>(null);

  useEffect(() => {
    fetch("/api/linkedin/status")
      .then((response) => response.json() as Promise<LinkedInStatus>)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  if (!status) return null;

  const ready = status.connected && !status.expired && status.canPost;
  const body = text.trim();
  const tooLong = body.length > MAX_LENGTH;
  const name = status.profile?.name ?? "you";

  async function post() {
    setPosting(true);
    setError("");
    try {
      const data = await call("POST", { text: body, visibility });
      setPosted({ urn: data.urn!, url: data.url!, state: "posted" });
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPosting(false);
    }
  }

  async function undo() {
    if (!posted) return;
    setPosted({ ...posted, state: "deleting", error: undefined });
    try {
      await call("DELETE", { urn: posted.urn });
      setPosted({ ...posted, state: "deleted" });
    } catch (err) {
      setPosted({ ...posted, state: "posted", error: (err as Error).message });
    }
  }

  return (
    <div className="grid gap-3">
      {ready ? (
        <div>
          <Button
            size="sm"
            disabled={disabled || !body}
            onClick={() => {
              setError("");
              setOpen(true);
            }}
          >
            <Send />
            Post to LinkedIn
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          <Link href="/linkedin" className="underline underline-offset-2 hover:text-foreground">
            {!status.connected
              ? "Connect LinkedIn to post directly"
              : status.expired || status.canPost
                ? "Reconnect LinkedIn to post directly"
                : "Reconnect LinkedIn to enable posting"}
          </Link>
        </p>
      )}

      {posted && (
        <Alert>
          <Check />
          <AlertTitle>{posted.state === "deleted" ? "Deleted from LinkedIn" : "Posted to LinkedIn"}</AlertTitle>
          <AlertDescription>
            {posted.state === "deleted" ? (
              <p>The post was removed from your LinkedIn.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button variant="outline" size="sm" asChild>
                  <a href={posted.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink />
                    View on LinkedIn
                  </a>
                </Button>
                <Button variant="ghost" size="sm" disabled={posted.state === "deleting"} onClick={undo}>
                  {posted.state === "deleting" ? <Loader2 className="animate-spin" /> : <Undo2 />}
                  Undo (delete from LinkedIn)
                </Button>
              </div>
            )}
            {posted.error && <p className="pt-1 text-destructive">{posted.error}</p>}
          </AlertDescription>
        </Alert>
      )}

      <AlertDialog open={open} onOpenChange={(next) => !posting && setOpen(next)}>
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Post to LinkedIn?</AlertDialogTitle>
            <AlertDialogDescription>
              {visibility === "PUBLIC"
                ? `This posts publicly to your LinkedIn as ${name}.`
                : `This posts to your LinkedIn connections as ${name}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="grid gap-3">
            <div
              aria-label="Post preview"
              className="max-h-64 overflow-y-auto rounded-lg border bg-muted/50 px-3 py-2 text-sm whitespace-pre-wrap"
            >
              {body}
            </div>
            <p className={`text-xs ${tooLong ? "text-destructive" : "text-muted-foreground"}`}>
              {body.length.toLocaleString("en")} / {MAX_LENGTH.toLocaleString("en")} characters
              {tooLong && " (too long for LinkedIn)"}
            </p>
            <div className="grid gap-2">
              <p className="text-sm font-medium" id="visibility-label">
                Who can see it
              </p>
              <ToggleGroup
                type="single"
                variant="outline"
                aria-labelledby="visibility-label"
                value={visibility}
                onValueChange={(value) => value && setVisibility(value as Visibility)}
              >
                <ToggleGroupItem value="PUBLIC">Anyone</ToggleGroupItem>
                <ToggleGroupItem value="CONNECTIONS">Connections only</ToggleGroupItem>
              </ToggleGroup>
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={posting}>Cancel</AlertDialogCancel>
            <Button disabled={posting || tooLong || !body} onClick={post}>
              {posting ? <Loader2 className="animate-spin" /> : <Send />}
              {posting ? "Posting…" : "Post"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
