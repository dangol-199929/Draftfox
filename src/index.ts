import { generateText, OLLAMA_MODEL } from "./ollama.ts";

console.log(`Asking ${OLLAMA_MODEL}...\n`);

const start = Date.now();
const text = await generateText(
  "Explain in two sentences what TypeScript adds to JavaScript.",
);

console.log(text);
console.log(`\n(${((Date.now() - start) / 1000).toFixed(1)}s)`);
