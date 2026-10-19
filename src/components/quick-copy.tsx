"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ClipboardCopy, Copy, X } from "lucide-react";
import { QUICK_COPY_FIELDS } from "@/components/profile-editor";
import { Button } from "@/components/ui/button";
import type { Profile } from "@/lib/profile.ts";
import { cn } from "@/lib/utils";

// A button at the bottom right of the Jobs pages that opens your quick-copy details (name, email, phone, notice
// period…), each copied with one click, for filling in application forms.
export function QuickCopy() {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Loaded when opened, so details changed on the Profile page show up next time.
  useEffect(() => {
    if (!open) return;
    fetch("/api/profile")
      .then((response) => response.json() as Promise<{ profile: Profile }>)
      .then((data) => setProfile(data.profile))
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  async function copy(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500);
    } catch {
      // Clipboard blocked; the text can still be selected by hand.
    }
  }

  const filled = profile ? QUICK_COPY_FIELDS.filter((field) => String(profile[field.key] ?? "").trim()) : [];
  const missing = profile ? QUICK_COPY_FIELDS.length - filled.length : 0;

  return (
    <div className="fixed right-4 bottom-20 z-40 grid justify-items-end gap-2 md:right-6 md:bottom-6">
      {open && (
        <div
          role="dialog"
          aria-label="Quick-copy details"
          className="grid w-[min(20rem,calc(100vw-2rem))] gap-1 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 px-1 pb-1">
            <p className="text-sm font-medium">Quick-copy details</p>
            <Button size="icon-xs" variant="ghost" aria-label="Close" onClick={() => setOpen(false)}>
              <X />
            </Button>
          </div>
          {!profile ? (
            <div className="grid gap-2 p-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-8 skeleton rounded" />
              ))}
            </div>
          ) : filled.length === 0 ? (
            <p className="px-1 pb-1 text-sm text-muted-foreground">
              Add your phone, notice period, salary expectation and more on your{" "}
              <Link href="/profile#quick-copy" className="font-medium text-foreground underline underline-offset-4" onClick={() => setOpen(false)}>
                Profile
              </Link>{" "}
              to copy them into application forms with one click.
            </p>
          ) : (
            <>
              <ul className="grid max-h-[60dvh] gap-0.5 overflow-y-auto">
                {filled.map((field) => {
                  const value = String(profile[field.key]).trim();
                  return (
                    <li key={field.key}>
                      <button
                        type="button"
                        onClick={() => void copy(field.key, value)}
                        className="group grid w-full grid-cols-[1fr_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                        title={`Copy ${field.label.toLowerCase()}`}
                      >
                        <span className="grid min-w-0">
                          <span className="text-xs text-muted-foreground">{field.label}</span>
                          <span className="truncate text-sm">{value}</span>
                        </span>
                        <span className={cn("text-muted-foreground group-hover:text-foreground", copied === field.key && "text-brand")}>
                          {copied === field.key ? <Check className="size-4" /> : <Copy className="size-4" />}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {missing > 0 && (
                <Link
                  href="/profile#quick-copy"
                  onClick={() => setOpen(false)}
                  className="px-2 pt-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  {missing} more to fill in on your Profile
                </Link>
              )}
            </>
          )}
        </div>
      )}
      <Button
        className="rounded-full shadow-lg"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ClipboardCopy />
        Quick copy
      </Button>
    </div>
  );
}
