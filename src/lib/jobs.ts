// Server-only: the Jobs page. You add a job by hand (paste the posting), and the text model compares it with your
// profile, writes a cover letter and drafts answers to application questions. Everything it writes must come from
// the profile: what the job asks for and the profile doesn't show is listed as a gap for you to fill in, never made up.
// Nothing here visits job sites or applies anywhere; you open the job link and apply yourself.
import {
  isJobStatus,
  OFFER_FIELDS,
  type JobAnswer,
  type JobContact,
  type JobCv,
  type JobEmail,
  type JobEmailKind,
  type JobFit,
  type JobInterview,
  type JobLetter,
  type JobOffer,
  type JobRecord,
  type JobStatus,
} from "./db.ts";
import { generateJson } from "./ollama.ts";
export { keywordScore } from "./job-status.ts";
import type { Profile } from "./profile.ts";

export const LIMITS = { short: 200, url: 2000, description: 20_000, notes: 10_000, letter: 10_000, question: 1000, answer: 5000 };
export const MAX_QUESTIONS = 10;
export const MAX_ANSWERS = 30;

// How much of the job and profile goes to the model. Together they stay well inside the 8192-token context.
const PROMPT_DESCRIPTION = 9000;
const PROMPT_POSITION = 900;
const PROMPT_SUMMARY = 1500;
const PROMPT_FACTS = 1500;
const PROMPT_CV = 5000;

// --- Prompt text ---

