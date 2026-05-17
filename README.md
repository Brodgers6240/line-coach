# Line Coach — Setup & Deployment Guide

A web app that helps actors learn their lines for **The Last Supper** and **The Passion**. Works on iPhone, totally free.

## What you have

Files in the `line-coach/` folder:

1. **`index.html`** — the app itself (UI, speech recognition, audio playback, text-to-speech fallback).
2. **`scripts.js`** — both scripts parsed into structured data.
3. **`generate_audio.py`** — a one-time script you run on your Mac to produce natural-sounding MP3 audio for every line. **You must run this once** before deploying; details in the "Generate the voices" section below.

After you've run `generate_audio.py`, the folder will also contain:

4. **`audio/`** — the MP3 files for every line. Roughly 10-30 MB.

No build step, no server code. Just files served as-is.

## What the actors will experience

1. Open the link in Safari on their iPhone.
2. Tap **Add to Home Screen** once — it then behaves like an app icon.
3. Pick a production (Last Supper or Passion).
4. Tap their assigned character.
5. Pick a difficulty:
   - **Easy** — full line shown while they read it
   - **Medium** — only the first letter of each word shown
   - **Hard** — just blanks; they see only how many words
6. Tap **Start rehearsal**. The app reads other characters' lines aloud in distinct voices. When their character's turn comes up, they tap the mic and speak. The app shows a word-by-word check (green = right, red = wrong, gray = missed, yellow = extra).

---

# Generate the voices (one-time, on your Mac)

The app plays a pre-rendered MP3 of each line so every iPhone hears the same human-sounding voice (no relying on iOS's robot voices). You generate those MP3s once with a small Python script.

1. Open **Terminal** (Cmd+Space → type "Terminal" → Enter).
2. Move into your `line-coach` folder. Easiest way: type `cd ` (with a trailing space), then **drag the `line-coach` folder from Finder into the Terminal window** — Terminal will fill in the path. Then press Enter.
3. Install the TTS library (one-time):

   ```
   pip3 install --user edge-tts
   ```

   If `pip3` isn't found, install Xcode Command Line Tools first: `xcode-select --install` and re-try.

4. Run the script:

   ```
   python3 generate_audio.py
   ```

5. It'll print one line per file as it generates. Total time: about **8-15 minutes** for the first run. If interrupted, just re-run — already-rendered files are skipped.
6. When it finishes, you'll have an `audio/` folder full of MP3s, and `scripts.js` will have been updated to reference them.

Listen to a few of the MP3s by double-clicking them in Finder to confirm the voices sound good. They should sound like the voices in Edge's "Read Aloud" feature — natural, distinct per character.

If you want to change a character's voice, edit the `VOICES` dictionary at the top of `generate_audio.py`, delete the matching MP3s in `audio/`, and re-run the script. Get the full voice list by running `edge-tts --list-voices` after install.

---

# Deployment: Step-by-Step

You'll host the files on **GitHub Pages**, which is free and gives you a shareable URL.

## Step 1 — Create a GitHub account (skip if you have one)

1. Go to **https://github.com/signup**.
2. Use your email, pick a username (it will appear in your URL — something like `brandon-tr` is fine), pick a password.
3. Verify your email when GitHub sends the confirmation.

## Step 2 — Create a new repository

1. Once signed in, click the **+** icon in the top-right corner of GitHub → **New repository**.
2. **Repository name:** `line-coach` (lowercase, hyphen).
3. **Description:** "Line learning app for Last Supper and Passion" (optional).
4. Select **Public** (required for free GitHub Pages).
5. Check **Add a README file** — this is important; it creates an initial commit so the next steps work.
6. Click the green **Create repository** button.

## Step 3 — Upload the files

1. On your new repo's page (`https://github.com/<your-username>/line-coach`), click **Add file** → **Upload files**.
2. **Drag the entire contents of your `line-coach` folder** onto the upload area. That includes:
   - `index.html`
   - `scripts.js` (the updated one with audioFile paths)
   - the entire `audio/` folder (with all its subfolders)
   - `README.md` (optional but nice to keep)
   - `generate_audio.py` (optional — keep so you can re-render if needed)

   GitHub preserves the folder structure when you drag a whole folder.
3. The upload may take 1-2 minutes because of the audio files.
4. Scroll down to the "Commit changes" box, leave the default message (or type "Add app files").
5. Click the green **Commit changes** button.

You should now see `index.html`, `scripts.js`, `audio/`, etc. listed in your repo.

> **Tip:** if your audio folder is over GitHub's 100 MB single-file limit (it shouldn't be — MP3s are small), use GitHub Desktop instead. But normal MP3 lines are 30-200 KB each, so you'll be fine.

## Step 4 — Turn on GitHub Pages

1. On the repo page, click **Settings** (top right of the row of tabs).
2. In the left sidebar, click **Pages**.
3. Under **Source**, select **Deploy from a branch**.
4. Under **Branch**, select **main** and **/(root)**, then click **Save**.
5. Wait ~1 minute. Refresh the page. You'll see a green box:
   *"Your site is live at `https://<your-username>.github.io/line-coach/`"*

