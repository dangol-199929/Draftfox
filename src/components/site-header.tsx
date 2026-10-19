"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  ChartColumn,
  House,
  Library,
  Menu,
  PenLine,
  Search,
  Settings,
  UserRound,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { OllamaStatus } from "@/lib/ollama-status.ts";
import { cn } from "@/lib/utils";

type NavLink = {
  href: string;
  label: string;
  icon: LucideIcon;
  // Decides whether this link is the current page, from the path and the query.
  match: (path: string, query: URLSearchParams) => boolean;
};

type NavGroup = { label: string; links: NavLink[] };

const GROUPS: NavGroup[] = [
  {
    label: "Create",
    links: [
      { href: "/", label: "Overview", icon: House, match: (path) => path === "/" },
      { href: "/write", label: "Studio", icon: PenLine, match: (path) => path.startsWith("/write") },
      { href: "/posts", label: "Posts", icon: Library, match: (path) => path.startsWith("/posts") },
      { href: "/calendar", label: "Calendar", icon: CalendarDays, match: (path) => path.startsWith("/calendar") },
      { href: "/autopilot", label: "Auto-posting", icon: Bot, match: (path) => path.startsWith("/autopilot") },
    ],
  },
  {
    label: "LinkedIn",
    links: [
      { href: "/profile", label: "Profile & connection", icon: UserRound, match: (path) => path.startsWith("/profile") },
      { href: "/reports", label: "Activity", icon: ChartColumn, match: (path) => path.startsWith("/reports") },
    ],
  },
  {
    label: "Career",
    links: [
      {
        href: "/jobs?tab=find",
        label: "Find jobs",
        icon: Search,
        match: (path, query) => path === "/jobs" && query.get("tab") === "find",
      },
      {
        href: "/jobs",
        label: "Applications",
        icon: BriefcaseBusiness,
        match: (path, query) => path.startsWith("/jobs") && !(path === "/jobs" && query.get("tab") === "find"),
      },
    ],
  },
  {
    label: "AI",
    links: [
      { href: "/instructions", label: "AI instructions", icon: WandSparkles, match: (path) => path.startsWith("/instructions") },
      { href: "/settings", label: "Settings", icon: Settings, match: (path) => path.startsWith("/settings") },
    ],
  },
];

const ALL_LINKS = GROUPS.flatMap((group) => group.links);
// The phone tab bar keeps the four places used most; everything else is under More.
const TAB_BAR = ["/", "/write", "/posts", "/jobs"];

// Pages that switch tabs in place (Jobs) announce it with this event after updating the address.
export const URL_CHANGED = "draftfox:url";

function useActive() {
  const pathname = usePathname();
  // Read in the browser only: useSearchParams would need a Suspense boundary around the whole navigation.
  const [search, setSearch] = useState("");
  useEffect(() => {
    const update = () => setSearch(window.location.search);
    update();
    window.addEventListener("popstate", update);
    window.addEventListener(URL_CHANGED, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(URL_CHANGED, update);
    };
  }, [pathname]);
  return (link: NavLink) => link.match(pathname, new URLSearchParams(search));
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("group/logo flex items-center gap-2.5 rounded-md", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- small static logo */}
      <img src="/icon.svg" alt="" width={28} height={28} className="size-7 transition-transform group-hover/logo:-rotate-6" />
      <span className="grid leading-none">
        <span className="text-[0.95rem] font-semibold tracking-tight">Draftfox</span>
        <span className="mt-0.5 text-[0.68rem] font-medium tracking-wide text-muted-foreground">Local AI workspace</span>
      </span>
    </Link>
  );
}

// Whether the local model and LinkedIn are ready, checked once per page load.
function useWorkspaceStatus() {
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [linkedIn, setLinkedIn] = useState<{ connected: boolean; expired: boolean; canPost: boolean } | null>(null);
  useEffect(() => {
    fetch("/api/ollama/status")
      .then((response) => response.json() as Promise<OllamaStatus>)
      .then(setOllama)
      .catch(() => {});
    fetch("/api/linkedin/status")
      .then((response) => response.json() as Promise<{ connected: boolean; expired: boolean; canPost: boolean }>)
      .then(setLinkedIn)
      .catch(() => {});
  }, []);
  return { ollama, linkedIn };
}

type Tone = "ok" | "warn" | "off" | "pending";

