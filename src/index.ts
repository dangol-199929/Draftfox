import { OLLAMA_MODEL } from "./ollama.ts";
import { generateLinkedInPost } from "./post.ts";

console.log(`Writing a post with ${OLLAMA_MODEL}...\n`);

try {
  const start = Date.now();
  const post = await generateLinkedInPost({
    topic: "What I learned from using Docker",
    experience: "I spent several hours debugging Docker networking.",
    audience: "Software developers",
    tone: "Casual and technical",
    length: "medium",
  });
  console.log(post);
  console.log(`\n(${((Date.now() - start) / 1000).toFixed(1)}s)`);
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