That URL is the one you share with actors.

## Step 5 — Test it on your iPhone

1. Open **Safari** (this matters — Chrome on iPhone doesn't support speech recognition the same way).
2. Visit the URL.
3. Tap **The Last Supper** → tap a character (try **Peter** — 6 lines) → tap **Easy** → tap **Start rehearsal**.
4. The app will read the first line aloud. When Peter's line comes up, tap the **🎤 Tap to speak** button. Safari will ask for microphone permission the first time — say **Allow**.
5. Speak Peter's line. You'll see the word-by-word match.

## Step 6 — "Install" it on the home screen

This is what makes it feel like an app:

1. With the app open in Safari, tap the **Share** icon (the square with an up arrow at the bottom of the screen).
2. Scroll down in the share sheet and tap **Add to Home Screen**.
3. Name it "Line Coach" → tap **Add**.
4. It now lives on the home screen with an icon and opens in full-screen, with no Safari toolbar.

Send the URL plus these 4 steps to every actor.

---

# Updating the app later

**To change a line's text** (fix a typo, etc.):

1. On your Mac, edit `scripts.js` — find the line, change the `text` field.
2. Delete the matching MP3 from `audio/<production>/` so the script will re-render it.
3. Run `python3 generate_audio.py` to regenerate that line.
4. Upload the new `scripts.js` and the new MP3 to GitHub (Add file → Upload files; overwrite).
5. The hosted site updates within ~30 seconds.

**To change a character's voice**:

1. Edit `VOICES` in `generate_audio.py` — change the value for that character to a different edge-tts voice (get the full list with `edge-tts --list-voices`).
2. Delete all MP3s for that character from `audio/<production>/` (filenames include the character name).
3. Run `python3 generate_audio.py` again.
4. Upload the new MP3s to GitHub.

**To change the app's behavior or UI**:

- Edit `index.html` on GitHub (pencil icon → edit → commit). Or edit locally and re-upload.

---

# Troubleshooting

**"Mic doesn't work / nothing happens when I tap it"**
- Must be Safari on iOS (not Chrome, not Firefox on iPhone). Speech recognition uses Safari's WebKit API.
- iOS must be 14.5 or newer.
- Make sure the microphone permission wasn't denied: Settings → Safari → Microphone → Allow.
- If the actor is in an area with no internet, recognition may be unreliable (iOS uses on-device recognition when available, server-based otherwise).

**"Voices sound robotic"**
- This means the pre-rendered MP3s aren't loading and the app is falling back to iOS's built-in voice. Likely causes:
  - You forgot to upload the `audio/` folder to GitHub, or only some of it uploaded.
  - You're trying to use the app offline. The MP3s are served from GitHub Pages, so you need network.
  - You uploaded the audio folder but `scripts.js` doesn't have the updated `audioFile` paths. Re-run `generate_audio.py` and re-upload `scripts.js`.
- Verify by opening one of the MP3 URLs directly in a browser: `https://<your-username>.github.io/line-coach/audio/last_supper/0001_jesus.mp3` — it should play.

**"One specific character sounds wrong"**
- Edit the `VOICES` dictionary in `generate_audio.py` (change the voice for that character to a different `edge-tts` voice), delete that character's MP3s from `audio/`, re-run the script, re-upload.

**"The app reads stage directions out loud"**
- It shouldn't — only spoken lines are voiced. Stage directions are shown in italic gray and you tap **Next** to skip past them. Tell me if you see exceptions.

**"It thinks I said the wrong words"**
- Speech recognition isn't perfect, especially with religious / archaic vocabulary ("Pharisee", "Caiaphas", "Gethsemane"). Treat the percentage as a guide, not a verdict. Tap **Show the line** if you want to confirm. The diff is more useful for catching missed phrases than for grading.

**"A line is wrong / a character is mislabeled"**
- The scripts were parsed automatically from the .docx and .pdf. If you spot an error, edit `scripts.js` on GitHub directly (search for the wrong word, fix it, commit), or send me the correction and I'll redo the parse.

**"I want to add a third production later"**
- The data shape is simple. Each production has a list of scenes; each scene has a list of items where `type` is either `"line"` (with `character` + `text`) or `"direction"` (with just `text`). Add a new key under `window.SCRIPTS` and add a card to the Home view in `index.html`.

---

# Privacy note for actors

- The mic only listens while the actor holds it active. The audio is processed by Apple on the device (iOS 14.5+); nothing is sent to anyone else's server. No accounts, no signups, no data stored.
- The app stores nothing between sessions — every refresh starts at the home screen.

---

# Want me to host it for you?

If GitHub feels like a lot, the alternative is **Netlify Drop** (https://app.netlify.com/drop):

1. Sign in (use GitHub or email).
2. Drag the `line-coach` folder onto the page.
3. It instantly gives you a URL like `eloquent-tesla-12345.netlify.app`.
4. Optional: in the site settings, rename the subdomain to something like `tm-passion-lines.netlify.app`.

Same free tier; no commit/push workflow.
