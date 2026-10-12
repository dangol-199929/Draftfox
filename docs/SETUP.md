# Draftfox setup guide

A step-by-step guide for setting up Draftfox on a **Mac** or a **Windows PC**, even if you've never used a terminal. Follow your computer's section from top to bottom. If something goes wrong, check [Common errors and fixes](#common-errors-and-fixes) at the end.

What you'll end up with: Draftfox running in your browser at http://localhost:3000, writing LinkedIn posts with an AI model on your own computer. Images and LinkedIn posting are optional extras.

- [Minimum requirements](#minimum-requirements)
- [Mac setup](#mac-setup)
- [Windows setup](#windows-setup)
- [Connect LinkedIn (optional, Mac and Windows)](#connect-linkedin-optional-mac-and-windows)
- [Starting Draftfox again later](#starting-draftfox-again-later)
- [Common errors and fixes](#common-errors-and-fixes)

---

## Minimum requirements

| | Writing posts (required) | Making images on a Mac (optional) | Making images on Windows (optional) |
|---|---|---|---|
| **Computer** | Mac with Apple silicon or Intel, or a Windows 10/11 64-bit PC | Mac with Apple silicon (M1, M2, M3, M4 or newer) | Windows PC with an NVIDIA graphics card |
| **Memory (RAM)** | 16 GB recommended. 8 GB works with a smaller model ([see below](#posts-are-very-slow-or-the-computer-freezes)) | 16 GB | 16 GB, plus **8 GB of graphics memory (VRAM)** on the NVIDIA card |
| **Free disk space** | 10 GB | about 16 GB more | about 16 GB more |
| **Internet** | Only for downloading the app and the AI models once | Same | Same |

Good to know:

- After the downloads, Draftfox works offline. It costs nothing to use: no AI subscriptions or API keys.
- On Windows without an NVIDIA card, Draftfox still writes posts (more slowly, on the processor) and can make **designed cards with text only**, just without the cartoon.
- Intel Macs can write posts but can't make AI images.

---

## Mac setup

You'll type a few commands into **Terminal**. To open it: press `Cmd + Space`, type **Terminal**, press `Enter`. Copy each command below, paste it into Terminal with `Cmd + V`, and press `Enter`. Wait until it finishes (you see the prompt again) before the next one.

### Step 1: Install Homebrew

Homebrew installs the other tools. Skip this step if `brew --version` already prints a version.

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

It asks for your Mac password (nothing shows while you type; that's normal). When it finishes, it prints **Next steps** with two or three commands starting with `echo` and `eval`. **Copy and run those too**, then close Terminal and open it again.

### Step 2: Install Node.js, pnpm and Git

```bash
brew install node pnpm git
```

Check it worked. This should print `v24` or higher:

```bash
node --version
```

### Step 3: Install Ollama (runs the AI model)

1. Download Ollama for macOS from [ollama.com/download](https://ollama.com/download).
2. Open the downloaded file and drag **Ollama** into **Applications**.
3. Open Ollama from Applications. A small llama icon appears in the menu bar at the top of the screen. Leave it running.

### Step 4: Download the AI model

This downloads about 8 GB, so it can take a while.

```bash
ollama pull gemma4:12b
```

### Step 5: Download Draftfox

This puts Draftfox in a folder called `Draftfox` in your home folder.

```bash
cd ~ && git clone https://github.com/dangol-199929/Draftfox.git && cd Draftfox
```

### Step 6: Install and start Draftfox

```bash
pnpm install
```

```bash
cp .env.example .env
```

```bash
pnpm dev
```

When you see `Ready`, open **http://localhost:3000** in your browser. That's it: go to **Generate**, type a topic and click **Generate**.

Keep the Terminal window open while you use Draftfox. Closing it stops the app.

### Step 7 (optional): AI images on Apple silicon Macs

Open a **new** Terminal window (`Cmd + N`) and run these one at a time:

```bash
brew install uv
```

```bash
uv tool install --upgrade mflux
```

```bash
uv tool update-shell
```

Close Terminal, open it again, then make a test image. The first time, this downloads the image model (about 15 GB):

```bash
mflux-generate-flux2 --model flux2-klein-4b --prompt "a coffee cup on a desk" --steps 4 -q 8 --width 512 --height 512 --output ~/Desktop/test.png
```

When `test.png` appears on your Desktop, images work in Draftfox too: open a post on the **Posts** page and use **Designed card** or **Picture only**.

---

## Windows setup

You'll type a few commands into **PowerShell**. To open it: click **Start**, type **PowerShell**, and click **Windows PowerShell**. Copy each command below, paste it with a right-click (or `Ctrl + V`), and press `Enter`. Wait until it finishes before the next one.

### Step 1: Install Node.js

1. Go to [nodejs.org](https://nodejs.org) and download the **Windows Installer (.msi)** for version **24** or newer.
2. Run it and click **Next** through the steps, keeping the default options.

### Step 2: Install Git

1. Download Git from [git-scm.com/download/win](https://git-scm.com/download/win).
2. Run it and click **Next** through the steps, keeping the default options.

**Close PowerShell and open it again** so it notices the new tools. Then check both worked (each prints a version):

```powershell
node --version
```

```powershell
git --version
```

### Step 3: Install pnpm

```powershell
npm install -g pnpm
```

If you see "running scripts is disabled on this system", see [that error](#pnpm-cannot-be-loaded-because-running-scripts-is-disabled-windows).

### Step 4: Install Ollama (runs the AI model)

1. Download Ollama for Windows from [ollama.com/download](https://ollama.com/download).
2. Run **OllamaSetup.exe**. When it finishes, an Ollama icon appears in the system tray (bottom-right, near the clock). Leave it running.

### Step 5: Download the AI model

This downloads about 8 GB, so it can take a while.

```powershell
ollama pull gemma4:12b
```

### Step 6: Download Draftfox

This puts Draftfox in a folder called `Draftfox` in your user folder.

```powershell
cd ~; git clone https://github.com/dangol-199929/Draftfox.git; cd Draftfox
```

### Step 7: Install and start Draftfox

```powershell
pnpm install
```

```powershell
Copy-Item .env.example .env
```

```powershell
pnpm dev
```

When you see `Ready`, open **http://localhost:3000** in your browser. Go to **Generate**, type a topic and click **Generate**.

Keep the PowerShell window open while you use Draftfox. Closing it stops the app. If Windows Firewall asks about Node.js, click **Cancel** or allow only **Private networks**; Draftfox only needs your own computer.

### Step 8 (optional): AI images with ComfyUI (NVIDIA graphics card)

1. Download the **ComfyUI desktop app** for Windows from [comfy.org/download](https://www.comfy.org/download) and install it with the default options. Choose **NVIDIA** when it asks about your graphics card.
2. Open ComfyUI. In the left sidebar, open **Templates**, find **Flux.2 Klein 4B Text to Image** and open it.
3. ComfyUI offers to download the missing model files (about 15 GB). Click **Download** and wait until all three finish.
4. Click **Run** once to check that an image appears.
5. Keep ComfyUI open while you use Draftfox. Then open a post on the **Posts** page and use **Designed card** or **Picture only**.

The ComfyUI desktop app listens on port 8000, which Draftfox expects. If you use the portable version of ComfyUI instead, open `.env` in Notepad (`notepad .env`) and change the line to `COMFYUI_URL=http://127.0.0.1:8188`, then restart Draftfox.

---

## Connect LinkedIn (optional, Mac and Windows)

Without this you can still write posts and copy them into LinkedIn yourself. Connecting lets Draftfox post, schedule and post automatically for you.

1. **Company Page.** LinkedIn developer apps must belong to a Company Page. If you don't manage one, create a free page: on linkedin.com click **For Business**, then **Create a Company Page**.
2. **Developer app.** Go to [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps), click **Create app**, choose your Company Page and upload any square logo. Don't use the word "LinkedIn" in the app name.
3. **Verify.** On the app's **Settings** tab, click **Verify** and approve it as the page admin.
4. **Products.** On the **Products** tab, add **Sign In with LinkedIn using OpenID Connect** and **Share on LinkedIn**.
5. **Redirect URL.** On the **Auth** tab, under *Authorized redirect URLs for your app*, add exactly:
   ```
   http://localhost:3000/api/linkedin/callback
   ```
6. **Keys.** Still on the **Auth** tab, copy the **Client ID** and **Primary Client Secret**. Open the `.env` file in the Draftfox folder (`open -e .env` on a Mac, `notepad .env` on Windows) and fill them in:
   ```
   LINKEDIN_CLIENT_ID=paste-the-client-id
   LINKEDIN_CLIENT_SECRET=paste-the-secret
   ```
   Save the file. Never share it or upload it anywhere.
7. **Restart Draftfox.** In the Terminal or PowerShell window where it runs, press `Ctrl + C`, then run `pnpm dev` again.
8. **Connect.** In Draftfox, open the **LinkedIn** page, click **Connect LinkedIn** and approve. Then click **Enable posting**.

Nothing is ever posted unless you confirm it, schedule it, or turn on automatic posting yourself.

---

## Starting Draftfox again later

1. Make sure **Ollama** is running (menu bar on a Mac, system tray on Windows). For images, open **ComfyUI** too on Windows.
2. Open Terminal (Mac) or PowerShell (Windows) and run:
   ```bash
   cd ~/Draftfox
   ```
   ```bash
   pnpm dev
   ```
3. Open http://localhost:3000.

Scheduled and automatic posts only go out while Draftfox is running. If it's off at that time, they go out when you start it again (up to 12 hours late).

To update to the newest version, stop Draftfox with `Ctrl + C`, then run `git pull` and `pnpm install` in the Draftfox folder, and start it again.

---

## Common errors and fixes

Find the message you see, or the closest one.

### Installing and starting

#### `command not found: brew` (Mac)

Homebrew's last step didn't run. Install Homebrew again (Mac step 1) and run the **Next steps** commands it prints at the end, then open a new Terminal.

#### `command not found: pnpm`, or `'pnpm' is not recognized as an internal or external command`

pnpm isn't installed yet, or the terminal was open before you installed it. Close the terminal and open a new one. If it still fails, run `brew install pnpm` (Mac) or `npm install -g pnpm` (Windows).

#### `pnpm cannot be loaded because running scripts is disabled` (Windows)

Windows blocks downloaded scripts by default. Allow them for your user only, then try again:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Type `Y` and press `Enter` if it asks.

#### `'git' is not recognized` or `command not found: git`

Install Git (Mac step 2 or Windows step 2), then open a new terminal.

#### `Unsupported engine`, `No such built-in module: node:sqlite`, or other errors right after `pnpm dev`

Your Node.js is too old. Draftfox needs version 24 or newer. Check with `node --version`.

- Mac: `brew upgrade node` (or `brew install node`). If you use nvm: `nvm install 24` then `nvm use 24`.
- Windows: install the newest version from [nodejs.org](https://nodejs.org), then open a new PowerShell.

Then run `pnpm install` again.

#### `Port 3000 is in use` or `EADDRINUSE`

Something else is using port 3000, often another copy of Draftfox in a different window. Close that window, or stop it with `Ctrl + C`. To use another port instead, run `pnpm dev -p 3001` and open http://localhost:3001 (LinkedIn connect then needs `http://localhost:3001/api/linkedin/callback` in both the LinkedIn app and `LINKEDIN_REDIRECT_URI` in `.env`).

#### `git clone` says `destination path 'Draftfox' already exists`

You already downloaded it. Just run `cd ~/Draftfox` and continue with the next step.

#### The browser says "This site can't be reached" at localhost:3000

Draftfox isn't running. Start it with `pnpm dev` in the Draftfox folder and wait for `Ready`. Keep that window open.

### Writing posts

#### "Ollama isn't running"

Open the Ollama app (Applications on a Mac, Start menu on Windows) and try again. If it still fails, run `ollama serve` in a new terminal and leave it open.

#### "The model isn't downloaded"

Run `ollama pull gemma4:12b` and wait for it to finish. If you changed `OLLAMA_MODEL` in `.env`, pull that model instead.

#### Posts are very slow, or the computer freezes

The model is too big for your computer's memory (common with 8 GB of RAM, or on Windows without a graphics card). Use a smaller model:

```bash
ollama pull gemma3:4b
```

Then set `OLLAMA_MODEL=gemma3:4b` in `.env` and restart Draftfox. Posts are a bit simpler but much faster. Closing other apps (especially browsers with many tabs) also helps.

#### The post says "NEED MORE CONTEXT" and asks questions

That's on purpose: the topic was too vague and Draftfox won't invent details. Answer the questions in **Your experience** and generate again.

### Images

#### "mflux isn't installed" or `command not found: mflux-generate-flux2` (Mac)

Run `uv tool update-shell`, then close Terminal and open a new one. If it's still missing, run `uv tool install --upgrade mflux` again. Draftfox also finds mflux on its own in `~/.local/bin`.

#### "mflux only runs on Macs with Apple silicon"

Your Mac has an Intel processor, which mflux doesn't support. You can still make **designed cards**: leave the **Cartoon** box empty to get a text-only card.

#### "Not enough memory to make the image" (Mac)

Close other apps and try again. If it keeps happening, add `MFLUX_QUANTIZE=4` to `.env` and restart Draftfox; it uses less memory with slightly lower quality.

#### "Hugging Face refused the model download" (Mac)

Sign in to Hugging Face once, then try again:

```bash
uvx --from huggingface_hub hf auth login
```

#### "The disk is full"

The image model needs about 15 GB free. Free up space (empty the Trash or Recycle Bin, delete large downloads) and try again.

#### "ComfyUI isn't running" or "Could not reach ComfyUI" (Windows)

Open the ComfyUI app and wait until it's fully loaded, then try again. If you use the portable version, set `COMFYUI_URL=http://127.0.0.1:8188` in `.env` and restart Draftfox.

#### "ComfyUI doesn't have the FLUX.2 Klein model files" (Windows)

In ComfyUI, open **Templates**, load **Flux.2 Klein 4B Text to Image** and let it download the files (Windows step 8).

#### "This ComfyUI is too old for FLUX.2 Klein"

Update ComfyUI by downloading and installing the latest version from [comfy.org/download](https://www.comfy.org/download), then try again.

#### "The graphics card ran out of memory" (Windows)

Close games and other apps that use the graphics card, choose **Square** or **Portrait** instead of a large shape, and try again. 8 GB of graphics memory is the minimum.

#### "This version of Ollama can't make images"

Ollama has turned its own image generation off for now, so Draftfox uses mflux (Mac) or ComfyUI (Windows) instead. Remove `IMAGE_ENGINE=ollama` from `.env` if you added it, and set up images with Mac step 7 or Windows step 8.

### LinkedIn

#### "LinkedIn isn't set up yet"

The Client ID and secret aren't in `.env`, or Draftfox wasn't restarted after you added them. See [Connect LinkedIn](#connect-linkedin-optional-mac-and-windows), steps 6 and 7.

#### LinkedIn shows "The redirect_uri does not match the registered value"

The redirect URL in your LinkedIn app must be exactly `http://localhost:3000/api/linkedin/callback`: `http` (not `https`), `localhost` (not `127.0.0.1`), and no slash at the end.

#### "LinkedIn refused the requested permissions" or `unauthorized_scope_error`

Add **Sign In with LinkedIn using OpenID Connect** on the app's **Products** tab, wait a minute, and connect again.

#### "Couldn't enable posting" or "Posting isn't enabled"

Add **Share on LinkedIn** on the app's **Products** tab, then click **Enable posting** on Draftfox's LinkedIn page.

#### "Your LinkedIn access has expired"

LinkedIn sign-ins last about 60 days. Open the LinkedIn page in Draftfox and click **Reconnect** (then **Enable posting** again if needed).

#### "LinkedIn says too many requests"

Wait a while (up to a day) and try again.

#### A scheduled post says "Missed"

Draftfox wasn't running at the scheduled time and more than 12 hours have passed. Open the post and click **Post now** or schedule it again.

### Still stuck?

[Open an issue on GitHub](https://github.com/dangol-199929/Draftfox/issues) with what you did, the exact error message, and whether you're on a Mac or Windows. Never paste your `.env` file or secrets.
