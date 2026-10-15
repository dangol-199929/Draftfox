"use client";

import { useEffect, useState } from "react";
import { Bookmark, Check, ChevronDown, ExternalLink, Loader2, Plus, Search, Sparkles, X } from "lucide-react";
import { FitScore, formatAge } from "@/components/job-badges";
import { JobListCard, selectInUrl, SplitLayout, useWide } from "@/components/job-split";
import { JobWorkspace } from "@/components/job-workspace";
import { Keywords } from "@/components/job-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { JobRecord } from "@/lib/db.ts";
import type { JobStatus } from "@/lib/job-status.ts";
import { boardLinks, COUNTRIES, DEFAULT_PREFS, POSTED_WITHIN, SOURCE_SITES, type PostedWithin, type SearchPrefs } from "@/lib/job-links.ts";
import type { FoundJob, SourceResult } from "@/lib/job-search.ts";
import { useSavedState } from "@/lib/use-saved-state.ts";
import { cn } from "@/lib/utils";

type Search = { queries: string[]; country: string; place: string; skills: string[] } & SearchPrefs;
type Saved = Search & { results: FoundJob[] | null; sources: SourceResult[]; searchedAt: string | null; savedSearchId?: string | null };
type SavedSearch = Search & { id: string; name: string; lastRun: string | null; seenCount: number };
type Suggestion = { searches: string[]; skills: string[]; country: string; fromModel: boolean; adzuna: boolean; profileEmpty: boolean };

const EMPTY_SEARCH: Search = { queries: ["", "", ""], country: "", place: "", skills: [], ...DEFAULT_PREFS };

type SavedJob = { id: string; status: JobStatus };

