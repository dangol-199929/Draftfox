import { OLLAMA_MODEL } from "../src/lib/ollama.ts";
import type { JobRecord } from "../src/lib/db.ts";
import { answerQuestions, assessFit, keywordCheck, prepareInterview, tailorCv, writeEmail, writeLetter } from "../src/lib/jobs.ts";
import { EMPTY_PROFILE, type Profile } from "../src/lib/profile.ts";

// A made-up profile and job for checking that the Jobs page drafts stay grounded in the profile.
// The job asks for things the profile doesn't have (Kubernetes, Go, 5+ years), which should come back as gaps.
const profile: Profile = {
  ...EMPTY_PROFILE,
  name: "Sam Example",
  headline: "Frontend developer | React, TypeScript",
  location: "Sydney, Australia",
  summary: "Frontend developer who likes building fast, accessible web apps.",
  positions: [
    {
      company: "Sample Retail",
      title: "Frontend Developer",
      description: "Built the checkout in React and TypeScript. Cut page load time from 4 seconds to 1.5 seconds. Ran weekly accessibility reviews.",
      location: "Sydney",
      startedOn: "Mar 2023",
      finishedOn: "",
    },
    {
      company: "Placeholder Agency",
      title: "Junior Web Developer",
      description: "Made marketing sites with Next.js for 12 clients.",
      location: "Sydney",
      startedOn: "Jan 2022",
      finishedOn: "Feb 2023",
    },
  ],
  skills: ["React", "TypeScript", "Next.js", "Accessibility", "CSS"],
  education: [{ school: "Example University", degree: "Bachelor of IT", startDate: "2018", endDate: "2021" }],
};

const now = new Date().toISOString();
const job: JobRecord = {
  id: "test",
  title: "Senior Full-stack Engineer",
  company: "Demo Corp",
  location: "Remote",
  url: "",
  description: `We're hiring a senior full-stack engineer.
Requirements:
- 5+ years of professional experience
- Strong React and TypeScript
- Backend services in Go
- Running services on Kubernetes
- Care for accessibility and performance`,
  status: "saved",
  notes: "",
  followUp: null,
  history: [],
  fit: null,
  letter: null,
  answers: [],
  tailoredCv: null,
  interview: null,
  email: null,
  contacts: [],
  offer: null,
  source: "",
  salary: "",
  postedAt: null,
  createdAt: now,
  updatedAt: now,
};

const questions = [
  "Why do you want to work at Demo Corp?",
  "Describe a time you improved the performance of a web app.",
  "How many years of Go experience do you have?",
  "What are your salary expectations?",
];

async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  const start = Date.now();
  const result = await run();
  console.log(`=== ${label} (${((Date.now() - start) / 1000).toFixed(1)} s) ===`);
  console.log(JSON.stringify(result, null, 2), "\n");
  return result;
}

console.log(`# Jobs test: ${OLLAMA_MODEL}\n`);
const fit = await timed("Fit", () => assessFit(job, profile));
await timed("Cover letter", () => writeLetter(job, profile, fit));
await timed("Answers", () => answerQuestions(job, profile, questions, fit));
const withFit = { ...job, fit };
await timed("Keywords", async () => keywordCheck(job, profile));
await timed("Tailored CV", () => tailorCv(withFit, profile));
await timed("Interview prep", () => prepareInterview(withFit, profile));
await timed("Thank-you email", () =>
  writeEmail(
    { ...withFit, status: "interview", notes: "Interviewed with Alex on Oct 10 about the design system.", contacts: [{ name: "Alex Sample", role: "Engineering Manager", email: "", linkedin: "", notes: "" }] },
    profile,
    "thank-you",
  ),
);
