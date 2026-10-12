"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const links: { href: string; label: string; soon?: boolean }[] = [
  { href: "/", label: "Generate" },
  { href: "/posts", label: "Posts" },
  { href: "/profile", label: "Profile" },
  { href: "/prompt", label: "Prompt" },
  { href: "/linkedin", label: "LinkedIn" },
  { href: "/reports", label: "Reports" },
  { href: "/jobs", label: "Jobs", soon: true },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static logo */}
          <img src="/icon.svg" alt="" width={24} height={24} className="size-6" />
          Draftfox
        </Link>
        <nav className="order-last flex w-full flex-wrap gap-1 sm:order-none sm:w-auto">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                (link.href === "/" ? pathname === "/" : pathname.startsWith(link.href)) && "bg-muted text-foreground",
              )}
            >
              {link.label}
              {link.soon && (
                <span className="ml-1.5 rounded-full bg-muted-foreground/15 px-1.5 py-0.5 text-[10px] font-medium uppercase">
                  Soon
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
