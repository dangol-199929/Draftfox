"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "success" | "error" | "info";
type Toast = { id: number; message: string; tone: Tone };

const listeners = new Set<(toast: Toast) => void>();
let nextId = 1;

// Shows a short confirmation in the corner. Errors that need a fix stay inline, next to what failed.
export function toast(message: string, tone: Tone = "success") {
  const item = { id: nextId++, message, tone };
  listeners.forEach((listener) => listener(item));
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const add = (item: Toast) => {
      setToasts((current) => [...current.slice(-2), item]);
      setTimeout(() => setToasts((current) => current.filter((t) => t.id !== item.id)), item.tone === "error" ? 6000 : 3500);
    };
    listeners.add(add);
    return () => {
      listeners.delete(add);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      role="status"
      className="pointer-events-none fixed inset-x-4 bottom-20 z-[60] grid justify-items-center gap-2 sm:inset-x-auto sm:top-5 sm:right-5 sm:bottom-auto sm:justify-items-end"
    >
      {toasts.map((item) => {
        const Icon = item.tone === "success" ? CheckCircle2 : item.tone === "error" ? CircleAlert : Info;
        return (
          <div
            key={item.id}
            className="pointer-events-auto flex w-full max-w-sm animate-in items-center gap-2.5 rounded-lg border bg-popover px-3.5 py-2.5 text-sm text-popover-foreground shadow-pop duration-200 fade-in-0 slide-in-from-top-2"
          >
            <Icon
              className={cn(
                "size-4 shrink-0",
                item.tone === "success" && "text-success",
                item.tone === "error" && "text-destructive",
                item.tone === "info" && "text-info",
              )}
            />
            <span className="flex-1">{item.message}</span>
            <button
              type="button"
              aria-label="Dismiss"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => setToasts((current) => current.filter((t) => t.id !== item.id))}
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
