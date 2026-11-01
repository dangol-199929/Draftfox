"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleDashed, Loader2, TriangleAlert } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const LOGIN_URL = "/api/youtube/login";

type Status = { configured: boolean; connected: boolean; needsReconnect: boolean; connectedAt: string | null };

const ERRORS: Record<string, string> = {
  access_denied: "YouTube access wasn't granted. If the app is in Testing mode, add your Google account as a test user.",
  not_configured: "Add YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET to .env, then restart the app.",
  state_mismatch: "The sign-in took too long or came from another tab. Try again.",
  token_exchange_failed: "Google didn't accept the sign-in. Try again.",
};

export function YouTubeSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    // The callback comes back with ?youtube=connected or ?youtube_error=code.
    const params = new URLSearchParams(window.location.search);
    const code = params.get("youtube_error");
    if (code) setError(ERRORS[code] ?? `YouTube sign-in failed (${code}).`);
    else if (params.get("youtube") === "connected") setMessage("YouTube connected.");
    fetch("/api/youtube/status")
      .then((response) => {
        if (!response.ok) throw new Error(`Request failed with status ${response.status}.`);
        return response.json() as Promise<Status>;
      })
      .then(setStatus)
      .catch((err: Error) => setError(`Couldn't check YouTube: ${err.message}`));
  }, []);

  async function disconnect() {
    setDisconnecting(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/youtube/disconnect", { method: "POST" });
      if (!response.ok) throw new Error(`Request failed with status ${response.status}.`);
      setStatus((await response.json()) as Status);
    } catch (err) {
      setError(`Couldn't disconnect: ${(err as Error).message}`);
    } finally {
      setDisconnecting(false);
    }
  }

  const connected = status?.connected && !status.needsReconnect;

  return (
    <Card>
      <CardHeader>
        <CardTitle>YouTube</CardTitle>
        <CardDescription>
          Connect a YouTube channel so approved videos can be uploaded as Shorts. Nothing is uploaded unless you
          confirm it.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {!status ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Checking YouTube…
          </p>
        ) : !status.configured ? (
          <div className="grid gap-2 text-sm">
            <Chip state="off">YouTube not set up</Chip>
            <p className="text-xs text-muted-foreground">{ERRORS.not_configured}</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Chip state={connected ? "on" : status.needsReconnect ? "warn" : "off"}>
                {connected ? "Connected" : status.needsReconnect ? "Access expired" : "Not connected"}
              </Chip>
              {!status.connected && (
                <Button size="xs" asChild>
                  <a href={LOGIN_URL}>Connect YouTube</a>
                </Button>
              )}
              {status.needsReconnect && (
                <Button size="xs" asChild>
                  <a href={LOGIN_URL}>Reconnect YouTube</a>
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {!status.connected
                ? "Connecting only asks for permission to upload videos."
                : status.needsReconnect
                  ? "Google stopped accepting the saved sign-in. While the Google app is in Testing mode this happens every 7 days."
                  : `Connected ${status.connectedAt ? new Date(status.connectedAt).toLocaleDateString() : ""}`}
              {status.connected && (
                <>
                  {" · "}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button
                        type="button"
                        className="underline underline-offset-2 hover:text-foreground disabled:opacity-50"
                        disabled={disconnecting}
                      >
                        {disconnecting && <Loader2 className="mr-1 inline size-3 animate-spin" />}
                        Disconnect
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Disconnect YouTube?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This revokes the app&apos;s access at Google and deletes the saved tokens from this computer.
                          You can connect again any time.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={disconnect}>
                          Disconnect
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </p>
          </>
        )}
        {message && <p className="text-sm text-success">{message}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function Chip({ state, children }: { state: "on" | "off" | "warn"; children: React.ReactNode }) {
  const Icon = state === "on" ? CheckCircle2 : state === "warn" ? TriangleAlert : CircleDashed;
  return (
    <span
      className={cn(
        "inline-flex h-6 w-fit items-center gap-1.5 rounded-md border px-2 text-xs font-medium",
        state === "on" && "border-success/25 bg-success-soft text-success",
        state === "off" && "bg-surface text-muted-foreground",
        state === "warn" && "border-warning/30 bg-warning-soft text-warning",
      )}
    >
      <Icon className="size-3.5" />
      {children}
    </span>
  );
}
