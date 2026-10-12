// Server-only: designed post images ("cards"). A hook headline and a few key points, laid out on an 8 px grid
// around a simple 2D cartoon. The cartoon comes from the image engine with no words in it; the text is drawn
// here, so it's always crisp and spelled right. Rendered with Satori (layout to SVG) and resvg (SVG to PNG).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import { LAYOUTS, PALETTES, type Layout, type Palette } from "./card-styles.ts";
import { getStatus } from "./linkedin.ts";
import { generateJson } from "./ollama.ts";
import { readProfile } from "./profile.ts";

export { CARTOON_SIZE, LAYOUTS, PALETTES, type Layout, type Palette } from "./card-styles.ts";

export type CardContent = {
  tag: string;
  // *One word* in asterisks is drawn in the accent color.
  hook: string;
  points: string[];
  // What the cartoon shows. No text in it.
  illustration: string;
};

export const MAX_POINTS = 4;

// Wraps the cartoon idea in the style every card uses, so they look like one series.
export function cartoonPrompt(idea: string): string {
  return [
    "Simple flat 2D cartoon illustration, clean minimal vector style, bold smooth outlines,",
    "flat colors, a small friendly palette with soft pastels. The subject is large and fills most of the frame,",
    `centered, on a plain solid white background. Subject: ${idea.trim()}.`,
    "Absolutely no text, letters, numbers, words, logos or watermarks.",
  ].join(" ");
}

const CONTENT_SYSTEM = `You design eye-catching LinkedIn image cards from a post. The card has a short hook, a few informative points and a simple cartoon.
Rules:
- Use only facts from the post. Never invent numbers, names or results.
- tag: 1 to 3 words naming the topic, like "Career tip" or "TypeScript".
- hook: at most 8 words. Punchy and curiosity-sparking, like a headline. Put *asterisks* around the single most important word.
- points: 3 short, concrete takeaways from the post, each at most 9 words, starting with a verb or a key noun. No numbering.
- illustration: one sentence describing a simple cartoon scene or visual metaphor for the post: characters or objects only, no text, no screens with words.
- No emojis or hashtags anywhere.`;

const CONTENT_SCHEMA = {
  type: "object",
  properties: {
    tag: { type: "string" },
    hook: { type: "string" },
    points: { type: "array", items: { type: "string" }, minItems: 2, maxItems: MAX_POINTS },
    illustration: { type: "string" },
  },
  required: ["tag", "hook", "points", "illustration"],
};

// Writes the card text and cartoon idea from the post with the text model.
export async function writeCardContent(postText: string): Promise<CardContent> {
  const content = await generateJson<CardContent>(`LinkedIn post:\n\n${postText.slice(0, 4000)}`, CONTENT_SYSTEM, CONTENT_SCHEMA);
  return cleanContent(content);
}

export function cleanContent(content: Partial<CardContent>): CardContent {
  const clean = (text: unknown, max: number) =>
    String(text ?? "")
      .replace(/\p{Extended_Pictographic}|️/gu, "")
      .replace(/#\w+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  return {
    tag: clean(content.tag, 40),
    hook: clean(content.hook, 90),
    points: (Array.isArray(content.points) ? content.points : [])
      .map((point) => clean(point, 90).replace(/^(\d+[.)]|[-*•])\s*/, ""))
      .filter(Boolean)
      .slice(0, MAX_POINTS),
    illustration: clean(content.illustration, 400),
  };
}

// --- Rendering ---

const FONT_DIR = join(process.cwd(), "node_modules", "@fontsource", "poppins", "files");

type Fonts = { name: string; data: Buffer; weight: 500 | 700 | 800; style: "normal" }[];
const fontCache = globalThis as typeof globalThis & { cardFonts?: Promise<Fonts> };

function fonts(): Promise<Fonts> {
  fontCache.cardFonts ??= Promise.all(
    ([500, 700, 800] as const).map(async (weight) => ({
      name: "Poppins",
      data: await readFile(join(FONT_DIR, `poppins-latin-${weight}-normal.woff`)),
      weight,
      style: "normal" as const,
    })),
  );
  return fontCache.cardFonts;
}

// "Ship *faster* today" -> words, with the starred ones marked. Words are laid out one by one so lines
// wrap cleanly without stray spaces.
function hookWords(hook: string): { text: string; accent: boolean }[] {
  return hook
    .split(/(\*[^*]+\*)/)
    .filter(Boolean)
    .flatMap((part) => {
      const accent = part.startsWith("*") && part.endsWith("*");
      return part
        .replace(/\*/g, "")
        .split(/\s+/)
        .filter(Boolean)
        .map((text) => ({ text, accent }));
    });
}

