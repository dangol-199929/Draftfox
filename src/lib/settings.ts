// Server-only: reads and writes data/settings.json with Node's fs.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SYSTEM_PROMPT } from "./prompts.ts";

type Settings = {
  systemPrompt?: string;
};

const DATA_DIR = join(process.cwd(), "data");
const SETTINGS_FILE = join(DATA_DIR, "settings.json");

async function readSettings(): Promise<Settings> {
  let text: string;
  try {
    text = await readFile(SETTINGS_FILE, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    console.warn(`Could not read ${SETTINGS_FILE}, using defaults:`, error);
    return {};
  }
  try {
    const settings: unknown = JSON.parse(text);
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
      throw new Error("not a JSON object");
    }
    return settings as Settings;
  } catch (error) {
    console.warn(`${SETTINGS_FILE} is not valid, using defaults:`, error);
    return {};
  }
}

// Write to a temp file first so a crash mid-write can't leave a half-written file.
async function writeSettings(settings: Settings): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const temp = `${SETTINGS_FILE}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`);
  await rename(temp, SETTINGS_FILE);
}

export async function getSystemPrompt(): Promise<string> {
  const { systemPrompt } = await readSettings();
  return typeof systemPrompt === "string" && systemPrompt.trim() ? systemPrompt : SYSTEM_PROMPT;
}

export async function saveSystemPrompt(text: string): Promise<void> {
  const settings = await readSettings();
  await writeSettings({ ...settings, systemPrompt: text });
}

export async function resetSystemPrompt(): Promise<void> {
  const { systemPrompt: _removed, ...rest } = await readSettings();
  await writeSettings(rest);
}
