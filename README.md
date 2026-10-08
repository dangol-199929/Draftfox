# LinkedIn AI Engine

Generate LinkedIn post drafts with a local, open-source LLM. A small web app that runs fully on your computer through [Ollama](https://ollama.com): no AI API keys, no cloud costs.

You give it a topic and what really happened; it writes a draft you can edit and copy. **Nothing is ever posted to LinkedIn.** The optional LinkedIn connection only reads your name, email and photo.

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

## Pages

- **Generate** (`/`): enter a topic, your real experience, audience, tone and length. The post streams in as the model writes it; you can stop it, edit it, copy it or regenerate it. If the topic is too vague, the model asks a few questions instead of inventing details.
- **Profile** (`/profile`): optional facts about you and examples of your past posts, so drafts sound like you. Fill it in by hand or import your LinkedIn data (see below).
- **Prompt** (`/prompt`): edit the system prompt, the standing rules the model follows for every post. Save, discard changes, or reset to the built-in default.
- **LinkedIn** (`/linkedin`): connect your LinkedIn account with Sign In with LinkedIn. Optional; see below.

## Profile and LinkedIn data import (optional)

The Profile page lets the model use true facts about you (headline, current role, skills and a free-text "Facts about me") and up to three of your past posts as writing-style examples. Each can be switched off. The text you type in "Your experience" stays the only source of things that happened; the profile is background only.

To import your data from LinkedIn:

1. On LinkedIn, go to **Me → Settings & Privacy → Data privacy → Get a copy of your data**.
2. Choose **Want something in particular?**, tick **Profile**, **Positions**, **Skills** and **Shares** (your posts), then **Request archive**.
3. LinkedIn emails a download link, usually quickly for selected files (the full archive can take up to 24 hours).
4. Drop the .zip, or the individual CSV files, onto the Profile page.

Only the headline, summary, industry, location, positions, skills, education and your 50 most recent posts are kept. Addresses, birth dates, contacts and messages are ignored, and the upload itself is never saved.

## LinkedIn setup (optional)

Only needed for the LinkedIn page.

1. **Company Page.** LinkedIn developer apps must belong to a Company Page. If you don't admin one, create a free page: on linkedin.com, open **For Business**, then **Create a Company Page**.
2. **Developer app.** Go to [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps), click **Create app**, pick your Company Page and upload any square logo.
3. **Verify.** On the app's **Settings** tab, click **Verify** and approve the link as the page admin.
4. **Product.** On the **Products** tab, add **Sign In with LinkedIn using OpenID Connect**. Nothing else is needed.
5. **Redirect URL.** On the **Auth** tab, add `http://localhost:3000/api/linkedin/callback` under *Authorized redirect URLs for your app*. It must match exactly.
6. **Keys.** Copy the Client ID and Primary Client Secret from the **Auth** tab into `.env` (see below), restart `pnpm dev`, then click **Connect LinkedIn** on the LinkedIn page.

The app asks for the `openid profile email` scopes only.

## Settings

Copy `.env.example` to `.env` and fill in what you need. Everything is optional.

| Variable | Default | What it's for |
| --- | --- | --- |
| `OLLAMA_URL` | `http://localhost:11434` | Where Ollama is running |
| `OLLAMA_MODEL` | `gemma4:12b` | Which model writes the posts (download it first with `ollama pull <model>`) |
| `LINKEDIN_CLIENT_ID` | none | Client ID of your LinkedIn app |
| `LINKEDIN_CLIENT_SECRET` | none | Primary Client Secret of your LinkedIn app. Keep it secret. |
| `LINKEDIN_REDIRECT_URI` | `http://localhost:3000/api/linkedin/callback` | Must match the redirect URL in your LinkedIn app |

`.env` is gitignored.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the app at http://localhost:3000 |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm typecheck` | Type-check the project |
| `pnpm test:posts` | Generate posts from the sample inputs in `scripts/test-posts.ts` and save them to `outputs/` for side-by-side comparison |

## Where data is stored

Everything stays on your computer in the `data/` folder, which is gitignored:

- `data/settings.json`: your edited system prompt, if you changed it.
- `data/profile.json`: your profile facts and past posts, if you added them. "Delete all profile data" removes it.
- `data/linkedin.json`: your LinkedIn name, email, photo URL and access token, if you connected. Disconnecting deletes it.

Comparison runs from `pnpm test:posts` go to `outputs/`, also gitignored.

## License

[MIT](LICENSE)
