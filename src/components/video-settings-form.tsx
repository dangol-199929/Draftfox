"use client";

import { useRef, useState } from "react";
import { Loader2, Music, Pause, Play, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import {
  CAPTION_POSITIONS,
  CAPTION_SIZES,
  MUSIC_MOODS,
  RETRO_LEVELS,
  VIDEO_SECONDS,
  VIDEO_VOICES,
  type VideoSettings,
} from "@/lib/video-settings.ts";
import { cn } from "@/lib/utils";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50";

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function Field({ id, label, hint, children, className }: { id?: string; label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Toggle({ id, label, hint, checked, onChange, disabled }: { id: string; label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
      <div className="grid gap-0.5">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-3 rounded-lg border p-3">
      <legend className="px-1 text-xs font-medium text-muted-foreground">{title}</legend>
      {children}
    </fieldset>
  );
}

// Plays a voice's sample (DraftfoxHub/voice-samples) at the nearest speed it was recorded at.
function VoicePreview({ voice, speed }: { voice: string; speed: number }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const hasSample = VIDEO_VOICES.find((item) => item.id === voice)?.sample ?? false;

  function toggle() {
    if (playing) {
      audio.current?.pause();
      setPlaying(false);
      return;
    }
    const player = new Audio(`/api/video/voices/${voice}?speed=${speed}`);
    audio.current = player;
    player.onended = () => setPlaying(false);
    player.onerror = () => {
      setPlaying(false);
      toast("There's no sample of that voice yet.", "error");
    };
    void player.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  return (
    <Button type="button" size="icon" variant="outline" onClick={toggle} disabled={!hasSample} aria-label={playing ? "Stop the sample" : "Play a sample"} title={hasSample ? "Play a sample" : "No sample of this voice yet"}>
      {playing ? <Pause /> : <Play />}
    </Button>
  );
}

// Adds a track to a mood's music folder, sent in chunks; lists and removes tracks.
function MusicTracks({ music, onChange, disabled }: { music: Record<string, string[]>; onChange: (music: Record<string, string[]>) => void; disabled?: boolean }) {
  const [mood, setMood] = useState<string>("calm");
  const [sending, setSending] = useState<number | null>(null);
  const tracks = music[mood] ?? [];

  async function add(file: File) {
    if (file.size > 100 * 1024 * 1024) return toast("Use a track of up to 100 MB.", "error");
    setSending(0);
    try {
      const chunk = 8 * 1024 * 1024;
      let offset = 0;
      do {
        const query = new URLSearchParams({ mood, name: file.name, offset: String(offset) });
        const response = await fetch(`/api/video/music?${query}`, { method: "PUT", body: file.slice(offset, offset + chunk) });
        const body = (await response.json().catch(() => ({}))) as { received?: number; error?: string };
        if (!response.ok || typeof body.received !== "number") throw new Error(body.error ?? "The track didn't upload.");
        offset = body.received;
        setSending(Math.round((offset / file.size) * 100));
      } while (offset < file.size);
      const response = await fetch("/api/video/music", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mood, name: file.name }) });
      const body = (await response.json().catch(() => ({}))) as { music?: Record<string, string[]>; error?: string };
      if (!response.ok || !body.music) throw new Error(body.error ?? "The track didn't upload.");
      onChange(body.music);
      toast(`Added to ${mood}`);
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setSending(null);
    }
  }

  async function remove(name: string) {
    if (!window.confirm(`Remove "${name}" from the ${mood} music?`)) return;
    const response = await fetch(`/api/video/music?${new URLSearchParams({ mood, name })}`, { method: "DELETE" });
    const body = (await response.json().catch(() => ({}))) as { music?: Record<string, string[]>; error?: string };
    if (body.music) onChange(body.music);
    else toast(body.error ?? "Couldn't remove it.", "error");
  }

  return (
    <div className="grid gap-2 rounded-md bg-muted/40 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Music className="size-4 text-muted-foreground" />
        <select className={cn(selectClass, "h-8 w-auto")} value={mood} onChange={(event) => setMood(event.target.value)} aria-label="Music folder">
          {MUSIC_MOODS.map((item) => (
            <option key={item} value={item}>
              {capitalise(item)} ({music[item]?.length ?? 0})
            </option>
          ))}
        </select>
        <Button type="button" size="sm" variant="outline" disabled={disabled || sending !== null} asChild>
          <label className="cursor-pointer">
            {sending !== null ? <Loader2 className="animate-spin" /> : <Upload />}
            {sending !== null ? `${sending}%` : "Add a track"}
            <input
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void add(file);
              }}
            />
          </label>
        </Button>
      </div>
      {tracks.length ? (
        <ul className="grid gap-1 text-xs">
          {tracks.map((track) => (
            <li key={track} className="flex items-center justify-between gap-2">
              <span className="truncate">{track}</span>
              <Button type="button" size="icon" variant="ghost" className="size-7" onClick={() => remove(track)} aria-label={`Remove ${track}`}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No {mood} tracks yet: videos with this mood have narration only.</p>
      )}
    </div>
  );
}

// Every setting a video can have. `forJob` hides the ones that only matter before the script is written.
export function VideoSettingsForm({
  value,
  onChange,
  disabled,
  music,
  onMusicChange,
  idPrefix = "vs",
}: {
  value: VideoSettings;
  onChange: (value: VideoSettings) => void;
  disabled?: boolean;
  music?: Record<string, string[]>;
  onMusicChange?: (music: Record<string, string[]>) => void;
  idPrefix?: string;
}) {
  const set = <K extends keyof VideoSettings>(key: K, next: VideoSettings[K]) => onChange({ ...value, [key]: next });
  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Section title="Voice">
        <Field id={id("voice")} label="Voice">
          <div className="flex gap-2">
            <select id={id("voice")} className={selectClass} value={value.voice} onChange={(event) => set("voice", event.target.value)} disabled={disabled}>
              {VIDEO_VOICES.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.label}
                </option>
              ))}
            </select>
            <VoicePreview voice={value.voice} speed={value.voiceSpeed} />
          </div>
        </Field>
        <Field id={id("speed")} label={`Speed: ${value.voiceSpeed.toFixed(2)}x`} hint="Faster fits more words in the same length.">
          <input
            id={id("speed")}
            type="range"
            min={0.8}
            max={1.1}
            step={0.05}
            value={value.voiceSpeed}
            onChange={(event) => set("voiceSpeed", Number(event.target.value))}
            disabled={disabled}
            className="accent-primary"
          />
        </Field>
      </Section>

      <Section title="Script">
        <div className="grid grid-cols-2 gap-3">
          <Field id={id("seconds")} label="Length">
            <select id={id("seconds")} className={selectClass} value={value.seconds} onChange={(event) => set("seconds", Number(event.target.value))} disabled={disabled}>
              {VIDEO_SECONDS.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds} seconds
                </option>
              ))}
            </select>
          </Field>
          <Field id={id("scenes")} label="Scenes">
            <select
              id={id("scenes")}
              className={selectClass}
              value={value.scenes ?? ""}
              onChange={(event) => set("scenes", event.target.value ? Number(event.target.value) : null)}
              disabled={disabled}
            >
              <option value="">Automatic</option>
              {Array.from({ length: 11 }, (_, i) => i + 3).map((count) => (
                <option key={count} value={count}>
                  {count} scenes
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field id={id("tone")} label="Script tone" hint='For example "warm and encouraging" or "calm, like a mentor".'>
          <Input id={id("tone")} maxLength={300} value={value.scriptTone} onChange={(event) => set("scriptTone", event.target.value)} disabled={disabled} />
        </Field>
        <Toggle
          id={id("pause")}
          label="Edit the script first"
          hint="Stops after the script so you can change the narration and prompts, then click Continue."
          checked={value.pauseAfterScript}
          onChange={(next) => set("pauseAfterScript", next)}
          disabled={disabled}
        />
      </Section>

      <Section title="Pictures and motion">
        <Field id={id("style")} label="Image style" hint="Added to every scene's image prompt.">
          <Textarea id={id("style")} rows={2} maxLength={300} value={value.imageStyle} onChange={(event) => set("imageStyle", event.target.value)} disabled={disabled} placeholder="warm sunset colours, misty hills" />
        </Field>
        <Toggle id={id("motion")} label="Motion" hint="Animate each scene with LTX-Video; off keeps still images with a slow zoom." checked={value.motion} onChange={(next) => set("motion", next)} disabled={disabled} />
        <Field id={id("strength")} label="Motion strength">
          <select id={id("strength")} className={selectClass} value={value.motionStrength} onChange={(event) => set("motionStrength", event.target.value as VideoSettings["motionStrength"])} disabled={disabled || !value.motion}>
            <option value="subtle">Subtle</option>
            <option value="normal">Normal</option>
          </select>
        </Field>
        <Field id={id("retro")} label="Retro look" hint="Low resolution and fewer colours, like a PS2 game.">
          <select id={id("retro")} className={selectClass} value={value.retro} onChange={(event) => set("retro", event.target.value as VideoSettings["retro"])} disabled={disabled}>
            {RETRO_LEVELS.map((level) => (
              <option key={level} value={level}>
                {capitalise(level)}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Captions">
        <Toggle id={id("captions")} label="Show captions" checked={value.captions} onChange={(next) => set("captions", next)} disabled={disabled} />
        <div className="grid grid-cols-2 gap-3">
          <Field id={id("csize")} label="Size">
            <select id={id("csize")} className={selectClass} value={value.captionSize} onChange={(event) => set("captionSize", event.target.value as VideoSettings["captionSize"])} disabled={disabled || !value.captions}>
              {CAPTION_SIZES.map((size) => (
                <option key={size} value={size}>
                  {capitalise(size)}
                </option>
              ))}
            </select>
          </Field>
          <Field id={id("cpos")} label="Position">
            <select id={id("cpos")} className={selectClass} value={value.captionPosition} onChange={(event) => set("captionPosition", event.target.value as VideoSettings["captionPosition"])} disabled={disabled || !value.captions}>
              {CAPTION_POSITIONS.map((position) => (
                <option key={position} value={position}>
                  {capitalise(position)}
                </option>
              ))}
            </select>
          </Field>
          <Field id={id("ccolor")} label="Colour">
            <input id={id("ccolor")} type="color" value={value.captionColor} onChange={(event) => set("captionColor", event.target.value.toUpperCase())} disabled={disabled || !value.captions} className="h-9 w-full cursor-pointer rounded-md border bg-transparent p-1" />
          </Field>
          <Field id={id("cwords")} label="Words at a time">
            <select id={id("cwords")} className={selectClass} value={value.captionWords} onChange={(event) => set("captionWords", Number(event.target.value))} disabled={disabled || !value.captions}>
              {[1, 2, 3, 4].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Music">
        <div className="grid grid-cols-2 gap-3">
          <Field id={id("music")} label="Music">
            <select id={id("music")} className={selectClass} value={value.music} onChange={(event) => set("music", event.target.value as VideoSettings["music"])} disabled={disabled}>
              <option value="auto">Match the script&apos;s mood</option>
              <option value="none">No music</option>
              {MUSIC_MOODS.map((mood) => (
                <option key={mood} value={mood}>
                  {capitalise(mood)}
                </option>
              ))}
            </select>
          </Field>
          <Field id={id("volume")} label={`Volume: ${value.musicVolume}%`}>
            <input id={id("volume")} type="range" min={0} max={40} step={1} value={value.musicVolume} onChange={(event) => set("musicVolume", Number(event.target.value))} disabled={disabled || value.music === "none"} className="accent-primary" />
          </Field>
        </div>
        {music && onMusicChange && <MusicTracks music={music} onChange={onMusicChange} disabled={disabled} />}
      </Section>
    </div>
  );
}
