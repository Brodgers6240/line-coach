#!/usr/bin/env python3
"""
generate_audio.py — One-time audio generation for Line Coach.

What it does:
  - Reads scripts.js (right next to this file).
  - For every spoken line in both productions, generates a natural-sounding MP3
    using Microsoft's edge-tts service (free, no API key, no signup).
  - Saves MP3s under ./audio/<production>/####_<character>.mp3
  - Rewrites scripts.js so each line has an "audioFile" path the app can play.

How to run (on your Mac):

  1. Open Terminal (Cmd+Space, type "Terminal", press Enter).
  2. Navigate into the line-coach folder. If it's in your Downloads:
        cd ~/Downloads/line-coach
     (Or drag the line-coach folder into Terminal after typing "cd " — Terminal
      will fill in the path for you.)
  3. Install edge-tts (one-time):
        pip3 install --user edge-tts
  4. Run this script:
        python3 generate_audio.py

  Expected time: roughly 8-15 minutes (185 lines, generated in parallel).
  Expected output: ~10-30 MB of MP3 files inside an "audio/" folder.

After it finishes, upload:
  - the entire "audio/" folder
  - the updated "scripts.js"
to your GitHub repo. See README.md for details.

If anything fails, scroll up in Terminal for the error and send it back.
"""

import asyncio
import json
import os
import pathlib
import re
import sys

try:
    import edge_tts
except ImportError:
    sys.exit(
        "ERROR: edge-tts is not installed.\n"
        "Run this first:  pip3 install --user edge-tts\n"
        "Then run this script again."
    )

# ---------- Character → Voice assignment ----------
# Distinct natural voices for every character across BOTH scripts.
# All voices are free, served by Microsoft's edge-tts.
# Full voice list: run `edge-tts --list-voices` after install.
VOICES = {
    # ----- Last Supper -----
    "Jesus":                "en-US-RogerNeural",          # warm, deep, calm male
    "Peter":                "en-US-BrianNeural",          # gruff, expressive male
    "John":                 "en-NZ-MitchellNeural",       # warm, friendly male (NZ)
    "Andrew":               "en-US-GuyNeural",            # steady male
    "James":                "en-US-ChristopherNeural",    # firm male
    "James the Lesser":     "en-HK-SamNeural",            # softer male (HK English)
    "Judas":                "en-US-SteffanNeural",        # narrow, distinct male
    "Matthew":              "en-US-EricNeural",           # warm reflective male
    "Philip":               "en-ZA-LukeNeural",           # measured male (SA English)
    "Thaddeus":             "en-US-AndrewNeural",         # storytelling male
    "Simon":                "en-GB-RyanNeural",           # British male
    "Nathaniel":            "en-AU-WilliamNeural",        # Australian male
    "Thomas":               "en-IE-ConnorNeural",         # Irish male
    "Carpenter":            "en-GB-ThomasNeural",         # British male
    "Carpenter apprentice": "en-CA-LiamNeural",           # Canadian younger male
    "Narrator":             "en-US-AndrewMultilingualNeural",

    # ----- Passion (shared characters reuse the same voice for continuity) -----
    "Pilate":                    "en-GB-RyanNeural",
    "Caiaphas":                  "en-US-EricNeural",
    "Pharisee":                  "en-GB-ThomasNeural",
    "Pharisee #2":               "en-AU-WilliamNeural",
    "Temple Guard":              "en-PH-JamesNeural",     # commanding male
    "False Witness":             "en-IN-PrabhatNeural",   # distinct, slightly evasive
    "Rest of Men":               "en-US-GuyNeural",
    "Centurion":                 "en-US-ChristopherNeural",
    "Centurion and Roman Guard": "en-US-ChristopherNeural",
    "Roman Guard":               "en-NG-AbeoNeural",      # deep, commanding
    "Roman Guards":              "en-US-GuyNeural",
    "Traveling Man #1":          "en-CA-LiamNeural",
    "Traveling Man #2":          "en-IE-ConnorNeural",
    "Man at the Fire":           "en-AU-WilliamNeural",
    "Woman at the fire":         "en-GB-SoniaNeural",     # British female
    "Mary":                      "en-US-AriaNeural",      # warm female
    "Claudia":                   "en-US-JennyNeural",     # gentle female
    "Thief #1":                  "en-US-EricNeural",
    "Thief #2":                  "en-SG-WayneNeural",     # distinct male
    "Crowd":                     "en-US-GuyNeural",
    "Caiaphas and Crowd":        "en-US-EricNeural",
    "Someone in the Crowd":      "en-KE-ChilembaNeural",  # distinct anonymous voice
    "Someone else in the Crowd": "en-US-AndrewNeural",
}
DEFAULT_VOICE = "en-US-GuyNeural"

