"use client";

import { useState } from "react";
import type { Bucket } from "@/lib/reports.ts";

// Drafts generated and posts published per day (or week), as grouped bars with a hover tooltip.
export function ActivityChart({ buckets }: { buckets: Bucket[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...buckets.map((bucket) => Math.max(bucket.drafts, bucket.published)));
  const top = niceMax(max);
  const ticks = top <= 4 ? Array.from({ length: top + 1 }, (_, i) => i) : [0, top / 2, top];
  const labelEvery = Math.ceil(buckets.length / 6);
  const hovered = active === null ? null : buckets[active];

  return (
    <figure className="grid gap-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-chart-2" aria-hidden />
          Drafts generated
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-brand" aria-hidden />
          Posted to LinkedIn
        </span>
        <span className="ml-auto min-h-4 tabular-nums text-foreground" aria-live="polite">
          {hovered && (
            <>
              <span className="text-muted-foreground">{hovered.label}: </span>
              {plural(hovered.drafts, "draft")}, {plural(hovered.published, "post")}
            </>
          )}
        </span>
      </div>

      <div className="relative mt-2 grid grid-cols-[auto_1fr] gap-x-2">
        <div className="relative h-44 w-6 text-right text-[11px] text-muted-foreground tabular-nums" aria-hidden>
          {ticks.map((tick) => (
            <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ bottom: `${(tick / top) * 100}%` }}>
              {tick}
            </span>
          ))}
        </div>
        <div className="relative h-44" onMouseLeave={() => setActive(null)}>
          {ticks.map((tick) => (
            <div
              key={tick}
              className="absolute inset-x-0 border-t border-border"
              style={{ bottom: `${(tick / top) * 100}%` }}
              aria-hidden
            />
          ))}
          <div className="absolute inset-0 flex items-end">
            {buckets.map((bucket, index) => (
              <div
                key={bucket.start}
                className={`flex h-full flex-1 items-end justify-center gap-0.5 px-[1px] ${active === index ? "bg-muted" : ""}`}
                onMouseEnter={() => setActive(index)}
                role="img"
                aria-label={`${bucket.label}: ${plural(bucket.drafts, "draft")}, ${plural(bucket.published, "post")}`}
              >
                <Bar value={bucket.drafts} top={top} className="bg-chart-2" />
                <Bar value={bucket.published} top={top} className="bg-brand" />
              </div>
            ))}
          </div>
        </div>
        <div />
        <div className="flex pt-1.5 text-[11px] text-muted-foreground" aria-hidden>
          {buckets.map((bucket, index) => (
            <span key={bucket.start} className="relative flex-1">
              {index % labelEvery === 0 && (
                <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap">
                  {bucket.label.replace("Week of ", "")}
                </span>
              )}
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}

function Bar({ value, top, className }: { value: number; top: number; className: string }) {
  if (value === 0) return <span className="w-full max-w-3" />;
  return (
    <span
      className={`w-full max-w-3 min-h-0.5 rounded-t-[3px] ${className}`}
      style={{ height: `${(value / top) * 100}%` }}
    />
  );
}

// The smallest "round" number at or above max, so gridlines land on whole values.
function niceMax(max: number): number {
  if (max <= 4) return max;
  const step = 10 ** Math.floor(Math.log10(max));
  for (const factor of [1, 2, 2.5, 5, 10]) {
    const value = factor * step;
    if (value >= max && Number.isInteger(value / 2)) return value;
  }
  return 10 * step;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