export async function renderCard({
  content,
  palette,
  layout,
  illustration,
}: {
  content: CardContent;
  palette: Palette;
  layout: Layout;
  illustration: { data: Buffer; mime: string } | null;
}): Promise<Buffer> {
  const colors = PALETTES[palette];
  const { width, height } = LAYOUTS[layout];
  const author = await authorLine();
  const image = illustration ? `data:${illustration.mime};base64,${illustration.data.toString("base64")}` : null;
  const square = layout === "square";
  const pad = 80;
  const words = content.hook.replace(/\*/g, "").length;
  // Longer hooks get a smaller size so they stay within three lines.
  const hookSize = square ? (words > 40 ? 60 : 68) : words > 44 ? 72 : 84;

  const pointList = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        justifyContent: "center",
        flexShrink: 0,
        ...(square && { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }),
      }}
    >
      {content.points.map((point, index) => (
        <div key={index} style={{ display: "flex", alignItems: "flex-start", gap: 24 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 56,
              height: 56,
              borderRadius: 28,
              background: colors.accent,
              color: colors.accentInk,
              fontSize: 28,
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            {index + 1}
          </div>
          <div
            style={{
              display: "flex",
              flexShrink: 1,
              minWidth: 0,
              fontSize: square ? 32 : 36,
              fontWeight: 500,
              lineHeight: 1.35,
              color: colors.ink,
              paddingTop: 4,
            }}
          >
            {point}
          </div>
        </div>
      ))}
    </div>
  );

  const picture = image ? (
    <div
      style={{
        display: "flex",
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: 0,
        position: "relative",
        background: colors.panel,
        borderRadius: 40,
        overflow: "hidden",
        minHeight: 0,
        minWidth: 0,
      }}
    >
      {/* Positioned absolutely so the picture's own size doesn't stretch the layout. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- rendered to PNG by Satori, not a page */}
      <img
        src={image}
        alt=""
        style={{ position: "absolute", top: 24, left: 24, right: 24, bottom: 24, width: "auto", height: "auto", objectFit: "contain" }}
      />
    </div>
  ) : null;

  const tree = (
    <div style={{ width, height, display: "flex", background: colors.bg, fontFamily: "Poppins", color: colors.ink }}>
      {/* Explicit inner size: Satori adds padding outside a fixed width, so margins are done this way. */}
      <div
        style={{
          width: width - pad * 2,
          height: height - pad * 2,
          margin: pad,
          display: "flex",
          flexDirection: "column",
          gap: 40,
        }}
      >
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {content.tag && (
          <div style={{ display: "flex" }}>
            <div
              style={{
                display: "flex",
                padding: "8px 24px",
                borderRadius: 999,
                border: `3px solid ${colors.ink}`,
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: 1,
                textTransform: "uppercase",
              }}
            >
              {content.tag}
            </div>
          </div>
        )}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            columnGap: Math.round(hookSize * 0.26),
            fontSize: hookSize,
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: -1.5,
          }}
        >
          {hookWords(content.hook).map((word, index) => (
            <span key={index} style={{ color: word.accent ? colors.accent : colors.ink }}>
              {word.text}
            </span>
          ))}
        </div>
      </div>

      {square ? (
        <div style={{ display: "flex", flex: 1, gap: 40, minHeight: 0 }}>
          {picture}
          {pointList}
        </div>
      ) : (
        <>
          {picture ?? <div style={{ display: "flex", flex: 1 }} />}
          {pointList}
        </>
      )}

      {author && (
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 24, color: colors.muted }}>
          <div style={{ display: "flex", width: 40, height: 6, borderRadius: 3, background: colors.accent }} />
          <div style={{ display: "flex", fontWeight: 700, color: colors.ink }}>{author.name}</div>
          {author.headline && <div style={{ display: "flex" }}>{author.headline}</div>}
        </div>
      )}
      </div>
    </div>
  );

  const svg = await satori(tree, { width, height, fonts: await fonts() });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng());
}

// Your name (and headline, if short) for the card's footer: from the Profile page, else from LinkedIn.
async function authorLine(): Promise<{ name: string; headline: string } | null> {
  const profile = await readProfile().catch(() => null);
  const name = profile?.name?.trim() || (await getStatus().catch(() => null))?.profile?.name || "";
  if (!name) return null;
  const headline = profile?.headline?.trim() ?? "";
  return { name, headline: headline.length <= 48 ? headline : "" };
}
