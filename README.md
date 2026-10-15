# Draftfox

<img src="src/app/icon.svg" alt="Draftfox logo" width="72" height="72">

Local AI for LinkedIn posts: drafts, designed images and scheduling. Free, private and open source.

Generate LinkedIn post drafts with a local, open-source LLM. A small web app that runs fully on your computer through [Ollama](https://ollama.com): no AI API keys, no cloud costs.

You give it a topic and what really happened; it writes a draft you can edit and copy. **Nothing is posted to LinkedIn unless you click Post to LinkedIn and confirm.** The optional LinkedIn connection reads your name, email and photo, and can post only with your confirmation.

**New here?** Read [what Draftfox is and why it exists](docs/ABOUT.md), then follow the [step-by-step setup guide for Mac and Windows](docs/SETUP.md) (with minimum requirements and fixes for common errors).

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
- **Posts** (`/posts`): a post editor with your own or generated images (with alt text), drafts saved as you type, Post now, Post later at a chosen time, and automatic posting. See below.
- **Profile** (`/profile`): optional facts about you and examples of your past posts, so drafts sound like you. Fill it in by hand or import your LinkedIn data (see below).
- **Prompt** (`/prompt`): edit the system prompt, the standing rules the model follows for every post. Save, discard changes, or reset to the built-in default.
- **LinkedIn** (`/linkedin`): connect your LinkedIn account with Sign In with LinkedIn, and optionally enable posting. See below.
- **Reports** (`/reports`): drafts generated, copied and posted over the last 7, 30 or 90 days or all time, with a chart, the lengths and tones you use, recent activity and links to the posts you published. See below.
- **Jobs** (`/jobs`): find jobs that match your profile or paste one you found, see how it fits, and draft a cover letter and answers to application questions. See below.

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
4. **Products.** On the **Products** tab, add **Sign In with LinkedIn using OpenID Connect**. Add **Share on LinkedIn** too if you want to post from the app.
5. **Redirect URL.** On the **Auth** tab, add `http://localhost:3000/api/linkedin/callback` under *Authorized redirect URLs for your app*. It must match exactly.
6. **Keys.** Copy the Client ID and Primary Client Secret from the **Auth** tab into `.env` (see below), restart `pnpm dev`, then click **Connect LinkedIn** on the LinkedIn page.

**Connect LinkedIn** asks only for `openid profile email` (name, email, photo). Posting is a separate step: once **Share on LinkedIn** is added to your app, click **Enable posting** on the LinkedIn page, which also asks for `w_member_social`. If LinkedIn refuses that, your existing connection stays as it was.

## Posting to LinkedIn (optional)

Once connected and **Enable posting** is done, a **Post to LinkedIn** button appears under a finished post on the Generate page. It opens a preview of the exact text, a character count (LinkedIn allows 3,000), a choice of **Anyone** or **Connections only**, and a final confirmation. Nothing is posted until you click **Post** in that dialog.

After posting you get a **View on LinkedIn** link and an **Undo** button that deletes the post from LinkedIn again.

## Images, scheduling and automatic posting

**Images.** In the post editor, add your own PNG, JPG or GIF images (up to 20, 10 MB each), or generate one: write a prompt or click **Suggest from post**, pick Landscape, Square or Portrait, and generate. Images are made on your own computer with FLUX.2 Klein 4B (Apache 2.0), so they're free. Images are stored in `data/images`.

**Designed cards** (the default in the editor) turn a post into an eye-catching image: a label, a short hook, up to four key points and a simple 2D cartoon, laid out on a grid in Portrait (1080×1350) or Square, in one of four color themes. **Write from post** fills in the text with the text model; edit anything, then **Make card**. The cartoon has no words in it: the text is drawn by the app (Poppins), so it's always crisp and spelled right, and editing the text redraws the card instantly with the same cartoon. Automatic posting can add a card to each post too. **Picture only** makes a plain image from your own prompt.

The app picks an image engine by itself: **mflux** on Macs with Apple silicon, **ComfyUI** everywhere else. Set `IMAGE_ENGINE` to choose (`mflux`, `comfyui` or `ollama`).

*Mac (mflux).* In a terminal:

```bash
brew install uv
uv tool install --upgrade mflux
uv tool update-shell   # then open a new terminal
mflux-generate-flux2 --model flux2-klein-4b --prompt "a coffee cup on a desk" --steps 4 -q 8 --width 512 --height 512 --output ~/Desktop/test.png
```

The last command makes a test image and downloads the model the first time (about 15 GB). Works on 16 GB Macs; before each image the app unloads the text model from Ollama to free memory.

*Windows or Linux (ComfyUI).* Needs an NVIDIA graphics card with about 8 GB or more.

1. Install the ComfyUI desktop app from [comfy.org](https://www.comfy.org/download) and open it.
2. In ComfyUI, open **Templates**, load **Flux.2 Klein 4B Text to Image**, and let it download the model files (`flux-2-klein-4b.safetensors`, `qwen_3_4b.safetensors`, `flux2-vae.safetensors`). Run it once to check it works.
3. Keep ComfyUI open while you use the app. The desktop app listens on `http://127.0.0.1:8000`; if yours runs elsewhere (the portable version uses 8188, or another PC on your network), set `COMFYUI_URL`.

To use your own ComfyUI workflow instead of the built-in one, export it with **Export (API)**, write `{{prompt}}`, `{{width}}`, `{{height}}` and `{{seed}}` where those go, and set `COMFYUI_WORKFLOW` to the file.

*Ollama.* Ollama had experimental image generation on macOS but turned it off after version 0.32.5. If it returns, set `IMAGE_ENGINE=ollama` and `ollama pull x/flux2-klein`.

**Post later.** Pick a date and time and click **Schedule**. The app checks every 30 seconds and posts it when it's due. This only works while the app is running (`pnpm dev` or `pnpm start`) on a computer that's awake. If it was off at that time, the post goes out when you start the app again, up to 12 hours late; after that it's marked as missed so you can post or reschedule it.

**Automatic posting.** On the Posts page, set how often (every day, every 3 days or every week), the time, a list of topics, and the audience, tone and length. Each run writes a post about the next topic (and an image, if switched on). By default it's saved as a draft for you to review; choose **Post it right away** to post without review. **Write one now** always saves a draft. Like scheduled posts, runs only happen while the app is running; a run more than 12 hours late is skipped.

## Jobs

The **Find jobs** tab on the Jobs page suggests job titles from your profile, searches job boards through their public APIs and lists the jobs right there:

- [Himalayas](https://himalayas.app) and [Jobicy](https://jobicy.com): remote jobs, no setup.
- [Adzuna](https://www.adzuna.com): jobs in Australia, the UK, the US and 16 other countries. Optional: get a free key at [developer.adzuna.com](https://developer.adzuna.com) and set `ADZUNA_APP_ID` and `ADZUNA_APP_KEY`.

Results are ranked by how many of your skills and titles they mention. Click a job to read its details, and **Save to my jobs** adds it to your list with its description. **Save this search** keeps it: run it again later and the jobs that are new since last time are marked. LinkedIn has no job search API for personal apps, and Draftfox doesn't scrape any site. Only the search words and country are sent to the job boards.

You can also add a job by hand: paste the title, company, link and description. On a job's page:

- **Fit with your profile** lists what the job asks for that your profile shows (with where it's shown) and what your profile doesn't show.
- **Cover letter** is written from what matches. Requirements your profile doesn't show are left out of the letter and listed for you, so you decide what to say. Edit it on the page and copy it.
- **Application questions**: paste the form's questions, one per line. Answers use only your profile; questions it can't answer (salary, notice period, a skill you haven't listed) are left blank with a note.
- **Keywords from the job**: the tools and skills it names, split into the ones your profile mentions and the ones it doesn't, so you can add the ones that are true.
- **CV for this job**: your CV reordered and reworded for the job, with nothing new added. Edit it, then download it as a Word .docx (the cover letter downloads too).
- **Interview prep**: questions the job is likely to bring up, answers from your experience, and what to prepare yourself.
- **Follow-up email**: a follow-up after applying or a thank-you after an interview. Copy it or open it in your email app; Draftfox never sends email.
- **Contacts** (name, role, email, LinkedIn link) and **offer details** (salary, leave, benefits and so on). **Compare offers** shows offers side by side.
- **Status** (saved, applied, interview, offer, rejected) with the date of each change, a next-step date and notes.

Everything is written from the Profile page, so fill it in, import your LinkedIn data, or paste or import your CV (.docx or .txt) there first. Numbers or names in a draft that aren't in your profile are flagged for you to check. **Open the job to apply** opens the posting in your browser; Draftfox never applies for you.

On the Jobs page, **Next steps** lists jobs whose next-step date is today or past, the ones coming up this week, and applications with no answer after a week. **Export to CSV** downloads your list for Excel or Google Sheets, and saving the same job twice (same link, or same title and company) asks first. **Write an "open to work" post** drafts a LinkedIn post from your profile and saves it on the Posts page; nothing is posted until you choose to. The Reports page shows applications per week, replies, interviews and offers.

## Reports and LinkedIn analytics

The Reports page is built from what the app records on your computer: each generation, plus an activity log in `data/app.db` (posts published or deleted, drafts copied, LinkedIn connected, profile and prompt changes). Only a post's first line is logged, never the full text. If you imported your LinkedIn data, it also shows how many posts you wrote per month.

It can't show impressions, reactions, comments, followers or profile views. LinkedIn only offers those through its Member Post Analytics and Member Follower Statistics APIs (`r_member_postAnalytics`, `r_member_profileAnalytics`), which are part of the **Community Management API**. LinkedIn grants that by manual review to registered companies only (business email, legal name, address, website, privacy policy, and a verifying LinkedIn Page), on a new developer app with no other products. Sign In with LinkedIn and Share on LinkedIn don't include any analytics. Until then, see your numbers at [linkedin.com/analytics/creator/content](https://www.linkedin.com/analytics/creator/content/).

## Settings

Copy `.env.example` to `.env` and fill in what you need. Everything is optional.

| Variable | Default | What it's for |
| --- | --- | --- |
| `OLLAMA_URL` | `http://localhost:11434` | Where Ollama is running |
| `OLLAMA_MODEL` | `gemma4:12b` | Which model writes the posts (download it first with `ollama pull <model>`) |
| `IMAGE_ENGINE` | `mflux` on Apple silicon Macs, otherwise `comfyui` | What makes images: `mflux`, `comfyui` or `ollama` |
| `MFLUX_MODEL` | `flux2-klein-4b` | mflux model (`flux2-klein-9b` is better but needs more memory) |
| `MFLUX_QUANTIZE` | `8` | mflux quantization (`4` uses less memory) |
| `MFLUX_COMMAND` | `mflux-generate-flux2` | Path to the mflux command, if it isn't found |
| `COMFYUI_URL` | `http://127.0.0.1:8000` | Where ComfyUI runs |
| `COMFYUI_WORKFLOW` | none | Your own ComfyUI workflow (API format) with `{{prompt}}`, `{{width}}`, `{{height}}`, `{{seed}}` |
| `OLLAMA_IMAGE_MODEL` | `x/flux2-klein` | Image model when `IMAGE_ENGINE=ollama` |
| `LINKEDIN_CLIENT_ID` | none | Client ID of your LinkedIn app |
| `LINKEDIN_CLIENT_SECRET` | none | Primary Client Secret of your LinkedIn app. Keep it secret. |
| `LINKEDIN_REDIRECT_URI` | `http://localhost:3000/api/linkedin/callback` | Must match the redirect URL in your LinkedIn app |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | none | Free Adzuna API key, so Find jobs also searches local (not only remote) jobs |
| `LINKEDIN_API_BASE` | `https://api.linkedin.com` | Only for tests: points posting at a fake LinkedIn server |

`.env` is gitignored.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the app at http://localhost:3000 |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm typecheck` | Type-check the project |
| `pnpm test:jobs` | Check fit, write a cover letter and answer questions for a sample profile and job in `scripts/test-jobs.ts`, printing the results |
| `pnpm test:posts` | Generate posts from the sample inputs in `scripts/test-posts.ts` and save them to `outputs/` for side-by-side comparison |

## Where data is stored

Everything stays on your computer in the `data/` folder, which is gitignored:

- `data/settings.json`: your edited system prompt, if you changed it.
- `data/profile.json`: your profile facts, CV text and past posts, if you added them. "Delete all profile data" removes it.
- `data/linkedin.json`: your LinkedIn name, email, photo URL and access token, if you connected. Disconnecting deletes it.
- `data/app.db`: a small SQLite database (Node's built-in `node:sqlite`, nothing to install) that keeps what you're working on: the Generate form and current draft, unsaved edits on the Prompt and Profile pages, each generated post, and the jobs you track on the Jobs page. Generation runs on the server, so it keeps going if you switch pages or reload. They come back when you switch pages or reload. "Start over" on Generate clears the draft; Save or Discard changes clears the unsaved edits.

Comparison runs from `pnpm test:posts` go to `outputs/`, also gitignored.

## Privacy

Draftfox runs on your computer and has no server of its own. Your profile, drafts, images, settings and your LinkedIn access token stay in the `data/` folder on your machine; nothing is sent to the project or anyone else. Text and images are made by local models (Ollama, mflux or ComfyUI). The only things that leave your computer are what you publish to LinkedIn, through your own LinkedIn developer app, the search words and country you send to job boards from Find jobs, and the one-time model downloads.

## Not affiliated with LinkedIn

Draftfox is an independent open-source project. It is not affiliated with, endorsed by or sponsored by LinkedIn Corporation or Microsoft. LinkedIn is a trademark of LinkedIn Corporation. You use the LinkedIn API through your own developer app and are responsible for following the [LinkedIn API Terms of Use](https://www.linkedin.com/legal/l/api-terms-of-use) and the [User Agreement](https://www.linkedin.com/legal/user-agreement), including when you use automatic posting.

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability.

## License

[MIT](LICENSE)
