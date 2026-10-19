import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Check, ExternalLink, Lock, X } from "lucide-react";
import { ActivityChart } from "@/components/activity-chart";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getStatus } from "@/lib/linkedin.ts";
import { RANGES, buildReport, isRange, type Range } from "@/lib/reports.ts";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reports" };

const RANGE_LABELS: Record<Range, string> = { "7": "7 days", "30": "30 days", "90": "90 days", all: "All time" };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // The report reads the local database, so it must be fresh on every visit.
  await connection();
  const params = await searchParams;
  const range: Range = isRange(params.range) ? params.range : "30";
  const [report, linkedIn] = await Promise.all([buildReport(range), getStatus()]);
  const { totals, previous } = report;
  const period = range === "all" ? "" : `previous ${RANGE_LABELS[range]}`;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Reports"
        description="What you've done in this app, from the activity it keeps on this computer."
      />

      <nav aria-label="Time range" className="flex flex-wrap gap-1">
        {RANGES.map((value) => (
          <Link
            key={value}
            href={value === "30" ? "/reports" : `/reports?range=${value}`}
            aria-current={value === range ? "page" : undefined}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              value === range && "bg-muted text-foreground",
            )}
          >
            {RANGE_LABELS[value]}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Drafts generated"
          value={totals.drafts}
          change={previous && { before: previous.drafts, period }}
          note={
            totals.stopped || totals.failed
              ? [totals.stopped && `${totals.stopped} stopped`, totals.failed && `${totals.failed} failed`]
                  .filter(Boolean)
                  .join(", ")
              : undefined
          }
        />
        <Stat label="Drafts copied" value={totals.copied} />
        <Stat
          label="Posted to LinkedIn"
          value={totals.published}
          change={previous && { before: previous.published, period }}
          note={totals.removed ? `${totals.removed} deleted from LinkedIn` : undefined}
        />
        <Stat
          label="Average generation time"
          value={totals.avgSeconds === null ? "–" : `${totals.avgSeconds.toFixed(1)} s`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>
            Drafts generated and posts published per {report.bucketSize}
            {range === "all" ? ", since the app started keeping a record." : "."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {report.empty ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nothing yet in this period.{" "}
              <Link href="/write" className="underline underline-offset-2 hover:text-foreground">
                Generate a draft
              </Link>{" "}
              and it will show up here.
            </p>
          ) : (
            <ActivityChart buckets={report.buckets} />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2 md:items-start">
        <Card>
          <CardHeader>
            <CardTitle>What you write</CardTitle>
            <CardDescription>Length and tone of the drafts you generated.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <Breakdown title="Length" rows={report.lengths.map((row) => ({ ...row, label: capitalize(row.label) }))} />
            {report.tones.length > 0 ? (
              <Breakdown title="Most used tones" rows={report.tones.map((row) => ({ ...row, label: capitalize(row.label) }))} />
            ) : (
              <p className="text-sm text-muted-foreground">No tone was set on these drafts.</p>
            )}
          </CardContent>
        </Card>

        {/* Fixed height with its own scroll, so a busy period doesn't stretch the page. */}
        <Card className="md:h-[25rem]">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            {report.activity.length > 0 && (
              <CardDescription>Newest first.</CardDescription>
            )}
          </CardHeader>
          <CardContent className="max-h-[25rem] min-h-0 flex-1 overflow-y-auto md:max-h-none">
            {report.activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet in this period.</p>
            ) : (
              <ul className="grid gap-2.5 pb-1">
                {report.activity.map((item, index) => (
                  <li key={`${item.at}-${index}`} className="flex gap-3 text-sm">
                    <time dateTime={item.at} className="w-28 shrink-0 text-muted-foreground tabular-nums">
                      {formatWhen(item.at)}
                    </time>
                    <span className="min-w-0 break-words">{item.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Posted from this app</CardTitle>
          <CardDescription>
            Posts you published with Post to LinkedIn. Open one to see its reactions and views on LinkedIn.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {report.posts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No posts published from the app in this period.</p>
          ) : (
            <ul className="grid divide-y">
              {report.posts.map((post) => (
                <li key={post.urn} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <p className={cn("truncate text-sm", post.deleted && "text-muted-foreground line-through")}>
                      {post.preview || "Untitled post"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatWhen(post.at)} · {post.visibility}
                      {post.characters !== null && ` · ${post.characters.toLocaleString("en")} characters`}
                    </p>
                  </div>
                  {post.deleted ? (
                    <Badge variant="outline">Deleted</Badge>
                  ) : (
                    <a
                      href={post.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline"
                    >
                      View on LinkedIn
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {report.jobs && (
        <Card>
          <CardHeader>
            <CardTitle>Job search</CardTitle>
            <CardDescription>
              From the jobs you track on the{" "}
              <Link href="/jobs" className="underline underline-offset-2 hover:text-foreground">
                Jobs
              </Link>{" "}
              page and the dates you changed their status.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Applied" value={report.jobs.applied} />
              <Stat
                label="Replies"
                value={report.jobs.replied}
                note={report.jobs.applied ? `${Math.round((report.jobs.replied / report.jobs.applied) * 100)}% of applications` : undefined}
              />
              <Stat label="Interviews" value={report.jobs.interviews} />
              <Stat label="Offers" value={report.jobs.offers} note={report.jobs.rejected ? `${report.jobs.rejected} rejected` : undefined} />
            </div>
            <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
              <div className="grid gap-2">
                <p className="text-sm font-medium">Applications per week (last 12 weeks)</p>
                <MonthBars months={report.jobs.weeks} unit="application" />
              </div>
              <Breakdown title="Where your jobs are now" rows={report.jobs.stages} />
            </div>
          </CardContent>
        </Card>
      )}

      {report.history && (
        <Card>
          <CardHeader>
            <CardTitle>Your LinkedIn posting history</CardTitle>
            <CardDescription>
              Posts per month from the LinkedIn data you imported on {formatDay(report.history.importedAt)} (your{" "}
              {report.history.total} most recent posts). Import again on the{" "}
              <Link href="/profile" className="underline underline-offset-2 hover:text-foreground">
                Profile
              </Link>{" "}
              page to update it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MonthBars months={report.history.months} />
          </CardContent>
        </Card>
      )}

      <LinkedInInsights
        connected={linkedIn.connected && !linkedIn.expired}
        canPost={linkedIn.canPost}
        imported={report.history !== null}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  change,
}: {
  label: string;
  value: number | string;
  note?: string;
  change?: { before: number; period: string } | null;
}) {
  const diff = change && typeof value === "number" ? value - change.before : null;
  return (
    <Card size="sm">
      <CardContent className="grid gap-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {diff !== null && change && (
          <p className="text-xs text-muted-foreground">
            {diff === 0 ? "Same as" : `${diff > 0 ? "+" : "−"}${Math.abs(diff)} vs`} {change.period}
          </p>
        )}
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">{title}</p>
      <ul className="grid gap-1.5">
        {rows.map((row) => (
          <li key={row.label} className="grid grid-cols-[7rem_1fr_2rem] items-center gap-2 text-sm">
            <span className="truncate text-muted-foreground" title={row.label}>
              {row.label}
            </span>
            <span className="h-2 rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-chart-2"
                style={{ width: `${(row.count / max) * 100}%` }}
              />
            </span>
            <span className="text-right tabular-nums">{row.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MonthBars({ months, unit = "post" }: { months: { month: string; label: string; count: number }[]; unit?: string }) {
  const max = Math.max(1, ...months.map((month) => month.count));
  const labelEvery = Math.ceil(months.length / 6);
  return (
    <div className="grid gap-1.5">
      <div className="flex h-28 items-end gap-1 border-b">
        {months.map((month) => (
          <div
            key={month.month}
            className="group relative flex h-full flex-1 items-end justify-center"
            title={`${month.label}: ${month.count} ${unit}${month.count === 1 ? "" : "s"}`}
          >
            {month.count > 0 && (
              <span
                className="w-full max-w-6 rounded-t-[3px] bg-chart-2 group-hover:bg-foreground"
                style={{ height: `${(month.count / max) * 100}%` }}
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-1 text-[11px] text-muted-foreground">
        {months.map((month, index) => (
          <span key={month.month} className="flex-1 truncate text-center">
            {index % labelEvery === 0 ? month.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

// What LinkedIn lets this app read about your posts and profile, and what it would take to get more.
function LinkedInInsights({ connected, canPost, imported }: { connected: boolean; canPost: boolean; imported: boolean }) {
  const available = [
    { text: "Your name, email and photo", ok: connected, how: "Sign In with LinkedIn" },
    { text: "Publishing and deleting posts", ok: canPost, how: "Share on LinkedIn" },
    { text: "Which posts you published from this app, and when", ok: true, how: "Kept by this app" },
    { text: "Your past posts and their dates", ok: imported, how: "LinkedIn data export, imported on the Profile page" },
  ];
  const locked = [
    "Impressions and members reached",
    "Reactions, comments, reposts, saves and sends",
    "Link clicks, profile views and followers gained from a post",
    "Your follower count and follower growth",
    "Who viewed your profile and search appearances",
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>LinkedIn insights</CardTitle>
        <CardDescription>
          LinkedIn doesn&apos;t give personal apps access to post or profile analytics, so the numbers below can&apos;t
          be shown here yet.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <div className="grid content-start gap-2">
          <p className="text-sm font-medium">Available with your LinkedIn app</p>
          <ul className="grid gap-2">
            {available.map((item) => (
              <li key={item.text} className="flex gap-2 text-sm">
                {item.ok ? (
                  <Check className="mt-0.5 size-4 shrink-0" aria-label="Available" />
                ) : (
                  <X className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Not set up" />
                )}
                <span>
                  {item.text}
                  <span className="block text-xs text-muted-foreground">
                    {item.how}
                    {!item.ok && " (not set up yet)"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="grid content-start gap-2">
          <p className="text-sm font-medium">Needs access LinkedIn only gives to businesses</p>
          <ul className="grid gap-2">
            {locked.map((text) => (
              <li key={text} className="flex gap-2 text-sm text-muted-foreground">
                <Lock className="mt-0.5 size-4 shrink-0" aria-label="Not available" />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <div className="grid gap-2 text-sm text-muted-foreground md:col-span-2">
          <p>
            These numbers come from LinkedIn&apos;s Member Post Analytics and Member Follower Statistics APIs
            (permissions <code className="text-foreground">r_member_postAnalytics</code> and{" "}
            <code className="text-foreground">r_member_profileAnalytics</code>). They are part of the{" "}
            <b className="font-medium text-foreground">Community Management API</b>, which LinkedIn reviews by hand and
            only grants to registered companies: it asks for a business email, the company&apos;s legal name, address,
            website and privacy policy, and a LinkedIn Page that verifies the app. It also has to be requested on a new
            LinkedIn app that has no other products, so it can&apos;t simply be added to this one. Reading your own posts
            (<code className="text-foreground">r_member_social</code>) is closed to new requests altogether.
          </p>
          <p>
            Until then, the full numbers are on LinkedIn itself:{" "}
            <a
              href="https://www.linkedin.com/analytics/creator/content/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-2"
            >
              your post analytics
            </a>{" "}
            (with an Export button), or the analytics link under each post.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("en", { dateStyle: "medium" });
}