function StatusRow({ href, tone, label, detail }: { href: string; tone: Tone; label: string; detail: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-sidebar-accent"
    >
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          tone === "ok" && "bg-success shadow-[0_0_0_3px_color-mix(in_oklch,var(--success),transparent_80%)]",
          tone === "warn" && "bg-warning",
          tone === "off" && "bg-muted-foreground/50",
          tone === "pending" && "skeleton",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-sidebar-foreground">{label}</span>
        <span className="block truncate text-muted-foreground">{detail}</span>
      </span>
    </Link>
  );
}

function WorkspaceStatus() {
  const { ollama, linkedIn } = useWorkspaceStatus();
  const ollamaTone: Tone = !ollama ? "pending" : !ollama.reachable ? "off" : ollama.installed ? "ok" : "warn";
  const ollamaDetail = !ollama
    ? "Checking…"
    : !ollama.reachable
      ? "Not running"
      : ollama.installed
        ? ollama.model
        : `${ollama.model} not downloaded`;
  const signedIn = linkedIn?.connected && !linkedIn.expired;
  const linkedInTone: Tone = !linkedIn ? "pending" : signedIn ? (linkedIn.canPost ? "ok" : "warn") : linkedIn.expired ? "warn" : "off";
  const linkedInDetail = !linkedIn
    ? "Checking…"
    : signedIn
      ? linkedIn.canPost
        ? "Connected, posting on"
        : "Connected, posting off"
      : linkedIn.expired
        ? "Sign-in expired"
        : "Not connected";
  return (
    <div className="grid gap-0.5" aria-label="Workspace status">
      <StatusRow href="/settings#local-ai" tone={ollamaTone} label="Ollama" detail={ollamaDetail} />
      <StatusRow href="/profile" tone={linkedInTone} label="LinkedIn" detail={linkedInDetail} />
    </div>
  );
}

function NavItem({ link, active, onNavigate }: { link: NavLink; active: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href={link.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group/nav relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        active &&
          "bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-xs ring-1 ring-sidebar-border dark:ring-0",
      )}
    >
      {active && <span aria-hidden className="absolute inset-y-1.5 -left-3 w-[3px] rounded-r-full bg-brand" />}
      <link.icon
        className={cn(
          "size-4 shrink-0 text-muted-foreground transition-colors group-hover/nav:text-sidebar-accent-foreground",
          active && "text-brand group-hover/nav:text-brand",
        )}
      />
      {link.label}
    </Link>
  );
}

function NavGroups({ onNavigate }: { onNavigate?: () => void }) {
  const isActive = useActive();
  return (
    <nav aria-label="Main" className="grid gap-5">
      {GROUPS.map((group) => (
        <div key={group.label} className="grid gap-0.5">
          <p className="px-2.5 pb-1 text-[0.68rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {group.label}
          </p>
          {group.links.map((link) => (
            <NavItem key={link.href} link={link} active={isActive(link)} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
    </nav>
  );
}

// Left sidebar on desktop; a slim top bar, a bottom tab bar and a More drawer on phones and tablets.
export function SiteHeader() {
  const isActive = useActive();
  const [menuOpen, setMenuOpen] = useState(false);
  const tabs = TAB_BAR.map((href) => ALL_LINKS.find((link) => link.href === href)!);
  const moreActive = !tabs.some(isActive);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="px-5 pt-5 pb-6">
          <Logo />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <NavGroups />
        </div>
        <div className="grid gap-2 border-t border-sidebar-border px-3 py-3">
          <WorkspaceStatus />
          <div className="flex items-center justify-between rounded-md px-2 py-0.5">
            <span className="text-xs text-muted-foreground">Theme</span>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background/85 px-4 py-2.5 backdrop-blur-md lg:hidden">
        <Logo />
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
        </div>
      </header>

      <nav
        aria-label="Quick"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        {tabs.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isActive(link) ? "page" : undefined}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-1 text-[0.7rem] text-muted-foreground transition-colors",
              isActive(link) && "font-medium text-brand-strong",
            )}
          >
            <link.icon className="size-5" />
            {link.label === "Applications" ? "Jobs" : link.label}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          className={cn(
            "flex min-h-14 flex-col items-center justify-center gap-1 text-[0.7rem] text-muted-foreground transition-colors",
            moreActive && "font-medium text-brand-strong",
          )}
        >
          <Menu className="size-5" />
          More
        </button>
      </nav>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 gap-0 bg-sidebar p-0">
          <SheetHeader className="px-5 pt-5 pb-4">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <SheetDescription className="sr-only">Every page in Draftfox</SheetDescription>
            <Logo />
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            <NavGroups onNavigate={() => setMenuOpen(false)} />
          </div>
          <div className="border-t border-sidebar-border px-3 py-3">
            <WorkspaceStatus />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
