"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, ClipboardCopy, FileUp, Loader2, X } from "lucide-react";
import { LinkedInStatus, type LinkedInSummary } from "@/components/linkedin-status";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { LinkedInProfile } from "@/lib/linkedin.ts";
import type { ImportSummary, Profile } from "@/lib/profile.ts";
import { cn } from "@/lib/utils";
import { useSavedState } from "@/lib/use-saved-state.ts";

type ProfileResponse = { profile: Profile; exists?: boolean; summary?: ImportSummary; error?: string };

async function call(input: string, init?: RequestInit): Promise<ProfileResponse> {
  const response = await fetch(input, init);
  const data = (await response.json().catch(() => ({}))) as ProfileResponse;
  if (!response.ok || !data.profile) throw new Error(data.error ?? `Request failed with status ${response.status}.`);
  return data;
}

export type ProfileTab = "about" | "cv" | "import";

// Details for application forms, copied with one click from the quick-copy button on the Jobs pages.
export const QUICK_COPY_FIELDS: { key: keyof Profile; label: string; placeholder: string; type?: string }[] = [
  { key: "name", label: "Full name", placeholder: "e.g. Alex Smith" },
  { key: "email", label: "Email", placeholder: "e.g. alex@example.com", type: "email" },
  { key: "phone", label: "Phone", placeholder: "e.g. +61 400 000 000", type: "tel" },
  { key: "location", label: "Location", placeholder: "e.g. Sydney, Australia" },
  { key: "linkedinUrl", label: "LinkedIn URL", placeholder: "e.g. https://www.linkedin.com/in/alex", type: "url" },
  { key: "noticePeriod", label: "Notice period", placeholder: "e.g. 2 weeks" },
  { key: "salaryExpectation", label: "Salary expectation", placeholder: "e.g. $120k–$130k + super" },
  { key: "workRights", label: "Work rights", placeholder: "e.g. Australian citizen" },
];

// What counts toward "profile complete", and where to fill it in.
const COMPLETENESS: { label: string; tab: ProfileTab; done: (p: Profile) => boolean }[] = [
  { label: "name", tab: "about", done: (p) => Boolean(p.name.trim()) },
  { label: "headline", tab: "about", done: (p) => Boolean(p.headline.trim()) },
  { label: "summary or facts", tab: "about", done: (p) => Boolean(p.summary.trim() || p.facts.trim()) },
  { label: "skills", tab: "import", done: (p) => p.skills.length > 0 },
  { label: "positions", tab: "import", done: (p) => p.positions.length > 0 },
  { label: "CV", tab: "cv", done: (p) => Boolean(p.cv.trim()) },
  { label: "email", tab: "about", done: (p) => Boolean(p.email.trim()) },
  { label: "phone", tab: "about", done: (p) => Boolean(p.phone.trim()) },
  { label: "location", tab: "about", done: (p) => Boolean(p.location.trim()) },
  { label: "LinkedIn URL", tab: "about", done: (p) => Boolean(p.linkedinUrl.trim()) },
];

const TABS: ProfileTab[] = ["about", "cv", "import"];

