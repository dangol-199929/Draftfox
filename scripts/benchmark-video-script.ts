// Compares Ollama models for writing Video Studio scripts: valid replies, tries, seconds, narration length,
// video memory and RAM. Needs Draftfox running (it takes the GPU lease through the worker API, so it waits for
// anything the app is doing). Writes a Markdown report.
//   node --env-file=.env scripts/benchmark-video-script.ts <report.md> [model ...]
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { OLLAMA_URL } from "../src/lib/ollama.ts";
import { NARRATION_WORDS, generateVideoScript, wordCount } from "../src/lib/video-script.ts";

const TOPICS = [
  "Why sleep makes you a better programmer",
  "How black holes bend light",
  "Three tips for a tidy desk setup",
  "What CSS grid is, explained simply",
  "The history of the floppy disk",
  "Why cats knock things off tables",
  "How to make pour-over coffee",
  "What MCP (Model Context Protocol) is",
  "Why retro video games still feel fun",
  "How to remember people's names",
];

const [report = "script-models.md", ...requested] = process.argv.slice(2);
const MODELS = requested.length ? requested : ["qwen3:4b", "gemma3:4b", "qwen3.5:9b", "gemma4:12b"];
const DRAFTFOX = process.env.DRAFTFOX_URL ?? "http://127.0.0.1:3000";
const TOKEN = process.env.WORKER_TOKEN ?? "";

async function gpu(action: string) {
  const response = await fetch(`${DRAFTFOX}/api/worker/gpu`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ workerId: "benchmark", action, purpose: "Script model benchmark", waitSeconds: 20, ttlSeconds: 1800 }),
  });
  return (await response.json()) as { granted?: boolean };
}

async function takeGpu() {
  while (!(await gpu("acquire")).granted) console.log("  waiting for the graphics card...");
}

function vramUsedMiB(): number {
  const out = execFileSync("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"], { encoding: "utf8" });
  return Number(out.trim().split(/\r?\n/)[0]);
}

async function unloadAll() {
  const running = (await (await fetch(`${OLLAMA_URL}/api/ps`)).json()) as { models?: { name: string }[] };
  for (const model of running.models ?? []) {
    await fetch(`${OLLAMA_URL}/api/generate`, { method: "POST", body: JSON.stringify({ model: model.name, keep_alive: 0 }) });
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
}

async function loaded(model: string) {
  const running = (await (await fetch(`${OLLAMA_URL}/api/ps`)).json()) as { models?: { name: string; size: number; size_vram: number }[] };
  return running.models?.find((entry) => entry.name === model);
}

type Run = { topic: string; ok: boolean; attempts: number; seconds: number; words: number; error?: string; narration?: string };
type ModelResult = { model: string; runs: Run[]; peakVramMiB: number; vramMiB: number; ramMiB: number; loadSeconds: number };

async function benchmark(model: string): Promise<ModelResult> {
  console.log(`\n== ${model}`);
  await unloadAll();
  const baseline = vramUsedMiB();
  let peak = baseline;
  const sampler = setInterval(() => {
    try {
      peak = Math.max(peak, vramUsedMiB());
    } catch {
      // nvidia-smi busy; skip this sample.
    }
  }, 500);
  // Load the model with a tiny request first, so the first topic's time isn't mostly loading.
  const loadStart = Date.now();
  await fetch(`${OLLAMA_URL}/api/generate`, { method: "POST", body: JSON.stringify({ model, prompt: "Hi", stream: false, options: { num_predict: 1, num_ctx: 8192 } }) });
  const loadSeconds = (Date.now() - loadStart) / 1000;
  const info = await loaded(model);
  const runs: Run[] = [];
  for (const topic of TOPICS) {
    const started = Date.now();
    try {
      const result = await generateVideoScript(topic, { model, skipGpuLease: true });
      runs.push({ topic, ok: true, attempts: result.attempts, seconds: result.seconds, words: wordCount(result.script.narration), narration: result.script.narration });
      console.log(`  ok   ${result.seconds.toFixed(1)} s, ${result.attempts} tries: ${topic}`);
    } catch (error) {
      const message = (error as Error).message;
      runs.push({ topic, ok: false, attempts: 3, seconds: (Date.now() - started) / 1000, words: 0, error: message });
      console.log(`  FAIL ${topic}: ${message.slice(0, 160)}`);
    }
  }
  clearInterval(sampler);
  return {
    model,
    runs,
    peakVramMiB: peak - baseline,
    vramMiB: Math.round((info?.size_vram ?? 0) / 2 ** 20),
    ramMiB: Math.round(((info?.size ?? 0) - (info?.size_vram ?? 0)) / 2 ** 20),
    loadSeconds,
  };
}

function summary(result: ModelResult) {
  const ok = result.runs.filter((run) => run.ok);
  const firstTry = ok.filter((run) => run.attempts === 1).length;
  const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
  return {
    ok: ok.length,
    firstTry,
    seconds: average(ok.map((run) => run.seconds)),
    words: average(ok.map((run) => run.words)),
  };
}

await takeGpu();
const results: ModelResult[] = [];
try {
  for (const model of MODELS) results.push(await benchmark(model));
} finally {
  await unloadAll().catch(() => {});
  await gpu("release");
}

const lines = [
  "# Video script models",
  "",
  `Run ${new Date().toISOString()} on this PC. ${TOPICS.length} fixed topics per model; a script counts as valid when it passes`,
  `every check (narration ${NARRATION_WORDS.min}-${NARRATION_WORDS.max} words, 2-3 scenes, captions, hashtags, mood) within 3 tries.`,
  "Seconds are per finished script, including retries, with the model already loaded. VRAM and RAM are what Ollama",
  "reports for the loaded model (RAM is the part that didn't fit on the graphics card); peak is the rise in nvidia-smi's",
  "used memory during the run.",
  "",
  "| Model | Valid | First try | Avg seconds | Avg words | Load s | VRAM MiB | RAM MiB | Peak VRAM MiB |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...results.map((result) => {
    const s = summary(result);
    return `| ${result.model} | ${s.ok}/${result.runs.length} | ${s.firstTry} | ${s.seconds.toFixed(1)} | ${s.words.toFixed(1)} | ${result.loadSeconds.toFixed(1)} | ${result.vramMiB} | ${result.ramMiB} | ${result.peakVramMiB} |`;
  }),
  "",
  "## Every run",
  "",
  ...results.flatMap((result) => [
    `### ${result.model}`,
    "",
    "| Topic | Valid | Tries | Seconds | Words | Narration or error |",
    "| --- | --- | --- | --- | --- | --- |",
    ...result.runs.map(
      (run) =>
        `| ${run.topic} | ${run.ok ? "yes" : "no"} | ${run.attempts} | ${run.seconds.toFixed(1)} | ${run.words} | ${(run.narration ?? run.error ?? "").replace(/\|/g, "/").slice(0, 300)} |`,
    ),
    "",
  ]),
];
mkdirSync(dirname(report), { recursive: true });
writeFileSync(report, `${lines.join("\n")}\n`);
writeFileSync(report.replace(/\.md$/, ".json"), JSON.stringify(results, null, 2));
console.log(`\nWrote ${report}`);
