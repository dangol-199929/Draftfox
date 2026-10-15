"use client";

import Link from "next/link";
import { Maximize2 } from "lucide-react";
import { JobWorkspace } from "@/components/job-workspace";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

// A saved job's full page (fit, cover letter, CV, answers, status) in a drawer on the right, so you can work on it
// without leaving the list you opened it from. id null keeps it closed.
export function JobDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  return (
    <Sheet open={id !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-[min(64rem,94vw)]"
      >
        <SheetHeader className="sticky top-0 z-10 flex-row items-center justify-between gap-2 border-b bg-popover/95 pr-12 backdrop-blur">
          <div className="grid gap-0.5">
            <SheetTitle>Saved job</SheetTitle>
            <SheetDescription>Changes save as you go. You always apply yourself.</SheetDescription>
          </div>
          {id && (
            <Button asChild size="sm" variant="ghost">
              <Link href={`/jobs/${id}`}>
                <Maximize2 />
                Full page
              </Link>
            </Button>
          )}
        </SheetHeader>
        <div className="p-4">{id && <JobWorkspace key={id} id={id} onDeleted={onClose} />}</div>
      </SheetContent>
    </Sheet>
  );
}
