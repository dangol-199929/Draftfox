# LinkedIn AI Engine

Generate LinkedIn post drafts with a local, open-source LLM. Runs fully on your computer through [Ollama](https://ollama.com). No API keys, no cloud costs.

## Requirements

- [Node.js](https://nodejs.org) 24 or newer
- [pnpm](https://pnpm.io)
- [Ollama](https://ollama.com/download)

## Setup

```bash
nvm use # if you use nvm
pnpm install
ollama pull gemma4:12b
pnpm dev
```

Then open http://localhost:3000.

## Compare outputs

```bash
pnpm test:posts
```

Runs `scripts/test-posts.ts`: generates posts from sample inputs and saves them to `outputs/` for side-by-side comparison.

## Settings (optional)

Copy `.env.example` to `.env` to change the Ollama address or the model.
