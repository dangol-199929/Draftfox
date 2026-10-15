"use client";

import { DetailDrawer } from "@/components/job-split";
import { JobWorkspace } from "@/components/job-workspace";
import type { JobRecord } from "@/lib/db.ts";

// A saved job's full page (fit, cover letter, CV, answers, status) in a drawer on the right, so you can work on it
// without leaving the list you opened it from. id null keeps it closed.
export function JobDrawer({ id, onClose, onChange }: { id: string | null; onClose: () => void; onChange?: (job: JobRecord) => void }) {
  return (
    <DetailDrawer open={id !== null} onClose={onClose} title="Saved job" fullPage={id ? `/jobs/${id}` : undefined}>
      {id && <JobWorkspace key={id} id={id} onDeleted={onClose} onChange={onChange} />}
    </DetailDrawer>
  );
}
