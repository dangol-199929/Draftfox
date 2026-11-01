// Imports a series of video topic ideas into the Video Studio's backlog (video_topics). Safe to run again: ideas are
// matched by position, so their text is updated and videos already made from them are kept.
//   node scripts/import-video-topics.ts data-seed/video-topics/marcus-aurelius.json
import { readFileSync } from "node:fs";
import { importVideoTopics, type TopicImport } from "../src/lib/video-topics.ts";
import { findSeries } from "../src/lib/video-series.ts";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/import-video-topics.ts <file.json>");
  process.exit(1);
}
const data = JSON.parse(readFileSync(file, "utf8")) as { series: string; topics: TopicImport[] };
if (!findSeries(data.series)) {
  console.error(`Unknown series "${data.series}"; add it to src/lib/video-series.ts first.`);
  process.exit(1);
}
const bad = data.topics.findIndex((topic) => !topic.title?.trim() || !topic.brief?.trim() || topic.title.split(/\s+/).length > 8);
if (bad >= 0) {
  console.error(`Topic ${bad + 1} needs a title of at most 8 words and a brief.`);
  process.exit(1);
}
console.log(`Imported ${importVideoTopics(data.series, data.topics)} topic ideas into "${data.series}".`);