// Searches job boards and lists the matching jobs right here, with the selected one beside the list. onSaved hears
// about each job saved to your list; initialJob is the result to select first (from ?job= in the address).
export function JobFinder({
  onSaved,
  onRemoved,
  initialJob = null,
}: {
  onSaved?: (job: JobRecord) => void;
  onRemoved?: (id: string) => void;
  initialJob?: string | null;
}) {
  const [search, setSearch] = useState<Search>(EMPTY_SEARCH);
  const [results, setResults] = useState<FoundJob[] | null>(null);
  const [sources, setSources] = useState<SourceResult[]>([]);
  const [searchedAt, setSearchedAt] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  // Job links already in your tracker, so a result you saved shows as saved (or applied).
  const [savedJobs, setSavedJobs] = useState<Map<string, SavedJob>>(new Map());
  const [saving, setSaving] = useState<string | null>(null);
  // The result shown beside the list (or in the drawer on narrow screens), and one to prepare as soon as it opens.
  const [selected, setSelected] = useState<string | null>(initialJob);
  const [prepareId, setPrepareId] = useState<string | null>(null);
  // Filters on the list that don't need a new search.
  const [hasSalary, setHasSalary] = useState(false);
  const [hideSaved, setHideSaved] = useState(false);
  const wide = useWide();
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
      setSearch({
        queries: [...saved.queries, "", "", ""].slice(0, 3),
        country: saved.country,
        place: saved.place,
        skills: saved.skills ?? [],
        remoteOnly: saved.remoteOnly ?? false,
        postedWithin: saved.postedWithin ?? "",
      });
      setResults(saved.results);
      setSources(saved.sources ?? []);
      setSearchedAt(saved.searchedAt);
      setSavedSearchId(saved.savedSearchId ?? null);
      setRestored(true);
    },
  );

  function loadSavedJobs() {
    fetch("/api/jobs")
      .then((response) => response.json() as Promise<{ jobs: JobRecord[] }>)
      .then(({ jobs }) => setSavedJobs(new Map(jobs.filter((job) => job.url).map((job) => [job.url, { id: job.id, status: job.status }]))))
      .catch(() => {});
  }
  useEffect(loadSavedJobs, []);

  function select(id: string | null) {
    setSelected(id);
    selectInUrl(id);
  }

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
          remoteOnly: from.remoteOnly,
          postedWithin: from.postedWithin,
          savedSearchId: fromId ?? undefined,
        }),
      });
      const data = (await response.json()) as { results?: FoundJob[]; sources?: SourceResult[]; error?: string };
      if (data.sources) setSources(data.sources);
      if (!response.ok || !data.results) throw new Error(data.error ?? "The search failed.");
      setResults(data.results);
      setSearchedAt(new Date().toISOString());
      select(data.results[0]?.id ?? null);
      setOnlyNew(false);
      if (fromId) loadSavedSearches();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  }

  // Saves the result to your jobs and returns its id there (the existing one if it's already saved).
  async function save(job: FoundJob, status?: JobStatus): Promise<string | null> {
    const existing = savedJobs.get(job.url);
    if (existing) return existing.id;
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
          notes: `Found on ${job.via ?? job.source}${job.salary ? `. Salary listed: ${job.salary}` : ""}.`,
          source: job.via ?? job.source,
          salary: job.salary,
          postedAt: job.postedAt,
        }),
      });
      const data = (await response.json()) as { job?: JobRecord; error?: string; duplicateId?: string };
      // Already in your list (saved from another board, say): show it as saved.
      const id = data.job?.id ?? data.duplicateId;
      if (!id) throw new Error(data.error ?? "Couldn't save the job.");
      let saved: SavedJob = { id, status: data.job?.status ?? "saved" };
      if (status && status !== saved.status) {
        const patched = await fetch(`/api/jobs/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        if (patched.ok) saved = { id, status };
      }
      setSavedJobs((current) => new Map(current).set(job.url, saved));
      if (data.job) onSaved?.(data.job);
      return id;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setSaving(null);
    }
  }

  // Prepare application on a result you haven't saved: save it, then let its page write the drafts.
  async function prepare(job: FoundJob) {
    const id = await save(job);
    if (id) setPrepareId(id);
  }

  // Running a saved search again: fill in the form and search, marking what's new.
  function runSaved(saved: SavedSearch) {
    // Your remote and date preferences stay as they are.
    const from = { ...search, queries: [...saved.queries, "", "", ""].slice(0, 3), country: saved.country, place: saved.place, skills: saved.skills };
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
  const shown = (results ?? []).filter((job) => {
    if (onlyNew && !job.isNew) return false;
    if (hasSalary && !job.salary) return false;
    if (hideSaved && savedJobs.has(job.url)) return false;
    if (search.remoteOnly && !/remote|anywhere|work from home|wfh/i.test(`${job.location} ${job.title}`)) return false;
    if (search.postedWithin && job.postedAt && Date.now() - Date.parse(job.postedAt) > Number(search.postedWithin) * 86_400_000) return false;
    return true;
  });
  const current = (results ?? []).find((job) => job.id === selected) ?? null;
  const currentSaved = current ? savedJobs.get(current.url) : undefined;

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
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-brand"
                  checked={search.remoteOnly}
                  onChange={(event) => setSearch((current) => ({ ...current, remoteOnly: event.target.checked }))}
                />
                Remote only
              </label>
              <label className="flex items-center gap-2 text-sm">
                Posted
                <select
                  value={search.postedWithin}
                  onChange={(event) => setSearch((current) => ({ ...current, postedWithin: event.target.value as PostedWithin }))}
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                >
                  {POSTED_WITHIN.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
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
          {queries.length > 0 && (
            <div className="mt-5 grid gap-2 border-t pt-4">
              <p className="text-sm font-medium">Search on the big job sites yourself</p>
              <p className="text-xs text-muted-foreground">
                They don&apos;t let apps search them, so these open your search in a new tab, with your country, city, remote
                and date choices. Found one you like? Copy its link into <span className="font-medium">Paste a job</span> on
                Your jobs.
              </p>
              <ul className="grid gap-1.5">
                {queries.map((query) => (
                  <li key={query} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="min-w-0 truncate text-muted-foreground">{query}:</span>
                    {boardLinks(query, search.country, search.place, search).map((link) => (
                      <a
                        key={link.name}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
                      >
                        {link.name}
                        <ExternalLink className="size-3" />
                      </a>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {(results || error) && (
        <section className="grid gap-3" aria-labelledby="results-heading">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="grid gap-0.5">
              <h2 id="results-heading" className="text-base font-semibold">
                {results ? `${results.length} job${results.length === 1 ? "" : "s"} found${newCount ? `, ${newCount} new` : ""}` : "Results"}
              </h2>
              <p className="text-xs text-muted-foreground">
                Best matches for your profile first.
                {searchedAt && ` Searched ${new Date(searchedAt).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`}
              </p>
            </div>
          </div>
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
            <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
              Nothing matched your profile. Try broader titles, another country, or fewer filters.
            </p>
          )}
          {results && results.length > 0 && (
            <SplitLayout
              wide={wide}
              open={current !== null}
              onClose={() => select(null)}
              title={current?.title ?? "Job"}
              fullPage={currentSaved ? `/jobs/${currentSaved.id}` : undefined}
              list={
                <Card className="gap-0 py-0">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 text-sm">
                    <ListToggle checked={search.remoteOnly} onChange={(value) => setSearch((s) => ({ ...s, remoteOnly: value }))} label="Remote only" />
                    <ListToggle checked={hasSalary} onChange={setHasSalary} label="Has salary" />
                    <ListToggle checked={hideSaved} onChange={setHideSaved} label="Hide saved" />
                    {newCount > 0 && <ListToggle checked={onlyNew} onChange={setOnlyNew} label={`Only new (${newCount})`} />}
                    <select
                      aria-label="Posted within"
                      value={search.postedWithin}
                      onChange={(event) => setSearch((s) => ({ ...s, postedWithin: event.target.value as PostedWithin }))}
                      className="h-7 rounded-md border border-input bg-transparent px-1.5 text-xs outline-none focus-visible:border-ring dark:bg-input/30"
                    >
                      {POSTED_WITHIN.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {shown.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground">No jobs match these filters.</p>
                  ) : (
                    <ul className="grid gap-0.5 p-1.5 xl:max-h-[calc(100dvh-14rem)] xl:overflow-y-auto">
                      {shown.map((job) => {
                        const saved = savedJobs.get(job.url);
                        return (
                          <li key={job.id}>
                            <JobListCard
                              selected={job.id === selected}
                              onSelect={() => select(job.id)}
                              job={{ ...job, source: job.via ?? job.source, status: saved?.status ?? null }}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
              }
              detail={
                current &&
                (currentSaved ? (
                  <JobWorkspace
                    key={currentSaved.id}
                    id={currentSaved.id}
                    prepareOnOpen={prepareId === currentSaved.id}
                    onChange={(job) =>
                      setSavedJobs((map) => {
                        const before = map.get(current.url);
                        if (before?.status === job.status) return map;
                        return new Map(map).set(current.url, { id: job.id, status: job.status });
                      })
                    }
                    onDeleted={() => {
                      onRemoved?.(currentSaved.id);
                      setSavedJobs((map) => {
                        const next = new Map(map);
                        next.delete(current.url);
                        return next;
                      });
                    }}
                  />
                ) : (
                  <FoundJobDetail
                    job={current}
                    saving={saving === current.id}
                    onSave={() => void save(current)}
                    onPrepare={() => void prepare(current)}
                    onApplied={() => void save(current, "applied")}
                  />
                ))
              }
            />
          )}
        </section>
      )}

    </div>
  );
}

function ListToggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <input type="checkbox" className="size-3.5 accent-brand" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

// A result you haven't saved yet: what the posting says, how its keywords match your profile, and what to do next.
function FoundJobDetail({
  job,
  saving,
  onSave,
  onPrepare,
  onApplied,
}: {
  job: FoundJob;
  saving: boolean;
  onSave: () => void;
  onPrepare: () => void;
  onApplied: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const long = job.description.length > 600;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg leading-snug">{job.title}</CardTitle>
        <CardDescription>{[job.company, job.location].filter(Boolean).join(" · ")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          {job.isNew && <Badge>New</Badge>}
          <FitScore score={job.fit} />
          {job.salary && <span className="font-medium text-foreground">{job.salary}</span>}
          {job.postedAt && <span>Posted {formatAge(job.postedAt)}</span>}
          <span>
            via {job.via ? `${job.via}, found by ` : ""}
            <a href={SOURCE_SITES[job.source]} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">
              {job.source}
            </a>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <a href={job.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink />
              Open job page
            </a>
          </Button>
          <Button disabled={saving} onClick={onPrepare}>
            {saving ? <Loader2 className="animate-spin" /> : <Sparkles />}
            Prepare application
          </Button>
          <Button variant="outline" disabled={saving} onClick={onSave}>
            <Plus />
            Save to my jobs
          </Button>
          <Button variant="ghost" disabled={saving} onClick={onApplied}>
            <Check />
            Mark applied
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Prepare application saves the job and writes what your Settings page says. You apply on the job&apos;s own page.
        </p>
        <div className="grid gap-2 border-t pt-4">
          <h3 className="text-sm font-medium">Job description</h3>
          {job.description ? (
            <>
              <p className={cn("text-sm whitespace-pre-line", !showAll && long && "line-clamp-[10]")}>{job.description}</p>
              {long && (
                <button
                  type="button"
                  aria-expanded={showAll}
                  onClick={() => setShowAll((open) => !open)}
                  className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  {showAll ? "Show less" : "Show the whole description"}
                  <ChevronDown className={cn("size-3.5 transition-transform", showAll && "rotate-180")} />
                </button>
              )}
              {job.description.length < 400 && (
                <p className="text-xs text-muted-foreground">This board only gives a snippet; the full posting is on the job page.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No description given; open the job page to read it.</p>
          )}
        </div>
        <Keywords keywords={job.keywords ?? null} />
      </CardContent>
    </Card>
  );
}
