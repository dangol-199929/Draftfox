import { mkdirSync, writeFileSync } from "node:fs";
import { OLLAMA_MODEL } from "../src/lib/ollama.ts";
import { generateLinkedInPost } from "../src/lib/post.ts";
import type { PostInput } from "../src/lib/prompts.ts";

// Sample inputs for manually comparing output quality.
// They are test cases, not real experiences (except the Ollama one).
const testInputs: PostInput[] = [
  {
    topic: "What I learned from using Docker",
    experience: "I spent several hours debugging Docker networking.",
    audience: "Software developers",
    tone: "Casual and technical",
    length: "medium",
  },
  {
    topic: "Why TypeScript's strict mode is worth turning on",
    audience: "JavaScript developers",
    tone: "Clear and direct",
    length: "short",
  },
  {
    topic: "My career",
  },
  {
    topic: "Asking for help as a junior developer",
    experience:
      "In my first month I waited two days before asking a teammate about a failing build. It took them five minutes to fix.",
    tone: "Honest and reflective",
    length: "medium",
  },
  {
    topic: "Running LLMs locally for development",
    experience:
      "I set up Ollama with Gemma 4 12B on a 16 GB MacBook Air M2. It runs fully on the GPU and writes a medium-length post in about 15 to 25 seconds. I chose it so I don't pay for an AI API while building a side project.",
    audience: "Engineering managers",
    tone: "Professional",
    length: "long",
  },
  {
    topic: "Naming things in code",
    experience: "I renamed a variable called data2 to something meaningful and spotted a bug while doing it.",
    tone: "Playful",
    length: "short",
  },
];

const lines = [`# Test run: ${OLLAMA_MODEL}, ${new Date().toLocaleString()}`, ""];

try {
  for (const [i, input] of testInputs.entries()) {
    const label = `Test ${i + 1}/${testInputs.length}: ${input.topic}`;
    console.log(`\n=== ${label} ===\n`);

    const start = Date.now();
    const post = await generateLinkedInPost(input);
    const seconds = ((Date.now() - start) / 1000).toFixed(1);
    const words = post.split(/\s+/).filter(Boolean).length;

    console.log(post);
    console.log(`\n(${seconds}s, ${words} words)`);
    lines.push(`## ${label}`, "", "```json", JSON.stringify(input, null, 2), "```", "", post, "", `_${seconds}s, ${words} words_`, "");
  }

  mkdirSync("outputs", { recursive: true });
  const file = `outputs/test-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
  writeFileSync(file, lines.join("\n"));
  console.log(`\nSaved to ${file}`);
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
