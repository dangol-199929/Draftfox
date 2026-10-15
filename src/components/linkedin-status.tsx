"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown, CircleDashed, Loader2, Send, TriangleAlert } from "lucide-react";
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
import { cn } from "@/lib/utils";

const LOGIN_URL = "/api/linkedin/login";
const POSTING_LOGIN_URL = "/api/linkedin/login?posting=1";

export type LinkedInSummary = {
  configured: boolean;
  connected: boolean;
  expired: boolean;
  canPost: boolean;
  connectedOn: string | null;
  daysLeft: number;
};

// Two chips, "Signed in" and "Posting enabled", each with the one action that fixes it.
export function LinkedInStatus({ status }: { status: LinkedInSummary }) {
  const router = useRouter();
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const { configured, connected, expired, canPost } = status;
  const signedIn = connected && !expired;

  async function disconnect() {
    setDisconnecting(true);
    setError("");
    try {
      const response = await fetch("/api/linkedin/disconnect", { method: "POST" });
      if (!response.ok) throw new Error(`Request failed with status ${response.status}.`);
      router.replace("/profile");
      router.refresh();
    } catch (err) {
      setError(`Couldn't disconnect: ${(err as Error).message}`);
    } finally {
      setDisconnecting(false);
    }
  }

  if (!configured) {
    return (
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Chip state="off">LinkedIn not set up</Chip>
          <Button variant="ghost" size="xs" aria-expanded={setupOpen} onClick={() => setSetupOpen((open) => !open)}>
            How to set it up
            <ChevronDown className={cn("transition-transform", setupOpen && "rotate-180")} />
          </Button>
        </div>
        {setupOpen && (
          <div className="grid gap-2 rounded-lg border p-3 text-sm">
            <p>Add these two lines to the .env file in the project folder:</p>
            <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
              {"LINKEDIN_CLIENT_ID=your-client-id\nLINKEDIN_CLIENT_SECRET=your-client-secret"}
            </pre>
            <p className="text-xs text-muted-foreground">
              Both come from the Auth tab of your app at linkedin.com/developers. Restart the app afterwards. The
              README section &quot;LinkedIn setup&quot; walks through creating the app.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <Chip state={signedIn ? "on" : expired ? "warn" : "off"}>
            {signedIn ? "Signed in" : expired ? "Sign-in expired" : "Not signed in"}
          </Chip>
          {!connected && (
            <Button size="xs" asChild>
              <a href={LOGIN_URL}>Connect</a>
            </Button>
          )}
          {expired && (
            <Button size="xs" asChild>
              <a href={canPost ? POSTING_LOGIN_URL : LOGIN_URL}>Reconnect</a>
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Chip state={signedIn && canPost ? "on" : "off"}>
            {signedIn && canPost ? "Posting enabled" : "Posting off"}
          </Chip>
          {signedIn && !canPost && (
            <Button size="xs" variant="outline" asChild>
              <a href={POSTING_LOGIN_URL}>
                <Send />
                Enable posting
              </a>
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {!connected
          ? "Connecting reads your name, email and photo. Nothing is posted unless you click Post and confirm."
          : expired
            ? "LinkedIn access only lasts a while. Reconnect to refresh it."
            : `Connected ${status.connectedOn ?? ""} · access expires in ${status.daysLeft} ${status.daysLeft === 1 ? "day" : "days"}`}
        {signedIn && !canPost && (
          <> · Posting needs the &quot;Share on LinkedIn&quot; product on your LinkedIn developer app.</>
        )}
        {connected && (
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
                  <AlertDialogTitle>Disconnect LinkedIn?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This revokes the app&apos;s access at LinkedIn and deletes the saved token from this computer. You
                    can connect again any time.
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
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function Chip({ state, children }: { state: "on" | "off" | "warn"; children: React.ReactNode }) {
  const Icon = state === "on" ? CheckCircle2 : state === "warn" ? TriangleAlert : CircleDashed;
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
        state === "on" && "border-transparent bg-brand-soft text-foreground [&_svg]:text-brand",
        state === "off" && "text-muted-foreground",
        state === "warn" && "border-destructive/30 text-destructive",
      )}
    >
      <Icon className="size-3.5" />
      {children}
    </span>
  );
}
