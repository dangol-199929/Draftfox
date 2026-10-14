# About Draftfox

<img src="../src/app/icon.svg" alt="Draftfox logo" width="64" height="64">

**Draftfox is a free, private AI assistant for LinkedIn posts that runs entirely on your own computer.** It writes drafts in your voice, makes eye-catching images, and can post, schedule or post automatically, without AI subscriptions or sending your ideas to the cloud.

## Why it was built

Posting regularly on LinkedIn helps your career, but it's hard to keep up: finding the words takes time, and AI writing tools are often paid, send everything you type to someone else's servers, and produce generic posts full of invented claims.

Draftfox was built to fix that:

- **Free.** It uses open models that run on your own machine, so there are no subscriptions or per-post costs.
- **Private.** Your drafts, profile and images never leave your computer. Only the posts you choose to publish go to LinkedIn.
- **Honest.** It writes only from what you tell it. If a topic is too vague, it asks you questions instead of making things up.
- **Yours.** It learns your style from your own past posts and profile, and everything is open source, so you can see and change how it works.

## What you can do with it

- **Write a post in seconds.** Give it a topic and what actually happened. It writes a draft you can edit, in the length and tone you pick.
- **Sound like yourself.** Import your LinkedIn data so it knows your role and skills and copies the style of your past posts.
- **Add images that stop the scroll.** Make a designed card with a hook, key points and a simple cartoon, or a plain picture, or add your own photos.
- **Post now, later or automatically.** Publish straight to LinkedIn after a final preview, schedule a post for a date and time, or let it write a post every day, every 3 days or every week from your list of topics, either saved for your review or posted right away.
- **See your progress.** The Reports page shows how many drafts you've written and posted over time, which tones and lengths you use, and links to everything you published.
- **Apply for jobs with less busywork.** Paste a job you found and see how it fits your profile, with strengths and gaps. Get a cover letter and answers to application questions written only from your real experience, and track each job from saved to offer. You always open the job and click Apply yourself.

## Ways people use it

- **Job seekers and students** who want to stay visible to recruiters by sharing what they learn, and to tailor each application without inventing anything.
- **Developers and other professionals** who turn their work into short lessons, tips and stories.
- **Freelancers and founders** who want a steady posting schedule with a consistent visual style.
- **Anyone careful about privacy** who doesn't want to paste personal stories into an online AI tool.

## How it works, briefly

Draftfox is a small web app (Next.js) that runs at `localhost:3000` on your computer.

- **Text:** an open model (Gemma 12B by default) runs through [Ollama](https://ollama.com).
- **Images:** FLUX.2 Klein runs through [mflux](https://github.com/filipstrand/mflux) on Apple silicon Macs, or through [ComfyUI](https://www.comfy.org) on Windows with an NVIDIA graphics card. Card text is laid out by the app, so it's always crisp and spelled right.
- **LinkedIn:** you connect your account through your own LinkedIn developer app (Sign In with LinkedIn and Share on LinkedIn).
- **Storage:** drafts, settings and history live in a small database file in the `data/` folder on your computer.

LinkedIn doesn't give personal apps access to post analytics (views, reactions, followers), so those stay on LinkedIn itself.

## Get started

Follow the [setup guide](SETUP.md) for Mac or Windows. Draftfox is open source under the [MIT License](../LICENSE) and isn't affiliated with LinkedIn.