export function ProfileEditor({
  linkedIn,
  linkedInProfile,
  initialTab,
}: {
  linkedIn: LinkedInSummary;
  linkedInProfile: LinkedInProfile | null;
  initialTab?: ProfileTab;
}) {
  const [tab, setTab] = useState<ProfileTab>(initialTab ?? "about");
  const [saved, setSaved] = useState<Profile | null>(null);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [exists, setExists] = useState(false);
  const [busy, setBusy] = useState<"saving" | "deleting" | "importing" | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState("");
  const [imported, setImported] = useState<ImportSummary | null>(null);
  const [guideOpen, setGuideOpen] = useState(true);
  const [postsOpen, setPostsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cvInput = useRef<HTMLInputElement>(null);
  const [cvLoading, setCvLoading] = useState(false);

  const dirty = saved !== null && draft !== null && JSON.stringify(saved) !== JSON.stringify(draft);

  function load(data: ProfileResponse) {
    setSaved(data.profile);
    setDraft(data.profile);
    if (data.exists !== undefined) setExists(data.exists);
  }

  useEffect(() => {
    call("/api/profile")
      .then((data) => {
        load(data);
        setGuideOpen(!data.profile.importedAt);
        // A brand-new profile starts where the most comes from: the LinkedIn import.
        if (!initialTab && !data.exists) setTab("import");
      })
      .catch((err: Error) => setError(`Couldn't load your profile: ${err.message}`));
  }, []);

  // Unsaved edits are kept in the local database until you save or discard them.
  // Merged over the saved profile so a draft from an older version of the app still has every field.
  useSavedState<Partial<Profile>>(
    "profile",
    dirty ? draft : null,
    (unsaved) => setDraft((current) => (current ? { ...current, ...unsaved } : current)),
    saved !== null,
  );

  async function run(kind: "saving" | "deleting" | "importing", action: () => Promise<ProfileResponse>) {
    setBusy(kind);
    setError("");
    try {
      const data = await action();
      load(data);
      return data;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const data = await run("saving", () =>
      call("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) }),
    );
    if (data) {
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    }
  }

  async function importFiles(files: FileList | File[]) {
    const list = [...files];
    if (list.length === 0) return;
    if (dirty && !window.confirm("Importing reloads your profile and drops your unsaved changes. Continue?")) return;
    const form = new FormData();
    for (const file of list) form.append("files", file);
    setImported(null);
    const data = await run("importing", () => call("/api/profile/import", { method: "POST", body: form }));
    if (data?.summary) {
      setImported(data.summary);
      setExists(true);
      setGuideOpen(false);
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  // Puts the CV's text in the box; it's saved with the rest of the profile when you click Save.
  async function importCv(file: File) {
    const form = new FormData();
    form.append("file", file);
    setCvLoading(true);
    setError("");
    try {
      const response = await fetch("/api/profile/cv", { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!response.ok || !data.text) throw new Error(data.error ?? "Couldn't read that file.");
      update({ cv: data.text });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCvLoading(false);
      if (cvInput.current) cvInput.current.value = "";
    }
  }

  function update(changes: Partial<Profile>) {
    setDraft((current) => (current ? { ...current, ...changes } : current));
  }

  function changeTab(next: string) {
    if (!TABS.includes(next as ProfileTab)) return;
    setTab(next as ProfileTab);
    window.history.replaceState(null, "", next === "about" ? "/profile" : `/profile?tab=${next}`);
  }

  const removeAt = <K extends "positions" | "skills" | "education" | "posts">(key: K, index: number) =>
    draft && update({ [key]: draft[key].filter((_, i) => i !== index) } as Partial<Profile>);

  const avatarName = draft?.name || linkedInProfile?.name || "";
  const missing = draft ? COMPLETENESS.filter((item) => !item.done(draft)) : [];
  const percent = Math.round(((COMPLETENESS.length - missing.length) / COMPLETENESS.length) * 100);

  return (
    <div className="grid gap-6">
      <Card className="pt-0">
        <div
          aria-hidden
          className="h-20 border-b bg-[radial-gradient(120%_140%_at_0%_0%,color-mix(in_oklch,var(--brand),transparent_70%),transparent_60%),linear-gradient(180deg,var(--surface),var(--card))]"
        />
        <CardContent className="-mt-12 grid gap-5 md:grid-cols-[minmax(0,1fr)_17rem] md:items-end">
          <div className="flex min-w-0 items-end gap-4">
            <Avatar className="size-20 ring-4 ring-card">
              {linkedInProfile?.picture && <AvatarImage src={linkedInProfile.picture} alt="" />}
              <AvatarFallback className="bg-brand-soft text-lg font-medium">{initials(avatarName) || "?"}</AvatarFallback>
            </Avatar>
            <div className="grid min-w-0 gap-1 pb-0.5">
              <p className="truncate text-lg font-semibold tracking-tight">{avatarName || "Your name"}</p>
              <p className={cn("text-sm", draft?.headline ? "text-muted-foreground" : "text-muted-foreground/70 italic")}>
                {draft?.headline || "Add a headline in About me"}
              </p>
            </div>
          </div>
          {draft && (
            <div className="grid gap-2 rounded-lg border bg-surface/60 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Profile {percent}% complete</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">
                {missing.length === 0 ? (
                  "Everything's filled in. Posts and applications can use all of it."
                ) : (
                  <>
                    Add{" "}
                    {missing.slice(0, 3).map((item, i) => (
                      <span key={item.label}>
                        {i > 0 && (i === Math.min(3, missing.length) - 1 ? " and " : ", ")}
                        <button
                          type="button"
                          className="underline underline-offset-2 hover:text-foreground"
                          onClick={() => changeTab(item.tab)}
                        >
                          {item.label}
                        </button>
                      </span>
                    ))}
                    {missing.length > 3 && ` (+${missing.length - 3} more)`} for better posts and applications.
                  </>
                )}
              </p>
            </div>
          )}
          <div className="grid gap-2 border-t pt-4 md:col-span-2">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">LinkedIn connection</p>
            <LinkedInStatus status={linkedIn} />
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList aria-label="Profile sections">
          <TabsTrigger value="about">About me</TabsTrigger>
          <TabsTrigger value="cv">CV</TabsTrigger>
          <TabsTrigger value="import">Import LinkedIn export</TabsTrigger>
        </TabsList>

        {draft === null ? (
          !error && (
            <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading profile…
            </p>
          )
        ) : (
          <>
            <TabsContent value="about" className="grid gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>About you</CardTitle>
                  <CardDescription>
                    The model may use these as true facts. Edit anything that isn&apos;t right.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-5">
                  <div className="grid gap-2">
                    <Label htmlFor="headline">Headline</Label>
                    <Input
                      id="headline"
                      value={draft.headline}
                      placeholder="e.g. Backend engineer at Acme"
                      onChange={(event) => update({ headline: event.target.value })}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="summary">Summary</Label>
                    <Textarea
                      id="summary"
                      rows={3}
                      value={draft.summary}
                      onChange={(event) => update({ summary: event.target.value })}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="facts">Facts about me</Label>
                    <Textarea
                      id="facts"
                      rows={4}
                      value={draft.facts}
                      placeholder="e.g. I lead a team of four backend engineers. I've worked with Go for six years."
                      onChange={(event) => update({ facts: event.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">Things the model may say about you. Only write what&apos;s true.</p>
                  </div>

                  <div className="grid gap-3">
                    <label className="flex items-center justify-between gap-4 text-sm">
                      <span>Use my profile facts in posts</span>
                      <Switch
                        aria-label="Use my profile facts in posts"
                        checked={draft.useFacts}
                        onCheckedChange={(useFacts) => update({ useFacts })}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-4 text-sm">
                      <span>Use my past posts as writing-style examples</span>
                      <Switch
                        aria-label="Use my past posts as writing-style examples"
                        checked={draft.useStyle}
                        onCheckedChange={(useStyle) => update({ useStyle })}
                      />
                    </label>
                  </div>

                  <Section title="Positions" empty="No positions yet. Import them from LinkedIn.">
                    {draft.positions.map((position, i) => (
                      <Row key={`${position.company}-${position.title}-${i}`} onRemove={() => removeAt("positions", i)}>
                        <p className="font-medium">{[position.title, position.company].filter(Boolean).join(" · ")}</p>
                        <p className="text-xs text-muted-foreground">
                          {[position.startedOn, position.finishedOn || (position.startedOn && "present")]
                            .filter(Boolean)
                            .join(" – ")}
                        </p>
                      </Row>
                    ))}
                  </Section>

                  <Section title="Skills" empty="No skills yet.">
                    {draft.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {draft.skills.map((skill, i) => (
                          <Badge key={skill} variant="secondary" className="gap-1 pr-1">
                            {skill}
                            <button
                              type="button"
                              aria-label={`Remove ${skill}`}
                              className="rounded-full p-0.5 hover:bg-background"
                              onClick={() => removeAt("skills", i)}
                            >
                              <X className="size-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </Section>

                  <Section title="Education" empty="No education yet.">
                    {draft.education.map((education, i) => (
                      <Row key={`${education.school}-${i}`} onRemove={() => removeAt("education", i)}>
                        <p className="font-medium">{[education.degree, education.school].filter(Boolean).join(" · ")}</p>
                        <p className="text-xs text-muted-foreground">
                          {[education.startDate, education.endDate].filter(Boolean).join(" – ")}
                        </p>
                      </Row>
                    ))}
                  </Section>

                  <div className="grid gap-2">
                    <button
                      type="button"
                      className="flex items-center gap-1.5 text-left text-sm font-medium"
                      aria-expanded={postsOpen}
                      onClick={() => setPostsOpen((open) => !open)}
                      disabled={draft.posts.length === 0}
                    >
                      Past posts ({draft.posts.length})
                      {draft.posts.length > 0 && (
                        <ChevronDown className={`size-4 transition-transform ${postsOpen ? "rotate-180" : ""}`} />
                      )}
                    </button>
                    {draft.posts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No past posts yet. Import Shares from LinkedIn.</p>
                    ) : (
                      postsOpen && (
                        <div className="grid gap-2">
                          {draft.posts.map((post, i) => (
                            <Row key={`${post.date}-${i}`} onRemove={() => removeAt("posts", i)}>
                              <p className="text-xs text-muted-foreground">{post.date.slice(0, 10)}</p>
                              <p className="line-clamp-2 whitespace-pre-line">{post.text}</p>
                            </Row>
                          ))}
                        </div>
                      )
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card id="quick-copy" className="scroll-mt-6">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ClipboardCopy className="size-4 text-brand" />
                    Quick-copy details
                  </CardTitle>
                  <CardDescription>
                    For application forms: copy each one with a click from the button at the bottom right of the Jobs
                    pages. Never sent to the model.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  {QUICK_COPY_FIELDS.map((field) => (
                    <div key={field.key} className="grid gap-2">
                      <Label htmlFor={`quick-${field.key}`}>{field.label}</Label>
                      <Input
                        id={`quick-${field.key}`}
                        type={field.type ?? "text"}
                        value={draft[field.key] as string}
                        placeholder={
                          field.key === "email" && linkedInProfile?.email ? linkedInProfile.email : field.placeholder
                        }
                        onChange={(event) => update({ [field.key]: event.target.value } as Partial<Profile>)}
                      />
                      {field.key === "email" && !draft.email && linkedInProfile?.email && (
                        <button
                          type="button"
                          className="justify-self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                          onClick={() => update({ email: linkedInProfile.email ?? "" })}
                        >
                          Use {linkedInProfile.email} from LinkedIn
                        </button>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" disabled={busy !== null || !exists}>
                      {busy === "deleting" && <Loader2 className="animate-spin" />}
                      Delete all profile data
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete all profile data?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This deletes data/profile.json: your imported LinkedIn data, facts and past posts. Posts will be
                        written without them. This can&apos;t be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={async () => {
                          await run("deleting", () => call("/api/profile", { method: "DELETE" }));
                          setImported(null);
                          setGuideOpen(true);
                        }}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </TabsContent>

            <TabsContent value="cv">
              <Card>
                <CardHeader>
                  <CardTitle>CV</CardTitle>
                  <CardDescription>
                    Used on the Jobs page to rank jobs, check fit and write cover letters and tailored CVs, not in posts.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2">
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="cv">Text of your CV</Label>
                      <Button size="xs" variant="outline" disabled={cvLoading} onClick={() => cvInput.current?.click()}>
                        {cvLoading ? <Loader2 className="animate-spin" /> : <FileUp />}
                        Import .docx or .txt
                      </Button>
                      <input
                        ref={cvInput}
                        type="file"
                        accept=".docx,.txt,.md"
                        className="hidden"
                        aria-label="Choose a CV file"
                        onChange={(event) => event.target.files?.[0] && importCv(event.target.files[0])}
                      />
                    </div>
                    <Textarea
                      id="cv"
                      rows={16}
                      maxLength={30_000}
                      value={draft.cv}
                      placeholder="Paste the text of your CV, or import it."
                      onChange={(event) => update({ cv: event.target.value })}
                      className="max-h-[60vh]"
                    />
                    <p className="text-xs text-muted-foreground">
                      For a PDF, open it, copy its text and paste it here.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </>
        )}

        <TabsContent value="import">
          <Card>
            <CardHeader>
              <button
                type="button"
                className="flex items-center justify-between gap-3 text-left"
                aria-expanded={guideOpen}
                onClick={() => setGuideOpen((open) => !open)}
              >
                <CardTitle>Import your LinkedIn data</CardTitle>
                <ChevronDown className={`size-4 shrink-0 transition-transform ${guideOpen ? "rotate-180" : ""}`} />
              </button>
              <CardDescription>
                Gives the model true facts about you and examples of how you write.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {guideOpen && (
                <ol className="grid list-decimal gap-2 pl-5 text-sm">
                  <li>
                    On LinkedIn, go to <b>Me → Settings &amp; Privacy → Data privacy → Get a copy of your data</b>.
                  </li>
                  <li>
                    Choose <b>Want something in particular?</b> and tick <b>Profile</b>, <b>Positions</b>, <b>Skills</b> and{" "}
                    <b>Shares</b> (your posts). Then click <b>Request archive</b>.
                  </li>
                  <li>
                    LinkedIn emails you a download link. Picking just these files is usually quick; the full archive can
                    take up to 24 hours.
                  </li>
                  <li>Upload the .zip below, or the individual CSV files.</li>
                </ol>
              )}

              <div
                className={`grid justify-items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center text-sm transition-colors ${
                  dragging ? "border-ring bg-muted" : ""
                }`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  importFiles(event.dataTransfer.files);
                }}
              >
                {busy === "importing" ? (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Reading your files…
                  </p>
                ) : (
                  <>
                    <FileUp className="size-5 text-muted-foreground" />
                    <p className="text-muted-foreground">Drop your LinkedIn .zip or CSV files here</p>
                    <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                      Choose files
                    </Button>
                  </>
                )}
                <input
                  ref={fileInput}
                  type="file"
                  accept=".zip,.csv"
                  multiple
                  className="hidden"
                  aria-label="Choose LinkedIn export files"
                  onChange={(event) => event.target.files && importFiles(event.target.files)}
                />
              </div>

              {imported && (
                <Alert>
                  <Check />
                  <AlertTitle>Imported</AlertTitle>
                  <AlertDescription>
                    {[
                      imported.profile && "profile",
                      `${imported.positions} positions`,
                      `${imported.skills} skills`,
                      `${imported.education} schools`,
                      `${imported.posts} posts`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    .{" "}
                    <button type="button" className="underline underline-offset-2" onClick={() => changeTab("about")}>
                      Review it in About me
                    </button>
                  </AlertDescription>
                </Alert>
              )}

              <p className="text-xs text-muted-foreground">
                Everything stays on this computer in data/profile.json. Address, birth date and contact details are
                ignored.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {dirty && (
        <div className="sticky bottom-20 z-20 flex flex-wrap items-center gap-2 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur md:bottom-4">
          <Button disabled={!dirty || busy !== null} onClick={save}>
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
          <Button variant="outline" disabled={!dirty || busy !== null} onClick={() => setDraft(saved)}>
            Discard changes
          </Button>
          <span className="text-xs text-muted-foreground">Unsaved changes</span>
        </div>
      )}
      {!dirty && justSaved && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
          <Check className="size-4 text-brand" /> Saved
        </p>
      )}
    </div>
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

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const hasItems = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">{title}</p>
      {hasItems ? <div className="grid gap-2">{children}</div> : <p className="text-sm text-muted-foreground">{empty}</p>}
    </div>
  );
}

function Row({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
      <div className="grid min-w-0 flex-1 gap-0.5">{children}</div>
      <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={onRemove}>
        <X />
      </Button>
    </div>
  );
}