export function hasProfileContent(profile: Profile | null): profile is Profile {
  if (!profile) return false;
  return Boolean(
    profile.headline.trim() ||
      profile.summary.trim() ||
      profile.facts.trim() ||
      profile.cv.trim() ||
      profile.positions.length > 0 ||
      profile.skills.length > 0 ||
      profile.education.length > 0,
  );
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

// The whole profile as plain text: the only source the model may take experience from.
export function profileText(profile: Profile): string {
  const span = (start: string, end: string) => [start, end || "present"].filter(Boolean).join(" to ");
  const lines: string[] = [];
  if (profile.name) lines.push(`Name: ${profile.name}`);
  if (profile.headline) lines.push(`Headline: ${profile.headline}`);
  if (profile.location) lines.push(`Location: ${profile.location}`);
  if (profile.industry) lines.push(`Industry: ${profile.industry}`);
  if (profile.summary.trim()) lines.push(`About: ${clip(profile.summary.trim(), PROMPT_SUMMARY)}`);
  if (profile.positions.length > 0) {
    lines.push("Experience:");
    for (const position of profile.positions) {
      const role = [position.title, position.company].filter(Boolean).join(" at ");
      const when = position.startedOn ? ` (${span(position.startedOn, position.finishedOn)})` : "";
      lines.push(`- ${role}${when}${position.location ? `, ${position.location}` : ""}`);
      if (position.description.trim()) lines.push(`  ${clip(position.description.trim(), PROMPT_POSITION).replace(/\n+/g, " ")}`);
    }
  }
  if (profile.skills.length > 0) lines.push(`Skills: ${profile.skills.join(", ")}`);
  if (profile.education.length > 0) {
    lines.push("Education:");
    for (const school of profile.education) {
      const when = school.startDate || school.endDate ? ` (${[school.startDate, school.endDate].filter(Boolean).join(" to ")})` : "";
      lines.push(`- ${[school.degree, school.school].filter(Boolean).join(", ")}${when}`);
    }
  }
  if (profile.facts.trim()) lines.push(`Other facts they wrote about themselves: ${clip(profile.facts.trim(), PROMPT_FACTS)}`);
  if (profile.cv.trim()) lines.push(`CV:\n${clip(profile.cv.trim(), PROMPT_CV)}`);
  return lines.join("\n");
}

export function jobText(job: Pick<JobRecord, "title" | "company" | "location" | "description">): string {
  return [
    `Title: ${job.title}`,
    job.company && `Company: ${job.company}`,
    job.location && `Location: ${job.location}`,
    `Description:\n${clip(job.description.trim(), PROMPT_DESCRIPTION) || "(none given)"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// Today's date is included so "Jan 2022 to present" can be read correctly.
function prompt(job: JobRecord, profile: Profile, ...extra: string[]): string {
  const today = `TODAY\n${new Date().toISOString().slice(0, 10)}`;
  return [today, `PROFILE\n${profileText(profile)}`, `JOB\n${jobText(job)}`, ...extra.filter(Boolean)].join("\n\n");
}

// The fit's findings, handed to the letter and answers so they write about what matches and stay off the gaps.
function fitSections(fit: JobFit | null): string[] {
  if (!fit) return [];
  const sections: string[] = [];
  if (fit.strengths.length > 0) {
    sections.push(`WHAT MATCHES (write about these)\n${fit.strengths.map((item) => `- ${item.point} (${item.evidence})`).join("\n")}`);
  }
  if (fit.gaps.length > 0) {
    sections.push(`NOT IN THE PROFILE (never say or imply the person has these)\n${fit.gaps.map((gap) => `- ${gap}`).join("\n")}`);
  }
  return sections;
}

const GROUNDING = `- Use only facts written in the PROFILE. Never invent or assume employers, projects, tools, skills, years of experience, numbers, results, degrees or certifications.
- Something missing from the profile may still be true of the person, but you can't know it, so never claim it.
- Don't make things sound bigger than the profile says: if it says "built", don't write "led"; don't say how many years someone has done something unless the profile's dates show it.`;

// --- Checks on what the model wrote ---

type JobFacts = Pick<JobRecord, "title" | "company" | "location" | "description">;

// Details in what the model wrote that the profile doesn't back up: numbers (like "5 years" or "40%") found in
// neither the profile nor the job, and names from the job (like "Kubernetes") that the profile never mentions.
// A cheap safety net for the most common kinds of made-up detail; the page lists them so you check before sending.
// `extra` is other text the draft may rightly use, such as your notes on the job.
export function detailsToCheck(output: string, job: JobFacts, profile: Profile, extra = ""): string[] {
  const profileSource = `${profileText(profile)}
${extra}`;
  const known = new Set((`${profileSource}\n${jobText(job)}`.match(/\d[\d,.]*/g) ?? []).map(normalizeNumber));
  const numbers = (output.match(/\d[\d,.]*\s*(%|\+|k\b)?/gi) ?? [])
    .map((match) => match.trim().replace(/[.,]$/, ""))
    .filter((match) => !known.has(normalizeNumber(match)));
  // Spelled-out lengths of time ("three years", "several years") are claims the profile rarely states as such.
  const sourceLower = `${profileSource}\n${jobText(job)}`.toLowerCase();
  const durations = (output.match(DURATION) ?? []).filter((match) => !sourceLower.includes(match.toLowerCase()));

  // Capitalized or tech-looking words in the middle of a sentence in the job ("services in Go", "on Kubernetes"),
  // other than the job's own title, company and place, that the profile doesn't contain.
  const own = `${job.title} ${job.company} ${job.location}`.toLowerCase();
  const profileLower = profileSource.toLowerCase();
  const terms = new Set<string>();
  for (const match of job.description.matchAll(/(?<=[a-z,;:/(] )([A-Z][\w+#.-]*[\w+#]|[A-Z])(?=[\s,.;:)/]|$)/gm)) {
    const term = match[1];
    if (term.length < 2 && term !== "C" && term !== "R") continue;
    if (own.includes(term.toLowerCase()) || containsWord(profileLower, term.toLowerCase())) continue;
    terms.add(term);
  }
  const mentioned = [...terms].filter((term) => containsWord(output, term));
  // Email addresses and web links the model may have made up.
  const contacts = (output.match(CONTACT_DETAIL) ?? []).filter((match) => !sourceLower.includes(match.toLowerCase()));
  return [...new Set([...numbers, ...durations, ...mentioned, ...contacts])];
}

const CONTACT_DETAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+|https?:\/\/[^\s)]*[^\s).,;:]|\bwww\.[^\s)]*[^\s).,;:]/gi;

const DURATION =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|several|many|a few|over a|over|nearly|almost)\s+(years?|months?|decades?)\b/gi;

function containsWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w])${escaped}(?![\\w+#])`).test(text);
}

function normalizeNumber(text: string): string {
  // "01" (from a date) and "1" are the same number.
  return text.replace(/[^\d.]/g, "").replace(/\.$/, "").replace(/^0+(?=\d)/, "");
}

const tidy = (text: unknown, max: number) => String(text ?? "").trim().slice(0, max);
const tidyList = (list: unknown, max: number, count: number) =>
  (Array.isArray(list) ? list : []).map((item) => tidy(item, max)).filter(Boolean).slice(0, count);

// --- Fit ---

const FIT_SYSTEM = `You help a job seeker see how well a job fits them, using only their profile.
Rules:
${GROUNDING}
- strengths: requirements of the JOB that the PROFILE clearly shows. For each, point says what matches and evidence names exactly where in the profile it's shown (a role, a skill, a school or a fact), quoting it briefly.
- gaps: requirements or wishes in the JOB that the PROFILE doesn't show. Be specific, like "Kubernetes isn't in your profile" or "The job wants 5+ years; your profile shows about 2".
- match: "strong" if the profile shows most of the core requirements, "partial" if it shows some, "weak" if it shows few.
- summary: 2 or 3 plain sentences to the person ("you"), honest about the fit.
- No emojis.`;

const FIT_SCHEMA = {
  type: "object",
  properties: {
    match: { type: "string", enum: ["strong", "partial", "weak"] },
    summary: { type: "string" },
    strengths: {
      type: "array",
      items: { type: "object", properties: { point: { type: "string" }, evidence: { type: "string" } }, required: ["point", "evidence"] },
      maxItems: 8,
    },
    gaps: { type: "array", items: { type: "string" }, maxItems: 8 },
  },
  required: ["match", "summary", "strengths", "gaps"],
};

export async function assessFit(job: JobRecord, profile: Profile): Promise<JobFit> {
  const reply = await generateJson<Partial<JobFit>>(prompt(job, profile), FIT_SYSTEM, FIT_SCHEMA);
  const match: JobFit["match"] = reply.match === "strong" || reply.match === "weak" ? reply.match : "partial";
  // A strength without evidence from the profile isn't one.
  const strengths = (Array.isArray(reply.strengths) ? reply.strengths : [])
    .map((item) => ({ point: tidy(item?.point, 300), evidence: tidy(item?.evidence, 300) }))
    .filter((item) => item.point && item.evidence)
    .slice(0, 8);
  const summary = tidy(reply.summary, 1000);
  // The summary and gaps name the missing things on purpose, so only the strengths are checked.
  const written = strengths.map((item) => `${item.point} ${item.evidence}`).join("\n");
  return {
    match,
    summary,
    strengths,
    gaps: tidyList(reply.gaps, 300, 8),
    unverified: detailsToCheck(written, job, profile),
    at: new Date().toISOString(),
  };
}

// --- Cover letter ---

const LETTER_SYSTEM = `You write a cover letter for the person in the PROFILE, applying for the JOB.
Rules:
${GROUNDING}
- Write about what's under WHAT MATCHES, with specifics from the PROFILE.
- Never mention anything under NOT IN THE PROFILE, not even to say it's missing, and don't apologize for gaps. The person decides how to handle those.
- Start with "Dear Hiring Team," or "Dear <company> team," (never a made-up name). Then 3 short paragraphs, under 300 words in total.
- Plain, warm and specific. Avoid clichés like "I am writing to express my interest" or "I am confident that".
- End with "Kind regards," and the person's name from the profile. No address, phone or date lines.
- No emojis.`;

const LETTER_SCHEMA = { type: "object", properties: { letter: { type: "string" } }, required: ["letter"] };

// Needs the fit, so the letter knows what to write about; the fit's gaps are the letter's gaps.
export async function writeLetter(job: JobRecord, profile: Profile, fit: JobFit): Promise<JobLetter> {
  const reply = await generateJson<{ letter?: unknown }>(prompt(job, profile, ...fitSections(fit)), LETTER_SYSTEM, LETTER_SCHEMA);
  let text = tidy(reply.letter, LIMITS.letter);
  if (!text) throw new Error("The model didn't write a letter. Try again.");
  const ending = text.split("\n").slice(-3).join("\n");
  if (!/regards|sincerely|best wishes|thank you/i.test(ending)) text += `\n\nKind regards,\n${profile.name || "[Your name]"}`;
  return { text, gaps: fit.gaps, unverified: detailsToCheck(text, job, profile), at: new Date().toISOString() };
}

// --- Application questions ---

const ANSWERS_SYSTEM = `You draft answers to job application questions for the person in the PROFILE, applying for the JOB.
Rules:
${GROUNDING}
- Never say or imply the person has anything under NOT IN THE PROFILE, or any tool, skill or experience the PROFILE doesn't name. When explaining why they want the job, talk only about the parts of the job that match the PROFILE.
- Never make up salary expectations, notice periods, start dates, work authorization, visa status, references or personal details.
- If the PROFILE answers the question, write the answer in the first person, 2 to 5 sentences unless the question asks for less, and set gap to "".
- If the PROFILE answers only part of it, answer that part and say in gap what the person needs to add.
- If the PROFILE can't answer it at all, set answer to "" and say in gap what the person needs to write themselves.
- Give one answer per question, in the same order.
- No emojis.`;

const ANSWERS_SCHEMA = {
  type: "object",
  properties: {
    answers: {
      type: "array",
      items: { type: "object", properties: { answer: { type: "string" }, gap: { type: "string" } }, required: ["answer", "gap"] },
    },
  },
  required: ["answers"],
};

export async function answerQuestions(job: JobRecord, profile: Profile, questions: string[], fit: JobFit | null): Promise<JobAnswer[]> {
  const list = questions.map((question, i) => `${i + 1}. ${question}`).join("\n");
  const schema = {
    ...ANSWERS_SCHEMA,
    properties: { answers: { ...ANSWERS_SCHEMA.properties.answers, minItems: questions.length, maxItems: questions.length } },
  };
  const reply = await generateJson<{ answers?: { answer?: unknown; gap?: unknown }[] }>(
    prompt(job, profile, ...fitSections(fit), `QUESTIONS\n${list}`),
    ANSWERS_SYSTEM,
    schema,
  );
  const replies = Array.isArray(reply.answers) ? reply.answers : [];
  // The questions are kept as you wrote them; only the answers come from the model.
  return questions.map((question, i) => {
    const answer = tidy(replies[i]?.answer, LIMITS.answer);
    const gap = tidy(replies[i]?.gap, 500) || (answer ? "" : "The model didn't answer this one. Write it yourself or try again.");
    return { question, answer, gap, unverified: detailsToCheck(answer, job, profile) };
  });
}

// --- Keyword check ---

const NOT_KEYWORDS = new Set(
  ("I We You Our Your The This That They It He She And Or But If In On At For With Of To As By " +
    "Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August " +
    "September October November December Equal Opportunity Employer").split(" "),
);

// Names and terms the job mentions (tools, skills, certifications, like "Kubernetes" or "AWS"), split into the
// ones your profile mentions and the ones it doesn't. No model involved: it's a word-for-word comparison.
export function keywordCheck(job: JobFacts, profile: Profile | null): { found: string[]; missing: string[] } {
  const own = `${job.title} ${job.company} ${job.location}`.toLowerCase();
  const counts = new Map<string, { term: string; count: number }>();
  for (const match of job.description.matchAll(/(?<=[a-z,;:/(] )([A-Z][\w+#.-]*[\w+#]|[A-Z])(?=[\s,.;:)/]|$)/gm)) {
    const term = match[1].replace(/\.$/, "");
    if ((term.length < 2 && term !== "C" && term !== "R") || NOT_KEYWORDS.has(term)) continue;
    if (own.split(/\s+/).includes(term.toLowerCase())) continue;
    const key = term.toLowerCase();
    const entry = counts.get(key) ?? { term, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  const terms = [...counts.values()].sort((a, b) => b.count - a.count).map((entry) => entry.term).slice(0, 40);
  const profileLower = profile ? profileText(profile).toLowerCase() : "";
  const found = terms.filter((term) => containsWord(profileLower, term.toLowerCase()));
  return { found, missing: terms.filter((term) => !found.includes(term)) };
}

// --- Tailored CV ---

const CV_SYSTEM = `You tailor the CV of the person in the PROFILE for the JOB.
Rules:
${GROUNDING}
- You may reorder, shorten and reword. Put the experience and skills that matter most for the JOB first, and use the JOB's words where the PROFILE already shows the same thing.
- Keep every employer, title, school and date exactly as the PROFILE has them. Leave out what isn't relevant rather than inventing anything.
- Never mention anything under NOT IN THE PROFILE.
- Plain text in this layout:
  Line 1: the person's name. Line 2: [Email · Phone · LinkedIn] for them to fill in. Line 3: a short headline for this job, from their real roles.
  Then sections, each starting with a line like "# Summary", "# Experience", "# Skills", "# Education".
  Under Experience, each role as a line "Title, Company (dates)" followed by bullet lines starting with "- ".
  Leave out a section when the PROFILE has nothing for it.
- No emojis.`;

const CV_SCHEMA = { type: "object", properties: { cv: { type: "string" } }, required: ["cv"] };

const CV_CONTACT_LINE = "[Email · Phone · LinkedIn]";

export async function tailorCv(job: JobRecord, profile: Profile): Promise<JobCv> {
  const reply = await generateJson<{ cv?: unknown }>(prompt(job, profile, ...fitSections(job.fit)), CV_SYSTEM, CV_SCHEMA);
  // The model never sees contact details, so its contact line is replaced (the model tends to make one up), and any
  // other email address or link not in the profile becomes a placeholder.
  const known = profileText(profile).toLowerCase();
  const lines = tidy(reply.cv, LIMITS.letter).split("\n");
  if (lines.length > 1 && /@|\d{3}|linkedin|\[|\||·/i.test(lines[1])) lines[1] = CV_CONTACT_LINE;
  else if (lines.length > 1) lines.splice(1, 0, CV_CONTACT_LINE);
  let text = lines
    .join("\n")
    .replace(CONTACT_DETAIL, (match) => (known.includes(match.toLowerCase()) ? match : match.includes("@") ? "[Email]" : "[Link]"));
  if (!text) throw new Error("The model didn't write a CV. Try again.");
  const unverified = detailsToCheck(text, job, profile);
  // Your own contact details from the Profile page's quick-copy details, put in here rather than by the model.
  const contact = [profile.email, profile.phone, profile.linkedinUrl].map((part) => part.trim()).filter(Boolean);
  if (contact.length > 0) text = text.replace(CV_CONTACT_LINE, contact.join(" · "));
  return { text, unverified, at: new Date().toISOString() };
}

// --- Interview prep ---

const INTERVIEW_SYSTEM = `You help the person in the PROFILE prepare for an interview for the JOB.
Rules:
${GROUNDING}
- questions: 6 questions the interviewer is likely to ask, based on the JOB: a mix of questions about their experience, the job's main requirements and how they work.
- why: one short sentence naming the requirement in the JOB that makes this question likely.
- answer: a first-person answer using only details the PROFILE states, 2 to 4 sentences. Don't add how something was done, who was involved, routines, motives or results unless the PROFILE says so. A short answer is better than an invented one.
- gap: written to the person as "you": what to prepare to make the answer complete, like the specifics of what they did, how and the result, or an example the PROFILE doesn't have. Use "" only when the PROFILE already gives a full example. If the PROFILE can't answer at all, set answer to "".
- Never say or imply the person has anything under NOT IN THE PROFILE.
- No emojis.`;

const INTERVIEW_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      minItems: 4,
      maxItems: 8,
      items: {
        type: "object",
        properties: { question: { type: "string" }, why: { type: "string" }, answer: { type: "string" }, gap: { type: "string" } },
        required: ["question", "why", "answer", "gap"],
      },
    },
  },
  required: ["questions"],
};

export async function prepareInterview(job: JobRecord, profile: Profile): Promise<JobInterview> {
  const reply = await generateJson<{ questions?: { question?: unknown; why?: unknown; answer?: unknown; gap?: unknown }[] }>(
    prompt(job, profile, ...fitSections(job.fit)),
    INTERVIEW_SYSTEM,
    INTERVIEW_SCHEMA,
  );
  const questions = (Array.isArray(reply.questions) ? reply.questions : [])
    .map((item) => {
      const answer = tidy(item?.answer, LIMITS.answer);
      return {
        question: tidy(item?.question, LIMITS.question),
        why: tidy(item?.why, 300),
        answer,
        // The model sometimes writes "None, the profile covers it" instead of leaving the gap empty.
        gap: /^(none|n\/a|no gap)\b/i.test(tidy(item?.gap, 500)) ? "" : tidy(item?.gap, 500),
        unverified: detailsToCheck(answer, job, profile),
      };
    })
    .filter((item) => item.question)
    .slice(0, 8);
  if (questions.length === 0) throw new Error("The model didn't write any questions. Try again.");
  return { questions, at: new Date().toISOString() };
}

// --- Follow-up and thank-you emails ---

const EMAIL_SYSTEM = `You write a short email for the person in the PROFILE about their application for the JOB. They send it themselves.
Rules:
${GROUNDING}
- Use only what's in the PROFILE, the JOB, the APPLICATION details and the person's NOTES. Never invent what was said in an interview, names, dates or next steps.
- Don't say when anything happened ("today", "yesterday", "last week") unless the NOTES say it. Mention what was discussed only as the NOTES put it.
- Never say or imply the person has anything under NOT IN THE PROFILE, or can do parts of the job the PROFILE doesn't show.
- First line "Subject: ...", then a blank line, then the email.
- Greet the CONTACT by first name if one is given, otherwise "Hello,".
- Under 150 words. Polite, warm and direct.
- Sign off with the person's name from the PROFILE.
- No emojis.`;

const EMAIL_PURPOSE: Record<JobEmailKind, string> = {
  "follow-up": "A follow-up after applying: politely ask whether there's an update on the application and restate interest in one sentence that names one real match from the PROFILE.",
  "thank-you": "A thank-you after an interview: thank them for their time, say they enjoyed learning about the role, and restate interest with one real match from the PROFILE. Only mention what was discussed if the NOTES say so.",
};

const EMAIL_SCHEMA = { type: "object", properties: { email: { type: "string" } }, required: ["email"] };

export async function writeEmail(job: JobRecord, profile: Profile, kind: JobEmailKind): Promise<JobEmail> {
  const contact = job.contacts.find((item) => item.name.trim());
  const applied = [...job.history].reverse().find((step) => step.status === "applied");
  const details = [
    `EMAIL\n${EMAIL_PURPOSE[kind]}`,
    `APPLICATION\nStatus: ${job.status}${applied ? `\nApplied on: ${applied.at.slice(0, 10)}` : ""}`,
    contact ? `CONTACT\n${[contact.name, contact.role].filter(Boolean).join(", ")}` : "",
    job.notes.trim() ? `NOTES\n${clip(job.notes.trim(), 1500)}` : "",
  ];
  const reply = await generateJson<{ email?: unknown }>(prompt(job, profile, ...fitSections(job.fit), ...details), EMAIL_SYSTEM, EMAIL_SCHEMA);
  const text = tidy(reply.email, 5000);
  if (!text) throw new Error("The model didn't write an email. Try again.");
  const sources = `${job.notes}\n${contact?.name ?? ""} ${contact?.role ?? ""}\n${applied?.at.slice(0, 10) ?? ""}`;
  // Names from the notes and contact are fine to use, so they're added to what the check knows about.
  const unverified = detailsToCheck(text, job, profile, sources);
  return { kind, text, unverified, at: new Date().toISOString() };
}

// --- Validation for the API routes ---

export type JobInput = Pick<JobRecord, "title" | "company" | "location" | "url" | "description">;

// Checks the fields that are present in `body`. With `partial` false, title is required.
export function validateJobFields(
  body: Record<string, unknown>,
  partial: boolean,
): Partial<JobInput & Pick<JobRecord, "notes" | "followUp" | "status">> | string {
  const out: Partial<JobInput & Pick<JobRecord, "notes" | "followUp" | "status">> = {};
  const text = (field: keyof JobInput | "notes", max: number) => {
    const value = body[field];
    if (value === undefined) return true;
    if (typeof value !== "string" || value.length > max) return false;
    out[field] = value.trim();
    return true;
  };
  if (!text("title", LIMITS.short)) return "The title must be text of at most 200 characters.";
  if (!text("company", LIMITS.short)) return "The company must be text of at most 200 characters.";
  if (!text("location", LIMITS.short)) return "The location must be text of at most 200 characters.";
  if (!text("url", LIMITS.url)) return "The link is too long.";
  if (!text("description", LIMITS.description)) return "The description is too long (at most 20,000 characters).";
  if (!text("notes", LIMITS.notes)) return "The notes are too long (at most 10,000 characters).";
  if (!partial && !out.title) return "Add the job title.";
  if (partial && out.title === "") return "The job title can't be empty.";
  if (out.url && !isWebLink(out.url)) return "The link must start with http:// or https://.";

  if (body.followUp !== undefined) {
    if (body.followUp === null || body.followUp === "") out.followUp = null;
    else if (typeof body.followUp === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.followUp)) out.followUp = body.followUp;
    else return "The next-step date must be a date.";
  }
  if (body.status !== undefined) {
    if (!isJobStatus(body.status)) return "Unknown status.";
    out.status = body.status as JobStatus;
  }
  return out;
}

export function isWebLink(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function validateQuestions(value: unknown): string[] | string {
  if (!Array.isArray(value)) return "Add at least one question.";
  const questions = value.map((question) => (typeof question === "string" ? question.trim() : "")).filter(Boolean);
  if (questions.length === 0) return "Add at least one question.";
  if (questions.length > MAX_QUESTIONS) return `Add at most ${MAX_QUESTIONS} questions at a time.`;
  if (questions.some((question) => question.length > LIMITS.question)) return "One of the questions is too long.";
  return questions;
}

// Edited answers from the page: the question and answer text only; gaps and checks are kept from the last draft.
export function validateAnswerEdits(value: unknown, current: JobAnswer[]): JobAnswer[] | string {
  if (!Array.isArray(value) || value.length > MAX_ANSWERS) return `"answers" must be a list.`;
  const answers: JobAnswer[] = [];
  for (const item of value as unknown[]) {
    const edit = item as { question?: unknown; answer?: unknown };
    if (typeof edit?.question !== "string" || typeof edit.answer !== "string") return "Each answer needs a question and an answer.";
    if (edit.question.length > LIMITS.question || edit.answer.length > LIMITS.answer) return "One of the answers is too long.";
    const before = current.find((answer) => answer.question === edit.question);
    answers.push({
      question: edit.question,
      answer: edit.answer,
      gap: before?.gap ?? "",
      unverified: before && before.answer === edit.answer ? before.unverified : [],
    });
  }
  return answers;
}

export const MAX_CONTACTS = 10;

export function validateContacts(value: unknown): JobContact[] | string {
  if (!Array.isArray(value) || value.length > MAX_CONTACTS) return `Add at most ${MAX_CONTACTS} contacts.`;
  const contacts: JobContact[] = [];
  for (const item of value as unknown[]) {
    const contact = {} as JobContact;
    for (const field of ["name", "role", "email", "linkedin", "notes"] as const) {
      const v = (item as Record<string, unknown>)?.[field] ?? "";
      if (typeof v !== "string" || v.length > (field === "notes" ? 2000 : LIMITS.short)) return "One of the contacts is too long.";
      contact[field] = v;
    }
    if (contact.linkedin.trim() && !isWebLink(contact.linkedin.trim())) return "A LinkedIn link must start with https://.";
    contacts.push(contact);
  }
  return contacts;
}

// null clears the offer details.
export function validateOffer(value: unknown): JobOffer | null | string {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return "The offer must be an object.";
  const offer = {} as JobOffer;
  for (const field of OFFER_FIELDS) {
    const v = (value as Record<string, unknown>)[field] ?? "";
    if (typeof v !== "string" || v.length > (field === "notes" || field === "benefits" ? 2000 : LIMITS.short)) {
      return "One of the offer details is too long.";
    }
    offer[field] = v;
  }
  return offer;
}

export function isEmailKind(value: unknown): value is JobEmailKind {
  return value === "follow-up" || value === "thank-you";
}

// --- What's being written right now ---

export const WRITE_KINDS = ["fit", "letter", "answers", "cv", "interview", "email"] as const;
export type WriteKind = (typeof WRITE_KINDS)[number];

// Kept on globalThis like the database connection, so it survives dev hot reloads. Lets the page show that a
// draft is still being written after you come back to it, and stops the same draft being started twice.
const writing = globalThis as typeof globalThis & { jobWriting?: Set<string> };
const runningSet = () => (writing.jobWriting ??= new Set());

export function writingFor(jobId: string): WriteKind[] {
  return WRITE_KINDS.filter((kind) => runningSet().has(`${jobId}:${kind}`));
}

// Runs `task` unless the same kind of draft is already being written for this job. Returns null in that case.
export async function whileWriting<T>(jobId: string, kind: WriteKind, task: () => Promise<T>): Promise<T | null> {
  const key = `${jobId}:${kind}`;
  if (runningSet().has(key)) return null;
  runningSet().add(key);
  try {
    return await task();
  } finally {
    runningSet().delete(key);
  }
}

// --- Duplicates and export ---

// The saved job with the same link (ignoring tracking parameters and a trailing slash), or the same title at the
// same company, if there is one.
export function findDuplicate(jobs: JobRecord[], job: Partial<Pick<JobRecord, "title" | "company" | "url">>): JobRecord | null {
  const link = normalizeLink(job.url ?? "");
  const name = job.company?.trim() ? `${job.title}|${job.company}`.toLowerCase().replace(/[^a-z0-9|]/g, "") : "";
  return (
    jobs.find(
      (other) =>
        (link && normalizeLink(other.url) === link) ||
        (name && other.company.trim() && `${other.title}|${other.company}`.toLowerCase().replace(/[^a-z0-9|]/g, "") === name),
    ) ?? null
  );
}

function normalizeLink(url: string): string {
  if (!isWebLink(url)) return "";
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_|ref|source|trk|refid|tracking)/i.test(key)) parsed.searchParams.delete(key);
  }
  return `${parsed.host.replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "")}${parsed.search}`.toLowerCase();
}

const CSV_COLUMNS: [string, (job: JobRecord) => string][] = [
  ["Title", (job) => job.title],
  ["Company", (job) => job.company],
  ["Location", (job) => job.location],
  ["Status", (job) => job.status],
  ["Saved", (job) => job.createdAt.slice(0, 10)],
  ["Applied", (job) => job.history.find((step) => step.status === "applied")?.at.slice(0, 10) ?? ""],
  ["Last status change", (job) => job.history.at(-1)?.at.slice(0, 10) ?? ""],
  ["Next step", (job) => job.followUp ?? ""],
  ["Fit", (job) => job.fit?.match ?? ""],
  ["Contacts", (job) => job.contacts.map((contact) => [contact.name, contact.role, contact.email].filter(Boolean).join(", ")).join("; ")],
  ["Salary offered", (job) => job.offer?.salary ?? ""],
  ["Link", (job) => job.url],
  ["Notes", (job) => job.notes],
];

export function jobsCsv(jobs: JobRecord[]): string {
  const cell = (value: string) => {
    // A leading = + - @ would run as a formula in a spreadsheet.
    const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const rows = [CSV_COLUMNS.map(([name]) => name), ...jobs.map((job) => CSV_COLUMNS.map(([, get]) => get(job)))];
  // The byte order mark makes Excel read the file as UTF-8.
  return `﻿${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
