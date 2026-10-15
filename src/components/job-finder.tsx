"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bookmark, Check, ChevronDown, Loader2, Plus, Search, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { JobRecord } from "@/lib/db.ts";
import { COUNTRIES, SOURCE_SITES } from "@/lib/job-links.ts";
import type { FoundJob, SourceResult } from "@/lib/job-search.ts";
import { useSavedState } from "@/lib/use-saved-state.ts";
import { cn } from "@/lib/utils";

type Search = { queries: string[]; country: string; place: string; skills: string[] };
type Saved = Search & { results: FoundJob[] | null; sources: SourceResult[]; searchedAt: string | null; savedSearchId?: string | null };
type SavedSearch = Search & { id: string; name: string; lastRun: string | null; seenCount: number };
type Suggestion = { searches: string[]; skills: string[]; country: string; fromModel: boolean; adzuna: boolean; profileEmpty: boolean };

const EMPTY_SEARCH: Search = { queries: ["", "", ""], country: "", place: "", skills: [] };

// Searches job boards and lists the matching jobs right here; onSaved hears about each one saved to your list.
export function JobFinder({ onSaved }: { onSaved?: (job: JobRecord) => void }) {
  const [search, setSearch] = useState<Search>(EMPTY_SEARCH);
  const [results, setResults] = useState<FoundJob[] | null>(null);
  const [sources, setSources] = useState<SourceResult[]>([]);
  const [searchedAt, setSearchedAt] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  // Job links already in your tracker, so a result you saved shows as saved.
  const [savedJobs, setSavedJobs] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  // The saved search the form came from, so running it marks the jobs that are new since last time.
  const [savedSearchId, setSavedSearchId] = useState<string | null>(null);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [onlyNew, setOnlyNew] = useState(false);

  // The last search and its results stay until you search again.
  const loaded = useSavedState<Saved>(
    "jobsearch",
    { ...search, results, sources, searchedAt, savedSearchId },
    (saved) => {
      setSearch({ queries: [...saved.queries, "", "", ""].slice(0, 3), country: saved.country, place: saved.place, skills: saved.skills ?? [] });
      setResults(saved.results);
      setSources(saved.sources ?? []);
      setSearchedAt(saved.searchedAt);
      setSavedSearchId(saved.savedSearchId ?? null);
      setRestored(true);
    },
  );

  useEffect(() => {
    fetch("/api/jobs")
      .then((response) => response.json() as Promise<{ jobs: JobRecord[] }>)
      .then(({ jobs }) => setSavedJobs(new Map(jobs.filter((job) => job.url).map((job) => [job.url, job.id]))))
      .catch(() => {});
  }, []);

  // With nothing saved yet, start from searches suggested from your profile.
  useEffect(() => {
    if (!loaded || restored) return;
    void suggest(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, after loading
  }, [loaded]);

  async function suggest(onlyIfEmpty = false) {
    setSuggesting(true);
    try {
      const response = await fetch("/api/jobs/search");
      const data = (await response.json()) as Suggestion;
      setSearch((current) => {
        if (onlyIfEmpty && current.queries.some(Boolean)) return current;
        return {
          ...current,
          skills: data.skills,
          queries: [...data.searches, "", "", ""].slice(0, 3),
          country: current.country || data.country,
        };
      });
    } catch {
      // Leave the boxes for you to fill in.
    } finally {
      setSuggesting(false);
    }
  }

  function loadSavedSearches() {
    fetch("/api/jobs/searches")
      .then((response) => response.json() as Promise<{ searches: SavedSearch[] }>)
      .then(({ searches }) => setSavedSearches(searches))
      .catch(() => {});
  }
  useEffect(loadSavedSearches, []);

  async function run(event?: React.FormEvent, from: Search = search, fromId: string | null = savedSearchId) {
    event?.preventDefault();
    setSearching(true);
    setError("");
    try {
      const response = await fetch("/api/jobs/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queries: from.queries.filter((query) => query.trim()),
          country: from.country,
          place: from.place,
          skills: from.skills,
          savedSearchId: fromId ?? undefined,
        }),
      });
      const data = (await response.json()) as { results?: FoundJob[]; sources?: SourceResult[]; error?: string };
      if (data.sources) setSources(data.sources);
      if (!response.ok || !data.results) throw new Error(data.error ?? "The search failed.");
      setResults(data.results);
      setSearchedAt(new Date().toISOString());
      setOpen(null);
      setOnlyNew(false);
      if (fromId) loadSavedSearches();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  }

  async function save(job: FoundJob) {
    setSaving(job.id);
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: job.title.slice(0, 200),
          company: job.company.slice(0, 200),
          location: job.location.slice(0, 200),
          url: job.url,
          description: job.description,
          notes: `Found on ${job.source}${job.salary ? `. Salary listed: ${job.salary}` : ""}.`,
        }),
      });
      const data = (await response.json()) as { job?: JobRecord; error?: string; duplicateId?: string };
      // Already in your list (saved from another board, say): show it as saved.
      const id = data.job?.id ?? data.duplicateId;
      if (!id) throw new Error(data.error ?? "Couldn't save the job.");
      setSavedJobs((current) => new Map(current).set(job.url, id));
      if (data.job) onSaved?.(data.job);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(null);
    }
  }

  // Running a saved search again: fill in the form and search, marking what's new.
  function runSaved(saved: SavedSearch) {
    const from = { queries: [...saved.queries, "", "", ""].slice(0, 3), country: saved.country, place: saved.place, skills: saved.skills };
    setSearch(from);
    setSavedSearchId(saved.id);
    void run(undefined, from, saved.id);
  }

  async function saveSearch() {
    setError("");
    try {
      const response = await fetch("/api/jobs/searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries: queries, country: search.country, place: search.place, skills: search.skills }),
      });
      const data = (await response.json()) as { search?: SavedSearch; error?: string };
      if (!response.ok || !data.search) throw new Error(data.error ?? "Couldn't save the search.");
      setSavedSearchId(data.search.id);
      loadSavedSearches();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function deleteSearch(id: string) {
    await fetch(`/api/jobs/searches/${id}`, { method: "DELETE" }).catch(() => {});
    if (savedSearchId === id) setSavedSearchId(null);
    loadSavedSearches();
  }

  // Editing the form makes it a new search, not the saved one.
  const edit = (change: (current: Search) => Search) => {
    setSearch(change);
    setSavedSearchId(null);
  };
  const setQuery = (i: number, value: string) =>
    edit((current) => ({ ...current, queries: current.queries.map((query, j) => (j === i ? value : query)) }));
  const queries = search.queries.map((query) => query.trim()).filter(Boolean);
  const newCount = (results ?? []).filter((job) => job.isNew).length;

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>What to look for</CardTitle>
          <CardDescription>
            Suggested from your profile; change them freely. Only these words and the country are sent to the job boards.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {savedSearches.length > 0 && (
            <div className="mb-4 grid gap-2">
              <p className="text-sm font-medium">Saved searches</p>
              <ul className="flex flex-wrap gap-2">
                {savedSearches.map((saved) => (
                  <li key={saved.id} className={cn("flex items-center rounded-md border text-sm", saved.id === savedSearchId && "border-ring bg-muted")}>
                    <button
                      type="button"
                      className="px-2.5 py-1 hover:underline"
                      title={saved.lastRun ? `Last run ${new Date(saved.lastRun).toLocaleDateString("en", { month: "short", day: "numeric" })}` : "Not run yet"}
                      disabled={searching}
                      onClick={() => runSaved(saved)}
                    >
                      {saved.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete saved search ${saved.name}`}
                      className="border-l px-1.5 py-1 text-muted-foreground hover:text-foreground"
                      onClick={() => void deleteSearch(saved.id)}
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">Run one again to see which jobs are new since last time.</p>
            </div>
          )}
          <form onSubmit={run} className="grid gap-4">
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="query-0">Job titles or keywords</Label>
                <Button type="button" size="xs" variant="ghost" disabled={suggesting} onClick={() => void suggest()}>
                  {suggesting ? <Loader2 className="animate-spin" /> : <Sparkles />}
                  {suggesting ? "Suggesting…" : "Suggest from my profile"}
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {search.queries.map((query, i) => (
                  <Input
                    key={i}
                    id={`query-${i}`}
                    aria-label={`Search ${i + 1}`}
                    maxLength={100}
                    value={query}
                    placeholder={["Frontend Developer", "React Developer", "Optional"][i]}
                    onChange={(event) => setQuery(i, event.target.value)}
                  />
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="country">Country</Label>
                <select
                  id="country"
                  value={search.country}
                  onChange={(event) => edit((current) => ({ ...current, country: event.target.value }))}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                >
                  <option value="">Anywhere (remote jobs)</option>
                  {COUNTRIES.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="place">City or region (optional)</Label>
                <Input
                  id="place"
                  maxLength={100}
                  value={search.place}
                  placeholder="Sydney"
                  onChange={(event) => edit((current) => ({ ...current, place: event.target.value }))}
                />
              </div>
            </div>
            {search.skills.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Ranked by these skills from your profile: {search.skills.join(", ")}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={searching || queries.length === 0}>
                {searching ? <Loader2 className="animate-spin" /> : <Search />}
                {searching ? "Searching…" : "Find jobs"}
              </Button>
              {savedSearchId ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Bookmark className="size-3.5" /> Saved search
                </span>
              ) : (
                <Button type="button" variant="outline" disabled={queries.length === 0} onClick={() => void saveSearch()}>
                  <Bookmark />
                  Save this search
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {(results || error) && (
        <Card>
          <CardHeader>
            <CardTitle>
              {results ? `${results.length} job${results.length === 1 ? "" : "s"} found${newCount ? `, ${newCount} new` : ""}` : "Results"}
            </CardTitle>
            <CardDescription>
              Best matches for your profile first. Save the ones you like to check the fit and write a cover letter.
              {searchedAt && ` Searched ${new Date(searchedAt).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`}
            </CardDescription>
          </CardHeader>
          {newCount > 0 && (
            <CardAction>
              <Button size="sm" variant={onlyNew ? "default" : "outline"} onClick={() => setOnlyNew((value) => !value)}>
                {onlyNew ? "Show all" : `Only new (${newCount})`}
              </Button>
            </CardAction>
          )}
          <CardContent className="grid gap-3">
            {sources.length > 0 && (
              <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {sources.map((source) => (
                  <span key={source.name}>
                    <a href={SOURCE_SITES[source.name]} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">
                      {source.name}
                    </a>
                    {": "}
                    {source.skipped ? (
                      <span>{source.skipped}{source.skipped.includes("API key") && " (see README)"}</span>
                    ) : source.error ? (
                      <span className="text-destructive">{source.error}</span>
                    ) : (
                      `${source.count} found`
                    )}
                  </span>
                ))}
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            {results && results.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing matched your profile. Try broader titles or another country.
              </p>
            )}
            {results && results.length > 0 && (
              <ul className="grid divide-y">
                {results.filter((job) => !onlyNew || job.isNew).map((job) => {
                  const savedId = savedJobs.get(job.url);
                  const expanded = open === job.id;
                  return (
                    <li key={job.id} className="grid gap-2 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="grid min-w-0 gap-0.5">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            onClick={() => setOpen(expanded ? null : job.id)}
                            className="text-left text-sm font-medium underline-offset-4 hover:underline"
                          >
                            {job.title}
                          </button>
                          <span className="text-xs text-muted-foreground">
                            {[job.company, job.location, job.salary, job.postedAt && `posted ${formatAge(job.postedAt)}`]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          {savedId ? (
                            <Button asChild size="sm" variant="outline">
                              <Link href={`/jobs/${savedId}`}>
                                <Check />
                                Saved, open
                              </Link>
                            </Button>
                          ) : (
                            <Button size="sm" disabled={saving === job.id} onClick={() => void save(job)}>
                              {saving === job.id ? <Loader2 className="animate-spin" /> : <Plus />}
                              Save to my jobs
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {job.isNew && <Badge>New</Badge>}
                        {job.matched.map((term) => (
                          <Badge key={term} variant="secondary">
                            {term}
                          </Badge>
                        ))}
                        <span className="text-xs text-muted-foreground">
                          via{" "}
                          <a href={SOURCE_SITES[job.source]} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">
                            {job.source}
                          </a>
                        </span>
                        {job.description && (
                          <button
                            type="button"
                            aria-expanded={expanded}
                            onClick={() => setOpen(expanded ? null : job.id)}
                            className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          >
                            {expanded ? "Hide details" : "Details"}
                            <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
                          </button>
                        )}
                      </div>
                      {expanded && (
                        <div className="grid gap-2 rounded-md bg-muted/50 p-3">
                          <p className="max-h-96 overflow-y-auto text-sm whitespace-pre-line">{job.description}</p>
                          <p className="text-xs text-muted-foreground">
                            Save it to check the fit, write a cover letter and track it. The original posting, where you
                            apply, is{" "}
                            <a href={job.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground">
                              on {job.source}
                            </a>
                            .
                          </p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function formatAge(iso: string) {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (Number.isNaN(days)) return "";
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" });
}
