// Video series: a set of related topics with extra rules for the script writer. A video belongs to a series through
// its series_id (video_jobs) or its topic idea (video_topics). The topic ideas themselves are imported from
// data-seed/video-topics/*.json with scripts/import-video-topics.ts.
// noQuotes: a narration with quotation marks is sent back to the model (no invented quotes).
export type VideoSeries = { id: string; name: string; scriptRules: string; noQuotes?: boolean };

export const VIDEO_SERIES: VideoSeries[] = [
  {
    id: "marcus-aurelius",
    name: "Marcus Aurelius: Notes to Self",
    noQuotes: true,
    scriptRules: `This video is part of the series "Marcus Aurelius: Notes to Self": modern interpretations of the Meditations.
- Never quote Marcus Aurelius directly and never put words in quotation marks as if he said them. Paraphrase: "Marcus Aurelius taught...", "Marcus believed...", "In his private notes, he reminded himself...".
- Don't invent facts about his life. Keep the lesson practical for someone today.`,
  },
];

export function findSeries(id: string | null | undefined): VideoSeries | null {
  return VIDEO_SERIES.find((series) => series.id === id) ?? null;
}
