"use client";

import { useState } from "react";
import { Loader2, LockKeyhole } from "lucide-react";
import { Logo } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Full-screen sign-in, drawn over the app's layout (the sidebar hides itself on this page).
// It's a real form posting to /api/auth/login, so it works even if the page's script doesn't load; with the script,
// it signs in without leaving the page. The button is never disabled for an empty field: a password filled in by
// the browser doesn't always tell the page, and the form reads the field itself when it's sent.
export function LoginForm({ next, initialError }: { next: string; initialError: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("password");
    if (typeof password !== "string" || !password) {
      setError("Enter your password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Couldn't sign in.");
        setBusy(false);
        return;
      }
      // A full page load so every part of the app starts with the new session.
      window.location.assign(next);
    } catch {
      setError("Couldn't reach Draftfox. Is its server running?");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-background px-4 py-10">
      <div className="grid w-full max-w-sm gap-6">
        <Logo className="justify-self-center" />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LockKeyhole className="size-4 text-muted-foreground" />
              Sign in
            </CardTitle>
            <CardDescription>Enter your Draftfox password to open your workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action="/api/auth/login" method="post" onSubmit={submit} className="grid gap-4">
              <input type="hidden" name="next" value={next} />
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  required
                  aria-invalid={error ? true : undefined}
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                Sign in
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
