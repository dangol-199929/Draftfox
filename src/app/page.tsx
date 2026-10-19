import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import {
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  CalendarClock,
  CalendarDays,
  Check,
  CircleAlert,
  Cpu,
  PenLine,
  Search,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { CommandLine } from "@/components/command-line";
import { formatDay, JobStatusBadge } from "@/components/job-badges";
import { StatusBadge } from "@/components/post-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { readAutopilot } from "@/lib/autopilot.ts";
import { listJobs, listPosts, type JobRecord, type PostRecord } from "@/lib/db.ts";
import { getStatus } from "@/lib/linkedin.ts";
import { getOllamaStatus } from "@/lib/ollama-status.ts";
import { readProfile } from "@/lib/profile.ts";
import { cn } from "@/lib/utils";

// The layout's title template only applies to nested routes, so the home page spells its title out.
export const metadata: Metadata = { title: { absolute: "Overview · Draftfox" } };

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // The Studio used to live here: keep /?post=<id> and /?tab=schedule links working.
  const { post, tab } = await searchParams;
  if (typeof post === "string") redirect(`/write?post=${encodeURIComponent(post)}`);
  if (tab === "schedule") redirect("/autopilot");

  // Reads the local database and asks Ollama, so it must be fresh on every visit.
  await connection();
  const [ollama, linkedIn, profile] = await Promise.all([getOllamaStatus(), getStatus(), readProfile()]);
  const posts = listPosts();
  const jobs = listJobs();
  const autopilot = readAutopilot();

  const now = new Date();
  const count = (test: (post: PostRecord) => boolean) => posts.filter(test).length;
  const drafts = posts.filter((p) => p.status === "draft").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const scheduled = posts
    .filter((p) => (p.status === "scheduled" || p.status === "publishing") && p.scheduledAt)
    .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!));
  const failed = posts.filter((p) => p.status === "failed");
  const postedCount = count((p) => p.status === "posted");

  const signedIn = linkedIn.connected && !linkedIn.expired;
  const firstName = (profile?.name || linkedIn.profile?.name || "").trim().split(/\s+/)[0];
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const steps = [
    { done: ollama.reachable && ollama.installed === true, label: "Start Ollama with your model", href: "/settings#local-ai" },
    { done: Boolean(profile && (profile.headline || profile.facts.trim() || profile.positions.length)), label: "Tell the AI about you", href: "/profile" },
    { done: posts.some((p) => p.text.trim()), label: "Write your first post", href: "/write" },
    { done: signedIn && linkedIn.canPost, label: "Connect LinkedIn to post", href: "/profile" },
    { done: jobs.length > 0, label: "Save a job you're interested in", href: "/jobs?tab=find" },
  ];
  const stepsDone = steps.filter((step) => step.done).length;

  const today = now.toISOString().slice(0, 10);
  const soon = new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const followUps = jobs
    .filter((job) => job.followUp && job.followUp <= soon && job.status !== "rejected")
    .sort((a, b) => a.followUp!.localeCompare(b.followUp!));
  const pipeline = (["saved", "applied", "interview", "offer"] as const).map((status) => ({
    status,
    count: jobs.filter((job) => job.status === status).length,
  }));
  const activeJobs = pipeline.reduce((sum, stage) => sum + stage.count, 0);

  return (
    <div className="grid gap-8">
      <header className="grid gap-1.5">
        <p className="text-xs font-semibold tracking-[0.08em] text-brand-strong uppercase">Overview</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem] sm:leading-tight">
          {greeting}
          {firstName ? `, ${firstName}` : ""}.
        </h1>
        <p className="text-sm text-muted-foreground">
          {summaryLine({ drafts: drafts.length, scheduled: scheduled.length, failed: failed.length, followUps: followUps.length })}
        </p>
      </header>

      <section aria-label="Quick actions" className="grid gap-3 sm:grid-cols-3">
        <QuickAction
          href="/write"
          icon={Sparkles}
          verb="Create"
          title="Write a post"
          description="Turn a topic into a draft with your local model."
          primary
        />
        <QuickAction
          href="/calendar"
          icon={CalendarDays}
          verb="Automate"
          title="Plan publishing"
          description={scheduled.length ? `${scheduled.length} scheduled. See the calendar.` : "Schedule drafts or turn on auto-posting."}
        />
        <QuickAction
          href="/jobs?tab=find"
          icon={Search}
          verb="Advance"
          title="Find jobs"
          description="Search boards from your profile and prepare applications."
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="grid gap-6">
          <Panel
            title="Posts"
            icon={PenLine}
            action={
              <Link href="/posts" className="text-sm font-medium text-muted-foreground hover:text-foreground">
                All posts
              </Link>
            }
          >
            <dl className="grid grid-cols-2 border-b sm:grid-cols-4">
              <Count label="Drafts" value={drafts.length} href="/posts" />
              <Count label="Scheduled" value={scheduled.length} href="/calendar" />
              <Count label="Posted" value={postedCount} href="/reports" />
              <Count label="Need attention" value={failed.length} href="/posts" tone={failed.length ? "bad" : undefined} />
            </dl>
            {posts.length === 0 ? (
              <Empty
                icon={Sparkles}
                title="No posts yet"
                text="Give the AI a topic and what happened, and it writes a first draft you can edit."
                action={{ href: "/write", label: "Write your first post" }}
              />
            ) : (
              <div className="grid divide-y">
                {failed.length > 0 && (
                  <PostGroup title="Didn't go out" posts={failed.slice(0, 3)} when={(p) => p.error ?? "Failed"} />
                )}
                <PostGroup
                  title="Up next"
                  posts={scheduled.slice(0, 3)}
                  when={(p) => formatWhen(p.scheduledAt!)}
                  empty={
                    autopilot.settings.enabled && autopilot.state.nextRunAt
                      ? `Nothing scheduled. Auto-posting writes the next one ${formatWhen(autopilot.state.nextRunAt)}.`
                      : "Nothing scheduled. Open a draft and pick a time under Publish."
                  }
                />
                <PostGroup
                  title="Recent drafts"
                  posts={drafts.slice(0, 3)}
                  when={(p) => `Edited ${formatWhen(p.updatedAt)}`}
                  empty="No drafts in progress."
                />
              </div>
            )}
          </Panel>

          <Panel
            title="Job search"
            icon={BriefcaseBusiness}
            action={
              <Link href="/jobs" className="text-sm font-medium text-muted-foreground hover:text-foreground">
                Applications
              </Link>
            }
          >
            {jobs.length === 0 ? (
              <Empty
                icon={Search}
                title="No jobs saved yet"
                text="Search job boards from your profile, or paste a posting you found. Each one gets a fit check and a cover letter draft."
                action={{ href: "/jobs?tab=find", label: "Find jobs" }}
              />
            ) : (
              <>
                <div className="grid gap-3 border-b px-5 py-4">
                  <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                    {pipeline.map(
                      (stage) =>
                        stage.count > 0 && (
                          <span
                            key={stage.status}
                            className={cn("h-full", PIPELINE_COLORS[stage.status])}
                            style={{ width: `${(stage.count / Math.max(1, activeJobs)) * 100}%` }}
                          />
                        ),
                    )}
                  </div>
                  <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                    {pipeline.map((stage) => (
                      <li key={stage.status} className="flex items-center gap-1.5">
                        <span className={cn("size-2 rounded-full", PIPELINE_COLORS[stage.status])} />
                        <span className="text-muted-foreground">{PIPELINE_LABELS[stage.status]}</span>
                        <span className="font-medium tabular-nums">{stage.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="px-5 py-4">
                  <p className="pb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Next steps this week</p>
                  {followUps.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No follow-ups due. Set a next-step date on a job to see it here.
                    </p>
                  ) : (
                    <ul className="grid gap-1">
                      {followUps.slice(0, 5).map((job) => (
                        <JobRow key={job.id} job={job} overdue={job.followUp! < today} />
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </Panel>
        </div>

        <div className="grid gap-6">
          {stepsDone < steps.length && (
            <Panel title="Getting started" icon={Check} action={<span className="text-xs text-muted-foreground tabular-nums">{stepsDone} of {steps.length}</span>}>
              <div className="px-5 pt-1 pb-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-brand" style={{ width: `${(stepsDone / steps.length) * 100}%` }} />
                </div>
              </div>
              <ol className="grid gap-0.5 px-2 pb-3">
                {steps.map((step) => (
                  <li key={step.label}>
                    <Link
                      href={step.href}
                      className="group/step flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted/60"
                    >
                      <span
                        className={cn(
                          "grid size-5 shrink-0 place-items-center rounded-full border",
                          step.done ? "border-transparent bg-success-soft text-success" : "border-dashed text-transparent",
                        )}
                      >
                        <Check className="size-3" />
                      </span>
                      <span className={cn("flex-1", step.done && "text-muted-foreground line-through decoration-muted-foreground/40")}>
                        {step.label}
                      </span>
                      {!step.done && <ArrowRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/step:opacity-100" />}
                    </Link>
                  </li>
                ))}
              </ol>
            </Panel>
          )}

          <Panel title="Workspace" icon={Cpu}>
            <ul className="grid divide-y">
              <StatusItem
                icon={Cpu}
                label="Local AI"
                tone={!ollama.reachable ? "bad" : ollama.installed ? "ok" : "warn"}
                status={!ollama.reachable ? "Ollama isn't running" : ollama.installed ? "Ready" : "Model not downloaded"}
                detail={ollama.model}
                href="/settings#local-ai"
              >
                {!ollama.reachable && <CommandLine command="ollama serve" />}
                {ollama.reachable && !ollama.installed && <CommandLine command={`ollama pull ${ollama.model}`} />}
              </StatusItem>
              <StatusItem
                icon={UserRound}
                label="LinkedIn"
                tone={!linkedIn.configured ? "off" : signedIn ? (linkedIn.canPost ? "ok" : "warn") : linkedIn.expired ? "warn" : "off"}
                status={
                  !linkedIn.configured
                    ? "Not set up"
                    : signedIn
                      ? linkedIn.canPost
                        ? "Connected, posting on"
                        : "Connected, posting off"
                      : linkedIn.expired
                        ? "Sign-in expired"
                        : "Not connected"
                }
                detail={signedIn ? (linkedIn.profile?.name ?? "") : "Drafts work without it"}
                href="/profile"
              />
              <StatusItem
                icon={Bot}
                label="Auto-posting"
                tone={autopilot.settings.enabled ? "ok" : "off"}
                status={autopilot.settings.enabled ? (autopilot.settings.mode === "auto" ? "On, posts directly" : "On, saves drafts for review") : "Off"}
                detail={
                  autopilot.settings.enabled && autopilot.state.nextRunAt
                    ? `Next ${formatWhen(autopilot.state.nextRunAt)}`
                    : `${autopilot.settings.topics.length} topic${autopilot.settings.topics.length === 1 ? "" : "s"} in the list`
                }
                href="/autopilot"
              />
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

const PIPELINE_LABELS = { saved: "Saved", applied: "Applied", interview: "Interviewing", offer: "Offers" } as const;
const PIPELINE_COLORS = { saved: "bg-chart-2", applied: "bg-info", interview: "bg-brand", offer: "bg-success" } as const;

function summaryLine({ drafts, scheduled, failed, followUps }: { drafts: number; scheduled: number; failed: number; followUps: number }) {
  const parts = [
    failed > 0 && `${failed} post${failed === 1 ? "" : "s"} need${failed === 1 ? "s" : ""} attention`,
    scheduled > 0 && `${scheduled} scheduled`,
    drafts > 0 && `${drafts} draft${drafts === 1 ? "" : "s"} in progress`,
    followUps > 0 && `${followUps} job follow-up${followUps === 1 ? "" : "s"} this week`,
  ].filter(Boolean);
  return parts.length ? `${parts.join(" · ")}.` : "Create, plan and keep your job search moving, all on this computer.";
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function QuickAction({
  href,
  icon: Icon,
  verb,
  title,
  description,
  primary,
}: {
  href: string;
  icon: LucideIcon;
  verb: string;
  title: string;
  description: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group/qa relative grid gap-3 overflow-hidden rounded-xl border bg-card p-4 shadow-card transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-[color-mix(in_oklch,var(--brand),var(--border)_60%)] hover:shadow-pop focus-visible:outline-2 focus-visible:outline-offset-2",
        primary && "border-[color-mix(in_oklch,var(--brand),var(--border)_65%)] bg-[linear-gradient(135deg,var(--brand-soft),var(--card)_70%)]",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "grid size-9 place-items-center rounded-lg border bg-surface text-muted-foreground transition-colors group-hover/qa:text-brand-strong",
            primary && "border-transparent bg-primary text-primary-foreground group-hover/qa:text-primary-foreground",
          )}
        >
          <Icon className="size-4.5" />
        </span>
        <span className="text-[0.68rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{verb}</span>
      </div>
      <div className="grid gap-0.5">
        <p className="flex items-center gap-1.5 font-semibold tracking-tight">
          {title}
          <ArrowRight className="size-3.5 -translate-x-1 opacity-0 transition-[opacity,transform] group-hover/qa:translate-x-0 group-hover/qa:opacity-100" />
        </p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </Link>
  );
}

function Panel({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-card">
      <div className="flex items-center gap-2 px-5 pt-4 pb-3">
        <Icon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}

function Count({ label, value, href, tone }: { label: string; value: number; href: string; tone?: "bad" }) {
  return (
    <Link href={href} className="group/count grid gap-0.5 px-5 py-3 transition-colors hover:bg-muted/50 [&:not(:last-child)]:border-r max-sm:[&:nth-child(2)]:border-r-0 max-sm:[&:nth-child(-n+2)]:border-b">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-xl font-semibold tabular-nums", tone === "bad" && value > 0 && "text-destructive")}>{value}</dd>
    </Link>
  );
}

function PostGroup({
  title,
  posts,
  when,
  empty,
}: {
  title: string;
  posts: PostRecord[];
  when: (post: PostRecord) => string;
  empty?: string;
}) {
  return (
    <div className="px-5 py-4">
      <p className="pb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
      {posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="grid gap-1">
          {posts.map((post) => (
            <li key={post.id}>
              <Link
                href={`/posts?post=${post.id}`}
                className="-mx-2 flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60"
              >
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-sm font-medium">{post.text.trim().split("\n")[0] || post.topic || "Empty draft"}</span>
                  <span className={cn("truncate text-xs text-muted-foreground", post.status === "failed" && "text-destructive")}>
                    {when(post)}
                  </span>
                </span>
                <StatusBadge post={post} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function JobRow({ job, overdue }: { job: JobRecord; overdue: boolean }) {
  return (
    <li>
      <Link href={`/jobs?job=${job.id}`} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60">
        <CalendarClock className={cn("size-4 shrink-0 text-muted-foreground", overdue && "text-destructive")} />
        <span className="grid min-w-0 flex-1">
          <span className="truncate text-sm font-medium">{job.title}</span>
          <span className="truncate text-xs text-muted-foreground">
            {job.company} · {overdue ? "Overdue, " : ""}
            {formatDay(job.followUp!)}
          </span>
        </span>
        <JobStatusBadge status={job.status} />
      </Link>
    </li>
  );
}

function StatusItem({
  icon: Icon,
  label,
  status,
  detail,
  tone,
  href,
  children,
}: {
  icon: LucideIcon;
  label: string;
  status: string;
  detail: string;
  tone: "ok" | "warn" | "bad" | "off";
  href: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="grid gap-2 px-5 py-3.5">
      <Link href={href} className="group/status flex items-start gap-3">
        <span className="relative mt-0.5">
          <Icon className="size-4 text-muted-foreground" />
          <span
            aria-hidden
            className={cn(
              "absolute -right-1 -bottom-1 size-2 rounded-full ring-2 ring-card",
              tone === "ok" && "bg-success",
              tone === "warn" && "bg-warning",
              tone === "bad" && "bg-destructive",
              tone === "off" && "bg-muted-foreground/50",
            )}
          />
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex items-center justify-between gap-2 text-sm font-medium">
            {label}
            <Badge variant={tone === "ok" ? "success" : tone === "warn" ? "warning" : tone === "bad" ? "destructive" : "muted"}>
              {tone === "bad" && <CircleAlert />}
              {status}
            </Badge>
          </span>
          {detail && <span className="truncate text-xs text-muted-foreground">{detail}</span>}
        </span>
      </Link>
      {children}
    </li>
  );
}

function Empty({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  action: { href: string; label: string };
}) {
  return (
    <div className="grid justify-items-center gap-3 border-t px-5 py-10 text-center">
      <span className="grid size-11 place-items-center rounded-xl bg-brand-soft text-brand-strong">
        <Icon className="size-5" />
      </span>
      <div className="grid gap-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
      </div>
      <Button size="sm" asChild>
        <Link href={action.href}>{action.label}</Link>
      </Button>
    </div>
  );
}
