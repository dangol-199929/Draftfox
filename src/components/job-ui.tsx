"use client";

// Small pieces shared by the cards on a job's page.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, CircleAlert, Copy, Download, Loader2, Sparkles } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export type WriteKind = "fit" | "letter" | "answers" | "cv" | "interview" | "email";

const SAVE_DELAY = 600;

// Saves `value` with `save` shortly after it stops changing. `saved` is the value on the server; when it changes
// (a new draft came in), nothing is sent.
export function useAutosave<T>(value: T, saved: T, save: (value: T) => Promise<unknown>) {
  const json = JSON.stringify(value);
  const savedJson = JSON.stringify(saved);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    if (json === savedJson) return;
    const timer = setTimeout(() => void saveRef.current(JSON.parse(json) as T), SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [json, savedJson]);
}

export function DownloadButton({ href, label = "Download .docx" }: { href: string; label?: string }) {
  return (
    <Button asChild size="sm" variant="outline">
      <a href={href} download>
        <Download />
        {label}
      </a>
    </Button>
  );
}

export function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

export function Gaps({ gaps }: { gaps: string[] }) {
  return (
    <ul className="grid gap-1.5">
      {gaps.map((gap) => (
        <li key={gap} className="flex gap-2 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          {gap}
        </li>
      ))}
    </ul>
  );
}

// Details the model wrote that the profile doesn't back up.
export function ToCheck({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <p className="flex gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-foreground">
      <CircleAlert className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
      <span>
        <span className="font-medium">Check before sending:</span> not found in your profile:{" "}
        <strong>{items.join(", ")}</strong>
      </span>
    </p>
  );
}

// Marks text the local model wrote, so it's clear what still needs your review.
export function AiDraftNote({ what = "draft" }: { what?: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1 rounded-md bg-brand-soft px-1.5 py-0.5 font-medium text-brand-strong">
        <Sparkles className="size-3" aria-hidden />
        AI {what}
      </span>
      Written from your profile only. Read it and make it yours before you use it.
    </p>
  );
}

export function WriteButton({
  kind,
  done,
  writing,
  disabled,
  label,
  confirm,
  onClick,
}: {
  kind: WriteKind;
  done: boolean;
  writing: boolean;
  disabled: boolean;
  label: string;
  confirm?: string;
  onClick: () => void;
}) {
  const button = (
    <Button variant={done ? "outline" : "default"} className="justify-self-start" disabled={writing || disabled} onClick={confirm ? undefined : onClick}>
      {writing ? <Loader2 className="animate-spin" /> : <Sparkles />}
      {writing ? (kind === "fit" ? "Checking…" : "Writing…") : label}
    </Button>
  );
  if (!confirm || writing || disabled) return button;
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{button}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{label}?</AlertDialogTitle>
          <AlertDialogDescription>{confirm}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onClick}>{label}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function WriteError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertDescription>
        <p>{message}</p>
        {message.includes("Profile page") && (
          <Link href="/profile" className="underline underline-offset-4">
            Go to Profile
          </Link>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function CopyButton({ text, small = false }: { text: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (e.g. not a secure context); the text can still be selected by hand.
    }
  }
  return small ? (
    <Button size="icon-xs" variant="ghost" aria-label="Copy" onClick={() => void copy()}>
      {copied ? <Check /> : <Copy />}
    </Button>
  ) : (
    <Button size="sm" variant="outline" onClick={() => void copy()}>
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export function SaveState({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  if (state === "saving") return <span className="text-xs text-muted-foreground">Saving…</span>;
  if (state === "saved") return <span className="text-xs text-muted-foreground">Saved</span>;
  if (state === "error") return <span className="text-xs text-destructive">Not saved</span>;
  return null;
}
