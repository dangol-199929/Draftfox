"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { JobRecord, PostRecord } from "@/lib/db.ts";

// The most common job titles you track, as a starting point for the roles to mention.
function suggestedRoles(jobs: JobRecord[]): string {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    const title = job.title.replace(/\s*[(\[].*$/, "").trim();
    if (title && title.length <= 50) counts.set(title, (counts.get(title) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([title]) => title)
    .join(" or ");
}

// Writes a LinkedIn post saying you're looking for work, from your profile, as a draft on the Posts page.
export function OpenToWork({ jobs }: { jobs: JobRecord[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [roles, setRoles] = useState("");
  const [preferences, setPreferences] = useState("");
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState("");

  async function write(event: React.FormEvent) {
    event.preventDefault();
    setWriting(true);
    setError("");
    try {
      const response = await fetch("/api/jobs/open-to-work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles, preferences }),
      });
      const data = (await response.json()) as { post?: PostRecord; error?: string };
      if (!response.ok || !data.post) throw new Error(data.error ?? "Couldn't write the post.");
      router.push(`/?post=${data.post.id}`);
    } catch (err) {
      setError((err as Error).message);
      setWriting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Megaphone className="size-4" /> Tell your network you&apos;re looking
        </CardTitle>
        <CardDescription>
          A LinkedIn post saying you&apos;re open to work, written from your profile. It&apos;s saved as a draft on the
          Posts page; nothing is posted until you choose to.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!open ? (
          <Button
            variant="outline"
            onClick={() => {
              setRoles((current) => current || suggestedRoles(jobs));
              setOpen(true);
            }}
          >
            <Megaphone />
            Write an &quot;open to work&quot; post
          </Button>
        ) : (
          <form onSubmit={write} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="otw-roles">Roles you&apos;re looking for</Label>
              <Input
                id="otw-roles"
                required
                maxLength={300}
                value={roles}
                placeholder="Frontend Developer or React Developer"
                onChange={(event) => setRoles(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="otw-preferences">What you&apos;re looking for (optional)</Label>
              <Textarea
                id="otw-preferences"
                rows={3}
                maxLength={1000}
                value={preferences}
                placeholder="Remote or hybrid in Sydney, a product team that cares about accessibility, starting in January…"
                onChange={(event) => setPreferences(event.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={writing || !roles.trim()}>
                {writing ? <Loader2 className="animate-spin" /> : <Megaphone />}
                {writing ? "Writing…" : "Write the post"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
