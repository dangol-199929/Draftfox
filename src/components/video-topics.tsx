"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Lightbulb, Loader2, Play, SkipForward } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import type { VideoJob } from "@/lib/video-jobs.ts";
import type { VideoTopic } from "@/lib/video-topics.ts";
import { cn } from "@/lib/utils";

type Series = { id: string; name: string };

const STATUS_LABEL = { idea: "Idea", queued: "Made", used: "Approved" } as const;

async function post<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}

// The backlog of topic ideas, per series. Nothing is made until you click Make video or Make next.
export function TopicIdeas({ onMade }: { onMade: (job: VideoJob) => void }) {
  const [topics, setTopics] = useState<VideoTopic[] | null>(null);
  const [series, setSeries] = useState<Series[]>([]);
  const [open, setOpen] = useState(false);
  const [showMade, setShowMade] = useState(false);
  const [busy, setBusy] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/video/topics");
      const data = (await response.json()) as { topics: VideoTopic[]; series: Series[] };
      setTopics(data.topics);
      setSeries(data.series);
    } catch {
      setTopics([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const bySeries = new Map<string, VideoTopic[]>();
    for (const topic of topics ?? []) bySeries.set(topic.series, [...(bySeries.get(topic.series) ?? []), topic]);
    return [...bySeries.entries()];
  }, [topics]);

  if (!topics?.length) return null;

  async function make(label: string, path: string, body?: object) {
    setBusy(label);
    try {
      const { job } = await post<{ job: VideoJob }>(path, body);
      toast("Added to the queue");
      onMade(job);
      await load();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy("");
    }
  }

  return (
    <Card>
      {groups.map(([seriesId, items]) => {
        const name = series.find((item) => item.id === seriesId)?.name ?? seriesId;
        const left = items.filter((topic) => topic.status === "idea").length;
        const shown = showMade ? items : items.filter((topic) => topic.status === "idea");
        const next = items.find((topic) => topic.status === "idea");
        let lastCategory: string | null = null;
        return (
          <div key={seriesId}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="size-4 text-muted-foreground" />
                Topic ideas: {name}
              </CardTitle>
              <CardDescription>
                {left} of {items.length} ideas not made yet. A video is only made when you click.
                {next && <> Next up: <span className="text-foreground">{next.title}</span>.</>}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!next || busy !== ""}
                  onClick={() => make("next", "/api/video/topics", { action: "next", series: seriesId })}
                >
                  {busy === "next" ? <Loader2 className="animate-spin" /> : <SkipForward />}
                  Make next
                </Button>
                <Button size="sm" variant="outline" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
                  {open ? "Hide list" : "Show all ideas"}
                  <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
                </Button>
                {open && (
                  <Button size="sm" variant="ghost" onClick={() => setShowMade((value) => !value)}>
                    {showMade ? "Hide made ones" : "Include made ones"}
                  </Button>
                )}
              </div>
              {open && (
                <ol className="grid max-h-[28rem] gap-1 overflow-y-auto rounded-lg border p-2">
                  {shown.map((topic) => {
                    const heading = topic.category !== lastCategory ? topic.category : null;
                    lastCategory = topic.category;
                    return (
                      <li key={topic.id} className="grid gap-1">
                        {heading && (
                          <p className="px-2 pt-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                            {heading}
                          </p>
                        )}
                        <div className="flex items-start gap-3 rounded-md px-2 py-1.5 hover:bg-muted">
                          <span className="w-7 shrink-0 pt-0.5 text-xs text-muted-foreground tabular-nums">{topic.position}.</span>
                          <div className="grid min-w-0 flex-1 gap-0.5">
                            <span className="text-sm font-medium">{topic.title}</span>
                            <span className="line-clamp-2 text-xs text-muted-foreground" title={topic.brief}>
                              {topic.brief}
                            </span>
                          </div>
                          {topic.status === "idea" ? (
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={busy !== ""}
                              onClick={() => make(`topic-${topic.id}`, `/api/video/topics/${topic.id}`)}
                            >
                              {busy === `topic-${topic.id}` ? <Loader2 className="animate-spin" /> : <Play />}
                              Make video
                            </Button>
                          ) : (
                            <Badge variant={topic.status === "used" ? "success" : "muted"}>{STATUS_LABEL[topic.status]}</Badge>
                          )}
                        </div>
                      </li>
                    );
                  })}
                  {!shown.length && <li className="p-4 text-center text-sm text-muted-foreground">Every idea has a video.</li>}
                </ol>
              )}
            </CardContent>
          </div>
        );
      })}
    </Card>
  );
}
