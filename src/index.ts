const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
const model = process.env.OLLAMA_MODEL ?? "gemma4:12b";

console.log("LinkedIn AI Engine");
console.log(`Node:   ${process.version}`);
console.log(`Ollama: ${ollamaUrl}`);
console.log(`Model:  ${model}`);
