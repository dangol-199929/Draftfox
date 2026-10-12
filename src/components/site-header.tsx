"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
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

function SoonBadge() {
  return (
    <span className="ml-1.5 rounded-full bg-muted-foreground/15 px-1.5 py-0.5 text-[10px] font-medium uppercase">
      Soon
    </span>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static logo */}
          <img src="/icon.svg" alt="" width={24} height={24} className="size-6" />
          Draftfox
        </Link>
        <nav className="hidden flex-wrap gap-1 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                isActive(link.href) && "bg-muted text-foreground",
              )}
            >
              {link.label}
              {link.soon && <SoonBadge />}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden md:block">
          <ThemeToggle />
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="ml-auto md:hidden" aria-label="Open menu">
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-72">
            <SheetHeader className="border-b">
              <SheetTitle className="flex items-center gap-2 font-semibold tracking-tight">
                {/* eslint-disable-next-line @next/next/no-img-element -- small static logo */}
                <img src="/icon.svg" alt="" width={24} height={24} className="size-6" />
                Draftfox
              </SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-1 px-3">
              {links.map((link) => (
                <SheetClose asChild key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={isActive(link.href) ? "page" : undefined}
                    className={cn(
                      "flex items-center rounded-md px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                      isActive(link.href) && "bg-muted text-foreground",
                    )}
                  >
                    {link.label}
                    {link.soon && <SoonBadge />}
                  </Link>
                </SheetClose>
              ))}
            </nav>
            <div className="mt-auto flex items-center justify-between border-t px-4 py-3">
              <span className="text-sm text-muted-foreground">Theme</span>
              <ThemeToggle />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
