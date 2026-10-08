# LinkedIn AI Engine

Generate LinkedIn post drafts with a local, open-source LLM. Runs fully on your computer through [Ollama](https://ollama.com). No API keys, no cloud costs.

## Requirements

- [Node.js](https://nodejs.org) 24 or newer
- [pnpm](https://pnpm.io)
- [Ollama](https://ollama.com/download)

## Setup

```bash
ollama pull gemma4:12b
pnpm install
pnpm start
```

## Settings (optional)

Copy `.env.example` to `.env` to change the Ollama address or the model.