# Concurrency: how many lines to render in parallel. Don't crank this — be polite.
PARALLEL = 2

# How many times to retry a failed line before giving up.
# Microsoft's free service occasionally drops requests; retries clear these up.
MAX_RETRIES = 4


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return s or "char"


def clean_text_for_tts(text: str) -> str:
    """Strip parenthetical stage directions so they aren't spoken."""
    s = re.sub(r"\([^)]*\)", " ", text)
    s = re.sub(r"\s+", " ", s).strip()
    return s


async def render(text: str, voice: str, out_path: pathlib.Path, label: str):
    if out_path.exists() and out_path.stat().st_size > 1000:
        print(f"  ✓ (cached) {label}")
        return
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            comm = edge_tts.Communicate(text, voice)
            await comm.save(str(out_path))
            # Sanity check: the file actually has audio data
            if out_path.exists() and out_path.stat().st_size > 1000:
                tag = f"  + {label}   [{voice}]"
                if attempt > 1:
                    tag += f"  (retry {attempt})"
                print(tag)
                return
            else:
                # Empty file — treat as failure and retry
                if out_path.exists():
                    try: out_path.unlink()
                    except Exception: pass
                last_err = "empty audio response"
        except Exception as e:
            last_err = str(e)
            if out_path.exists():
                try: out_path.unlink()
                except Exception: pass
        # Backoff before retry
        await asyncio.sleep(1.5 * attempt)
    print(f"  ! FAILED after {MAX_RETRIES} tries: {label}: {last_err}")


async def main():
    here = pathlib.Path(__file__).resolve().parent
    scripts_path = here / "scripts.js"
    if not scripts_path.exists():
        sys.exit(
            f"ERROR: scripts.js not found in {here}\n"
            "Make sure generate_audio.py sits next to scripts.js and index.html."
        )

    raw = scripts_path.read_text(encoding="utf-8")
    m = re.search(r"window\.SCRIPTS\s*=\s*(\{[\s\S]*\})\s*;\s*$", raw.strip(), re.MULTILINE)
    if not m:
        sys.exit("ERROR: Could not find 'window.SCRIPTS = {...};' in scripts.js")
    data = json.loads(m.group(1))

    audio_root = here / "audio"
    audio_root.mkdir(exist_ok=True)

    # Gather every task first
    tasks = []
    line_count = 0
    for prod_key, prod in data.items():
        prod_dir = audio_root / prod_key
        prod_dir.mkdir(exist_ok=True)
        global_idx = 0
        for sc in prod["scenes"]:
            for item in sc["items"]:
                if item.get("type") != "line":
                    continue
                voice = VOICES.get(item["character"], DEFAULT_VOICE)
                text = clean_text_for_tts(item["text"])
                if not text:
                    item["audioFile"] = None
                    global_idx += 1
                    continue
                fname = f"{global_idx:04d}_{slugify(item['character'])}.mp3"
                out_path = prod_dir / fname
                rel = f"audio/{prod_key}/{fname}"
                item["audioFile"] = rel
                label = f"{prod_key}/{fname}  ({item['character']})"
                tasks.append((text, voice, out_path, label))
                line_count += 1
                global_idx += 1

    print(f"Total lines: {line_count}")
    print(f"Rendering with up to {PARALLEL} in parallel…\n")

    sem = asyncio.Semaphore(PARALLEL)

    async def bounded(t):
        async with sem:
            await render(*t)

    await asyncio.gather(*(bounded(t) for t in tasks))

    # Write scripts.js back
    new_js = (
        "// Auto-generated from Last Supper Script.docx + Passion Script_260407_180733.pdf\n"
        "// Audio paths added by generate_audio.py\n"
        "window.SCRIPTS = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n"
    )
    scripts_path.write_text(new_js, encoding="utf-8")

    # Summary
    total_size = 0
    for root, _, files in os.walk(audio_root):
        for f in files:
            total_size += (pathlib.Path(root) / f).stat().st_size
    print(
        f"\nDone.\n"
        f"  Lines rendered: {line_count}\n"
        f"  audio/ folder size: {total_size / (1024*1024):.1f} MB\n"
        f"  scripts.js updated with audioFile paths.\n"
        f"\nNext: upload the audio/ folder and the new scripts.js to your GitHub repo.\n"
        f"(See README.md, 'Updating the app later'.)"
    )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nInterrupted. You can re-run this script — already-rendered files are skipped.")