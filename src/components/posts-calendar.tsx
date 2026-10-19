"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bot, ChevronLeft, ChevronRight, CircleAlert, PenLine } from "lucide-react";
import { formatWhen } from "@/components/post-editor";
import { Button } from "@/components/ui/button";
import type { AutopilotSettings, AutopilotState } from "@/lib/autopilot.ts";
import type { PostRecord } from "@/lib/db.ts";
import { cn } from "@/lib/utils";

type Kind = "scheduled" | "posted" | "failed";

type Entry = { post: PostRecord; at: Date; kind: Kind };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const KIND_STYLES: Record<Kind, { chip: string; dot: string; label: string }> = {
  scheduled: { chip: "bg-info-soft text-info hover:bg-[color-mix(in_oklch,var(--info-soft),var(--info)_12%)]", dot: "bg-info", label: "Scheduled" },
  posted: { chip: "bg-success-soft text-success hover:bg-[color-mix(in_oklch,var(--success-soft),var(--success)_12%)]", dot: "bg-success", label: "Posted" },
  failed: { chip: "bg-destructive-soft text-destructive hover:bg-[color-mix(in_oklch,var(--destructive-soft),var(--destructive)_12%)]", dot: "bg-destructive", label: "Failed" },
};

// Where a post sits on the calendar: when it goes out, or when it went out. Drafts have no date.
function entryFor(post: PostRecord): Entry | null {
  if ((post.status === "scheduled" || post.status === "publishing") && post.scheduledAt)
    return { post, at: new Date(post.scheduledAt), kind: "scheduled" };
  if ((post.status === "posted" || post.status === "deleted") && post.postedAt)
    return { post, at: new Date(post.postedAt), kind: "posted" };
  if (post.status === "failed") return { post, at: new Date(post.scheduledAt ?? post.updatedAt), kind: "failed" };
  return null;
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function sameDay(a: Date, b: Date) {
  return dayKey(a) === dayKey(b);
}

// The weeks shown for a month, Monday first, padded with the neighbouring months' days.
function monthGrid(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - offset);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const cells = Math.ceil((offset + last.getDate()) / 7) * 7;
  return Array.from({ length: cells }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function title(post: PostRecord) {
  return post.text.trim().split("\n")[0] || post.topic || "Empty post";
}

function time(date: Date) {
  return date.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
}

export function PostsCalendar({
  onOpen,
  refreshKey,
  updated,
}: {
  onOpen: (id: string) => void;
  refreshKey: number;
  updated: PostRecord | null;
}) {
  const [posts, setPosts] = useState<PostRecord[] | null>(null);
  const [autopilot, setAutopilot] = useState<{ settings: AutopilotSettings; state: AutopilotState } | null>(null);
  const [error, setError] = useState("");
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  useEffect(() => {
    fetch("/api/posts")
      .then((response) => response.json() as Promise<{ posts: PostRecord[] }>)
      .then(({ posts }) => setPosts(posts))
      .catch(() => setError("Couldn't load your posts."));
    fetch("/api/autopilot")
      .then((response) => response.json() as Promise<{ settings: AutopilotSettings; state: AutopilotState }>)
      .then(setAutopilot)
      .catch(() => {});
  }, [refreshKey]);

  useEffect(() => {
    if (!updated) return;
    setPosts((current) => current && current.map((post) => (post.id === updated.id ? updated : post)));
  }, [updated]);

  const entries = useMemo(
    () =>
      (posts ?? [])
        .map(entryFor)
        .filter((entry): entry is Entry => entry !== null)
        .sort((a, b) => a.at.getTime() - b.at.getTime()),
    [posts],
  );
  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const entry of entries) map.set(dayKey(entry.at), [...(map.get(dayKey(entry.at)) ?? []), entry]);
    return map;
  }, [entries]);

  const drafts = (posts ?? []).filter((post) => post.status === "draft" && post.text.trim());
  const nextAuto =
    autopilot?.settings.enabled && autopilot.state.nextRunAt ? new Date(autopilot.state.nextRunAt) : null;
  const days = monthGrid(month);
  const today = new Date();
  const inMonth = entries.filter((entry) => entry.at.getMonth() === month.getMonth() && entry.at.getFullYear() === month.getFullYear());
  const upcoming = entries.filter((entry) => entry.kind === "scheduled" && entry.at >= today);

  function shift(by: number) {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + by, 1));
  }

  const monthLabel = month.toLocaleDateString("en", { month: "long", year: "numeric" });

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_17rem] xl:items-start">
      <section aria-label={`Calendar for ${monthLabel}`} className="overflow-hidden rounded-xl border bg-card shadow-card">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <h2 className="mr-auto text-base font-semibold tracking-tight" aria-live="polite">
            {monthLabel}
          </h2>
          <Legend />
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}>
              Today
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => shift(-1)}>
              <ChevronLeft />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => shift(1)}>
              <ChevronRight />
            </Button>
          </div>
        </div>

        {error && <p className="px-4 py-3 text-sm text-destructive">{error}</p>}

        {/* Month grid on wider screens. */}
        <div className="hidden md:block">
          <div className="grid grid-cols-7 border-b bg-surface/60 text-xs font-medium text-muted-foreground">
            {WEEKDAYS.map((day) => (
              <div key={day} className="px-2.5 py-2">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day, index) => {
              const items = byDay.get(dayKey(day)) ?? [];
              const outside = day.getMonth() !== month.getMonth();
              const isToday = sameDay(day, today);
              const autoHere = nextAuto && sameDay(day, nextAuto);
              return (
                <div
                  key={day.toISOString()}
                  className={cn(
                    "min-h-28 min-w-0 overflow-hidden border-b p-1.5",
                    index % 7 !== 6 && "border-r",
                    outside && "bg-surface/50",
                    index >= days.length - 7 && "border-b-0",
                  )}
                >
                  <div className="flex items-center justify-between px-1 pb-1">
                    <span
                      className={cn(
                        "grid size-6 place-items-center rounded-full text-xs tabular-nums",
                        outside ? "text-muted-foreground/60" : "text-muted-foreground",
                        isToday && "bg-primary font-semibold text-primary-foreground",
                      )}
                      aria-label={isToday ? "Today" : undefined}
                    >
                      {day.getDate()}
                    </span>
                  </div>
                  <ul className="grid min-w-0 grid-cols-1 gap-1">
                    {!posts &&
                      index % 5 === 2 && <li className="skeleton h-5 rounded" aria-hidden />}
                    {items.slice(0, 3).map((entry) => (
                      <li key={entry.post.id}>
                        <button
                          type="button"
                          onClick={() => onOpen(entry.post.id)}
                          title={`${KIND_STYLES[entry.kind].label} · ${formatWhen(entry.at.toISOString())}\n${title(entry.post)}`}
                          className={cn(
                            "flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[0.72rem] font-medium transition-colors",
                            KIND_STYLES[entry.kind].chip,
                            entry.post.status === "deleted" && "line-through opacity-70",
                          )}
                        >
                          {entry.kind === "failed" && <CircleAlert className="size-3 shrink-0" />}
                          <span className="shrink-0 tabular-nums opacity-80">{time(entry.at)}</span>
                          <span className="truncate">{title(entry.post)}</span>
                        </button>
                      </li>
                    ))}
                    {items.length > 3 && (
                      <li className="px-1.5 text-[0.7rem] text-muted-foreground">+{items.length - 3} more</li>
                    )}
                    {autoHere && (
                      <li>
                        <Link
                          href="/autopilot"
                          title={`Auto-posting writes the next post around ${time(nextAuto)}`}
                          className="flex items-center gap-1 truncate rounded border border-dashed px-1.5 py-0.5 text-[0.72rem] text-muted-foreground hover:text-foreground"
                        >
                          <Bot className="size-3 shrink-0" />
                          <span className="tabular-nums">{time(nextAuto)}</span>
                          <span className="truncate">Auto-post</span>
                        </Link>
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>

        {/* An agenda for the month on phones, where a 7-column grid is too cramped to read. */}
        <div className="md:hidden">
          {posts && inMonth.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nothing scheduled or posted this month.</p>
          ) : (
            <ol className="divide-y">
              {inMonth.map((entry) => (
                <li key={entry.post.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(entry.post.id)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/60"
                  >
                    <span className="grid w-11 shrink-0 justify-items-center rounded-md border bg-surface py-1 leading-tight">
                      <span className="text-[0.65rem] text-muted-foreground uppercase">
                        {entry.at.toLocaleDateString("en", { weekday: "short" })}
                      </span>
                      <span className="text-base font-semibold tabular-nums">{entry.at.getDate()}</span>
                    </span>
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate text-sm font-medium">{title(entry.post)}</span>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className={cn("size-1.5 rounded-full", KIND_STYLES[entry.kind].dot)} />
                        {KIND_STYLES[entry.kind].label} · {time(entry.at)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      <aside className="grid gap-4">
        <SidePanel title="Coming up">
          {!posts ? (
            <div className="grid gap-2 p-4">
              <span className="skeleton h-4 rounded" />
              <span className="skeleton h-4 w-2/3 rounded" />
            </div>
          ) : upcoming.length === 0 && !nextAuto ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">
              Nothing scheduled. Open a draft and pick a time under Publish.
            </p>
          ) : (
            <ul className="divide-y">
              {nextAuto && (
                <li>
                  <Link href="/autopilot" className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-muted/60">
                    <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="grid gap-0.5 text-sm">
                      <span className="font-medium">Next auto-post</span>
                      <span className="text-xs text-muted-foreground">{formatWhen(nextAuto.toISOString())}</span>
                    </span>
                  </Link>
                </li>
              )}
              {upcoming.slice(0, 6).map((entry) => (
                <li key={entry.post.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(entry.post.id)}
                    className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left hover:bg-muted/60"
                  >
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-info" />
                    <span className="grid min-w-0 gap-0.5 text-sm">
                      <span className="truncate font-medium">{title(entry.post)}</span>
                      <span className="text-xs text-muted-foreground">{formatWhen(entry.at.toISOString())}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SidePanel>

        <SidePanel title="Drafts to schedule">
          {posts && drafts.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">
              No drafts waiting.{" "}
              <Link href="/write" className="font-medium text-foreground underline underline-offset-2">
                Write one
              </Link>
              .
            </p>
          ) : (
            <ul className="divide-y">
              {drafts.slice(0, 6).map((post) => (
                <li key={post.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(post.id)}
                    className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left hover:bg-muted/60"
                  >
                    <PenLine className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm">{title(post)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SidePanel>
        <p className="px-1 text-xs leading-relaxed text-muted-foreground">
          Scheduled posts go out while this app is running on your computer. If it&apos;s off at that time, the post
          goes out when you start it again (up to 12 hours late).
        </p>
      </aside>
    </div>
  );
}

function Legend() {
  return (
    <ul className="mr-2 hidden items-center gap-3 text-xs text-muted-foreground sm:flex" aria-label="Legend">
      {(Object.keys(KIND_STYLES) as Kind[]).map((kind) => (
        <li key={kind} className="flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", KIND_STYLES[kind].dot)} />
          {KIND_STYLES[kind].label}
        </li>
      ))}
    </ul>
  );
}

function SidePanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-card">
      <h3 className="border-b px-4 py-2.5 text-sm font-semibold tracking-tight">{title}</h3>
      {children}
    </section>
  );
}
