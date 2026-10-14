"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, CircleAlert, ExternalLink, Loader2, Plus, Search, Sparkles } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { JobRecord } from "@/lib/db.ts";
import { COUNTRIES, searchLinks, SOURCE_SITES } from "@/lib/job-links.ts";
import type { FoundJob, SourceResult } from "@/lib/job-search.ts";
import { useSavedState } from "@/lib/use-saved-state.ts";
import { cn } from "@/lib/utils";

type Search = { queries: string[]; country: string; place: string; skills: string[] };
type Saved = Search & { results: FoundJob[] | null; sources: SourceResult[]; searchedAt: string | null };
type Suggestion = { searches: string[]; skills: string[]; country: string; fromModel: boolean; adzuna: boolean; profileEmpty: boolean };

const EMPTY_SEARCH: Search = { queries: ["", "", ""], country: "", place: "", skills: [] };

export function JobFinder() {
  const [search, setSearch] = useState<Search>(EMPTY_SEARCH);
  const [results, setResults] = useState<FoundJob[] | null>(null);
  const [sources, setSources] = useState<SourceResult[]>([]);
  const [searchedAt, setSearchedAt] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  // Job links already in your tracker, so a result you saved shows as saved.
  const [savedJobs, setSavedJobs] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  // The last search and its results stay until you search again.
  const loaded = useSavedState<Saved>(
    "jobsearch",
    { ...search, results, sources, searchedAt },
    (saved) => {
      setSearch({ queries: [...saved.queries, "", "", ""].slice(0, 3), country: saved.country, place: saved.place, skills: saved.skills ?? [] });
      setResults(saved.results);
      setSources(saved.sources ?? []);
      setSearchedAt(saved.searchedAt);
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
      setSuggestion(data);
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

  async function run(event?: React.FormEvent) {
    event?.preventDefault();
    setSearching(true);
    setError("");
    try {
      const response = await fetch("/api/jobs/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries: search.queries.filter((query) => query.trim()), country: search.country, place: search.place, skills: search.skills }),
      });
      const data = (await response.json()) as { results?: FoundJob[]; sources?: SourceResult[]; error?: string };
      if (data.sources) setSources(data.sources);
      if (!response.ok || !data.results) throw new Error(data.error ?? "The search failed.");
      setResults(data.results);
      setSearchedAt(new Date().toISOString());
      setOpen(null);
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
      const data = (await response.json()) as { job?: JobRecord; error?: string };
      if (!response.ok || !data.job) throw new Error(data.error ?? "Couldn't save the job.");
      setSavedJobs((current) => new Map(current).set(job.url, data.job!.id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(null);
    }
  }

  const setQuery = (i: number, value: string) =>
    setSearch((current) => ({ ...current, queries: current.queries.map((query, j) => (j === i ? value : query)) }));
  const queries = search.queries.map((query) => query.trim()).filter(Boolean);

  return (
    <div className="grid gap-6">
      {suggestion?.profileEmpty && (
        <Alert>
          <CircleAlert />
          <AlertTitle>Your profile is empty</AlertTitle>
          <AlertDescription>
            <p>
              Results are ranked by how well they match your skills and roles, so add those first (import your LinkedIn
              data or your CV).{" "}
              <Link href="/profile" className="font-medium text-foreground underline underline-offset-4">
                Go to Profile
              </Link>
            </p>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>What to look for</CardTitle>
          <CardDescription>
            Suggested from your profile; change them freely. Only these words and the country are sent to the job boards.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                  onChange={(event) => setSearch((current) => ({ ...current, country: event.target.value }))}
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
                  onChange={(event) => setSearch((current) => ({ ...current, place: event.target.value }))}
                />
              </div>
            </div>
            {search.skills.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Ranked by these skills from your profile: {search.skills.join(", ")}
              </p>
            )}
            <Button type="submit" className="justify-self-start" disabled={searching || queries.length === 0}>
              {searching ? <Loader2 className="animate-spin" /> : <Search />}
              {searching ? "Searching…" : "Find jobs"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {queries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Search on job sites</CardTitle>
            <CardDescription>
              The same searches on sites without an open API. They open in your browser; nothing is read from them.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {queries.map((query) => (
              <div key={query} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="min-w-36 font-medium">{query}</span>
                {searchLinks(query, search.country, search.place).map((link) => (
                  <a
                    key={link.site}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {link.site} <ExternalLink className="size-3" />
                  </a>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {(results || error) && (
        <Card>
          <CardHeader>
            <CardTitle>
              {results ? `${results.length} job${results.length === 1 ? "" : "s"} found` : "Results"}
            </CardTitle>
            <CardDescription>
              Best matches for your profile first. Save the ones you like to check the fit and write a cover letter.
              {searchedAt && ` Searched ${new Date(searchedAt).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`}
            </CardDescription>
          </CardHeader>
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
                Nothing matched your profile. Try broader titles, another country, or the job site links above.
              </p>
            )}
            {results && results.length > 0 && (
              <ul className="grid divide-y">
                {results.map((job) => {
                  const savedId = savedJobs.get(job.url);
                  const expanded = open === job.id;
                  return (
                    <li key={job.id} className="grid gap-2 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="grid min-w-0 gap-0.5">
                          <a
                            href={job.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium underline-offset-4 hover:underline"
                          >
                            {job.title}
                          </a>
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
                            {expanded ? "Hide" : "Description"}
                            <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
                          </button>
                        )}
                      </div>
                      {expanded && (
                        <p className="max-h-80 overflow-y-auto rounded-md bg-muted/50 p-3 text-sm whitespace-pre-line">{job.description}</p>
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
