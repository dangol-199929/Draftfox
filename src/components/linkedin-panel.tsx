"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send, TriangleAlert } from "lucide-react";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { LinkedInProfile } from "@/lib/linkedin.ts";

const LOGIN_URL = "/api/linkedin/login";
const POSTING_LOGIN_URL = "/api/linkedin/login?posting=1";

type Props = {
  configured: boolean;
  connected: boolean;
  expired: boolean;
  canPost: boolean;
  profile: LinkedInProfile | null;
  connectedOn: string | null;
  daysLeft: number;
};

export function LinkedInPanel({ configured, connected, expired, canPost, profile, connectedOn, daysLeft }: Props) {
  const router = useRouter();
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState("");

  async function disconnect() {
    setDisconnecting(true);
    setError("");
    try {
      const response = await fetch("/api/linkedin/disconnect", { method: "POST" });
      if (!response.ok) throw new Error(`Request failed with status ${response.status}.`);
      router.replace("/linkedin");
      router.refresh();
    } catch (err) {
      setError(`Couldn't disconnect: ${(err as Error).message}`);
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connection</CardTitle>
        <CardDescription>Uses Sign In with LinkedIn and, if enabled, Share on LinkedIn.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!configured ? (
          <div className="grid gap-3 text-sm">
            <p>LinkedIn isn&apos;t set up yet. Add these two lines to the .env file in the project folder:</p>
            <pre className="overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs">
              {"LINKEDIN_CLIENT_ID=your-client-id\nLINKEDIN_CLIENT_SECRET=your-client-secret"}
            </pre>
            <p className="text-muted-foreground">
              Both come from the Auth tab of your app at linkedin.com/developers. Restart the dev server afterwards.
              The README section &quot;LinkedIn setup&quot; walks through creating the app.
            </p>
          </div>
        ) : !connected || !profile ? (
          <div className="grid justify-items-start gap-3">
            <Button asChild>
              <a href={LOGIN_URL}>Connect LinkedIn</a>
            </Button>
            <p className="text-sm text-muted-foreground">
              We read your name, email and photo. Nothing is posted unless you click Post to LinkedIn and confirm.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="flex items-center gap-4">
              <Avatar className="size-14">
                {profile.picture && <AvatarImage src={profile.picture} alt="" />}
                <AvatarFallback>{initials(profile.name)}</AvatarFallback>
              </Avatar>
              <div className="grid min-w-0 gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-medium">{profile.name}</p>
                  {canPost && !expired && <Badge variant="secondary">Posting enabled</Badge>}
                </div>
                {profile.email && <p className="truncate text-sm text-muted-foreground">{profile.email}</p>}
                <p className="text-xs text-muted-foreground">
                  Connected {connectedOn}
                  {!expired && ` · access expires in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`}
                </p>
              </div>
            </div>

            {!expired && !canPost && (
              <div className="grid justify-items-start gap-2 rounded-lg border px-3 py-3 text-sm">
                <p>Want to post from this app? Give it permission to share on your behalf.</p>
                <p className="text-xs text-muted-foreground">
                  First add the &quot;Share on LinkedIn&quot; product to your LinkedIn developer app (Products tab).
                </p>
                <Button size="sm" asChild>
                  <a href={POSTING_LOGIN_URL}>
                    <Send />
                    Enable posting
                  </a>
                </Button>
              </div>
            )}

            {expired && (
              <Alert>
                <TriangleAlert />
                <AlertTitle>Access has expired</AlertTitle>
                <AlertDescription>LinkedIn access only lasts a while. Reconnect to refresh it.</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant={expired ? "default" : "outline"} asChild>
                <a href={canPost ? POSTING_LOGIN_URL : LOGIN_URL}>Reconnect</a>
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" disabled={disconnecting}>
                    {disconnecting && <Loader2 className="animate-spin" />}
                    Disconnect
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Disconnect LinkedIn?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This revokes the app&apos;s access at LinkedIn and deletes the saved token from this computer.
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
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
