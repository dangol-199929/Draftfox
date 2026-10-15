"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BriefcaseBusiness, ChartColumn, PenLine, Settings, UserRound, type LucideIcon } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

type NavLink = { href: string; label: string; icon: LucideIcon };

const links: NavLink[] = [
  { href: "/", label: "Write", icon: PenLine },
  { href: "/jobs", label: "Jobs", icon: BriefcaseBusiness },
  { href: "/profile", label: "Profile", icon: UserRound },
  { href: "/reports", label: "Reports", icon: ChartColumn },
];

const settings: NavLink = { href: "/settings", label: "Settings", icon: Settings };

// Old addresses that now live inside one of the sections, so the right item stays highlighted.
const ALIASES: Record<string, string> = { "/posts": "/", "/linkedin": "/profile", "/prompt": "/settings" };

function useIsActive() {
  const pathname = usePathname();
  const alias = Object.keys(ALIASES).find((prefix) => pathname.startsWith(prefix));
  const path = alias ? ALIASES[alias] : pathname;
  return (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
      {/* eslint-disable-next-line @next/next/no-img-element -- small static logo */}
      <img src="/icon.svg" alt="" width={24} height={24} className="size-6" />
      Draftfox
    </Link>
  );
}

// Left sidebar on desktop; a slim top bar and a bottom tab bar on phones.
export function SiteHeader() {
  const isActive = useIsActive();

  const sidebarLink = (link: NavLink) => (
    <Link
      key={link.href}
      href={link.href}
      aria-current={isActive(link.href) ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
        isActive(link.href) && "bg-sidebar-accent font-medium text-foreground [&_svg]:text-brand",
      )}
    >
      <link.icon className="size-4" />
      {link.label}
    </Link>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r bg-sidebar md:flex">
        <div className="px-5 py-5">
          <Logo />
        </div>
        <nav aria-label="Main" className="grid gap-1 px-3">
          {links.map(sidebarLink)}
        </nav>
        <div className="mt-auto grid gap-1 border-t px-3 py-3">
          {sidebarLink(settings)}
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-sm text-muted-foreground">Theme</span>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background/90 px-4 py-2.5 backdrop-blur md:hidden">
        <Logo />
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {[...links, settings].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isActive(link.href) ? "page" : undefined}
            className={cn(
              "flex flex-col items-center gap-1 py-2 text-[0.7rem] text-muted-foreground transition-colors",
              isActive(link.href) && "font-medium text-brand",
            )}
          >
            <link.icon className="size-5" />
            {link.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
