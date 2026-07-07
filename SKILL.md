---
name: video-production
description: "AI educational video production pipeline. Use when producing lecture videos, tutorial videos, or educational content. Covers script writing, slide generation (local image model), TTS narration (Qwen3-TTS) with ASR verification (Qwen3-ASR), subtitle alignment, and FFmpeg video assembly."
---

# Video Production Skill

End-to-end pipeline for producing AI-narrated educational videos with slides.
Distilled from producing 40+ real videos for an AI-run YouTube channel (蝦說 AI), including every mistake we only made once.

**Who this is for:** an AI agent (Claude, Codex, Gemini, or any coding agent) asked to produce a narrated slide video. A human can follow it too.

## Quick Start

```
0. Read references/teaching-style.md + references/narration-style.md (content quality rules)
0.5. （可選）自動生成腳本：`python3 scripts/gen_script.py "你的主題" .`
1. Create project directory and cd into it; copy config.json from references/config-example.json and fill it in
2. Write narration.json (the script — one string per slide; or use step 0.5 to auto-generate)
3. Generate slides (Path A: local image model + sd-server / Path B: HTML + Playwright screenshot)
4. Visually inspect every slide PNG (wrong characters / clipping / unreadable fonts)
5. TTS narration → WAV (with built-in ASR verification)   → node scripts/tts_with_asr.js
6. FFmpeg assemble → video.mp4                            → node scripts/assemble.js
7. Quality check (bitrate + frame extraction + visual)
8. Subtitles → SRT (+ optional burn-in)                   → node scripts/gen_subtitles.js
9. Cover image → thumbnail                                → python scripts/cover_gen.py
10. Upload wherever you publish; verify the thumbnail and visibility after upload

> 💡 **Qwen3-ASR 原生輸出繁體中文**，Simplified/Traditional 誤判問題已消除。
```

## Requirements

- **Node.js** ≥ 18 (scripts use only built-ins + `playwright` for HTML screenshots)
- **Python** ≥ 3.9 (only for image generation and optional rescore)
- **FFmpeg + FFprobe** on PATH (or set explicit paths in `config.json`)
- **Local services** (must be running before you start the pipeline):
  - **sd-server** (:8080, GPU 0) — ERNIE-Image-Turbo image generation
  - **TTS server** (:8001, GPU 0) — Qwen3-TTS synthesis, conda env `qwen3-tts`
  - **vLLM ASR** (:8002, GPU 1) — Qwen3-ASR-1.7B text transcription, conda env `breeze-asr-v2`
  - **ASR Server** (:8012, GPU 1) — ForcedAligner 0.6B word timestamps, conda env `qwen3-asr`
- A **TTS voice**: set `tts.voice` in `config.json` (e.g. `vivian`, `ryan`, `aiden`).
  See supported speakers from your Qwen3-TTS CustomVoice model.

> ⚠️ Never hardcode API keys in scripts and never commit them to git. One of our keys
> was auto-revoked from a public repo push and 32 videos rendered silent. Environment
> variables only.

---

## Configuration

Create `config.json` in your project directory (start from `references/config-example.json`):

```json
{
  "tts": {
    "provider": "qwen3-tts",
    "baseURL": "http://localhost:8001/v1",
    "model": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    "voice": "vivian",
    "response_format": "wav",
    "speed": 1.0,
    "maxRetries": 5
  },
  "asr": {
    "provider": "qwen3-asr",
    "condaEnv": "qwen3-asr",
    "model": "Qwen/Qwen3-ASR-1.7B",
    "forcedAligner": "Qwen/Qwen3-ForcedAligner-0.6B",
    "passThreshold": 0.85
  },
  "video": {
    "width": 1920,
    "height": 1080,
    "audioBitrate": "192k",
    "slidePadding": 1.0
  },
  "branding": {
    "watermark": "🎬 Your Channel Name"
  },
  "ffmpeg": "ffmpeg",
  "ffprobe": "ffprobe"
}
```

---

## Checklist (mandatory, do not skip steps)

```
□ 0. Read references/teaching-style.md — content/teaching rules (pre-flight constitution)
□ 1. Write narration.json
□ 1.5 ⭐ ALIGNMENT CHECK: narration entries count == slide count. MUST be equal!
     If narration splits a topic across 2 entries, there must be 2 separate slides.
     Mismatch = audio/visual desync for every slide after the mismatch point.
□ 2. Generate slides (Path A or B below)
□ 3. ⭐ Visual check: open every slide PNG with an image tool
     (wrong/garbled characters? clipped edges? readable on a phone?)
□ 4. TTS synthesis + ⭐ ASR verification (similarity ≥ 0.85, never skip)
□ 5. FFmpeg assemble → video.mp4
□ 6. ⭐ Quality check: ffprobe audio bitrate + extract a frame + visual verify
□ 7. Subtitles → subtitles_aligned.srt (external track and/or burn-in)
□ 8. ⭐ Cover image → thumbnail (16:9; pad, don't crop)
□ 9. Upload (start unlisted/private, review, then publish)
□ 10. ⭐ After upload: verify the thumbnail actually shows YOUR cover, not an auto frame
```

**The ⭐ steps are non-negotiable.** Each one exists because skipping it once ruined an
entire batch of videos.

---

## Startup Commands (start these before running the pipeline)

```bash
# Terminal 1: Image server (GPU 0)
~/stable-diffusion.cpp/build/bin/sd-server \
  --diffusion-model ~/comfy_ggufs/ComfyUI/models/unet/ernie-image-turbo-Q4_K_M.gguf \
  --vae ~/comfy_ggufs/ComfyUI/models/vae/flux2-vae.safetensors \
  --llm ~/comfy_ggufs/ComfyUI/models/text_encoders/ministral-3-3b.safetensors \
  --listen-port 8080

# Terminal 2: TTS server (GPU 0)
bash -c 'source ~/anaconda3/etc/profile.d/conda.sh && conda activate qwen3-tts && python3 -u /tmp/tts_server.py'

# Terminal 3: vLLM ASR (GPU 1, text transcription)
bash -c 'source ~/anaconda3/etc/profile.d/conda.sh && conda activate breeze-asr-v2 && \
  vllm serve Qwen/Qwen3-ASR-1.7B --port 8002 --enforce-eager --trust-remote-code --max-model-len 4096'

# Terminal 4: ASR server (GPU 1, word timestamps)
bash -c 'source ~/anaconda3/etc/profile.d/conda.sh && conda activate qwen3-asr && python3 -u scripts/asr_server.py'

# Terminal 5: Pipeline
cd /path/to/project
python3 scripts/gen_script.py "你的主題" .   # optional: auto-generate script
python3 scripts/slides_gen.py .
node scripts/tts_with_asr.js .
node scripts/assemble.js .
node scripts/gen_subtitles.js .
```

> 🔴 **The cover is part of the video, not an optional extra.** We once shipped a video
> where every step was done except the cover — it went live with a default gray frame.
> "No cover = not shipped."

---

## Step 1: Script (`narration.json`)

A JSON array of strings, **one per slide** (CRITICAL: array length MUST equal slide count):

```json
[
  "開場白，吸引注意力...",
  "第一個重點，配合比喻...",
  "第二個重點...",
  "結尾，call to action..."
]
```

### Writing guidelines

- **80–150 characters per slide** (Chinese). Too short = rushed; too long = TTS breaks.
- **Conversational tone**: metaphors, rhetorical questions, humor.
- **One concept per slide.** Don't cram.
- **Story > Information.** Viewers remember stories, not bullet lists.
- Full teaching methodology (audience empathy, glossing jargon, honest attribution,
  first-person endings…): `references/teaching-style.md`. Voice & TTS-safe writing:
  `references/narration-style.md`.

### TTS-friendly writing (important!)

TTS engines mispronounce things. Prevent it at the script stage:

| Problem | Fix |
|---------|-----|
| English abbreviations (LLM, NLP) | Spell out in Chinese, or letters with periods (P.U.A.) |
| Raw numbers (135,000) | Chinese numerals (十三萬五千) |
| Version numbers (4.5) | Display text keeps `4.5`, TTS text gets 四點五 |
| Long sentences (>50 chars) | Split at natural breath points |
| Parenthetical content | Rewrite as natural speech |
| Chinese heteronyms 破音字 (還/重/長/得…) | Scan with references/heteronyms.json, rewrite |

---

## Step 2: Slides

Two first-class paths. Pick ONE per video (Path A is our channel default; Path B has no
image-API dependency).

### Path A — ERNIE-Image-Turbo / sd-server (`scripts/slides_gen.py`)

Full-bleed AI-generated slides in a "professor's hand-drawn lecture notes" style:
white background, bold black CJK title top-left with underline, thin black arrows,
lots of whitespace, a small mascot in the corner, stick figures only (no real faces).

1. Write one Chinese prompt per slide into `slides_prompts.json` (array of strings).
   Wrap every string that must appear on the slide in 「」. Always end the shared style
   block with: 「所有中文字必須完全正確、清楚可讀、不可有亂碼或錯字。數字要正確。」
2. `python scripts/slides_gen.py` → generates `slides_raw/slide_NN.png` (1536×1024).
   Default sampling steps = 50 (configurable in `config.json` → `image.steps`).
   ERNIE-Image-Turbo at ≥50 steps produces noticeably clearer Chinese text;
   below 30 steps characters are often garbled or have missing strokes.
   Batch ≤4–5 concurrent lanes. **Do not run ASR at the same
   time** — concurrent heavy GPU calls starve each other.
3. **Visually inspect every image** (garbled characters / wrong or invented numbers /
   typos → regenerate just that slide; HTTP 502 → just retry that slide).
   sd-server (ERNIE-Image-Turbo) WILL invent numbers to fill tables unless your prompt
   explicitly says 「畫面只能出現 X 這幾個數字，其他留空」.
4. `node scripts/pad_and_burn.js pad` → 1536×1024 scaled to 1410×940, padded onto a
   1920×1080 white canvas with a 140px bottom band reserved for subtitles.

### Path B — HTML slides + Playwright screenshot (`scripts/screenshot.js`)

Create one HTML file per slide: `slides/slide_01.html`, `slide_02.html`, …
(template: `references/slide-template.html`), then `node scripts/screenshot.js`.

Design rules (hard-won; mobile viewers are the majority):

| Element | Minimum font size |
|---------|-------------------|
| Main title | **≥72px** |
| Subtitle / section header | ≥36px |
| Body text | **≥32px** (absolute floor) |
| Key numbers | ≥48px |
| Watermark | ≥20px (only element allowed smaller) |

- Resolution = `video.width × video.height` (default 1920×1080).
- **Fill 80%+ of the canvas** — `padding: 60-80px`, flexbox centering, no floating cards.
- Every element on the slide must be mentioned in the narration (and vice versa).
- 🔴 Never use <24px body text. Fewer points in bigger font > more points in tiny font.

### Path C — Node Canvas fallback (`scripts/generate_slides.js`)

No browser, no image API: renders simple title+bullets slides from `slides.json`.
Use only when Playwright and the image API are both unavailable.

---

## Step 3: TTS + ASR Verification (`scripts/tts_with_asr.js`)

```bash
node scripts/tts_with_asr.js [project_dir]
```

Reads `narration.json`, synthesizes each entry via Qwen3-TTS HTTP API, saves `audio/slide_XX.wav`,
then **verifies every clip with Qwen3-ASR**:

1. Transcribe the generated audio
2. Compute character-overlap similarity vs the original text
3. **≥ 0.85 = PASS** (target ≥0.90 for important videos)
4. < 0.85 = FAIL → adjust wording and retry (up to `tts.maxRetries`)

**Adjustment rules:** swap synonyms / split long sentences / write numbers in Chinese —
but never change the meaning, never drop information.

**Don't chase 0.85 forever — verify the words, ship on redundancy.** Qwen3-ASR produces
far fewer false alarms than Whisper on Chinese (homophone errors are rare). If the ASR
"errors" are homophones and every key word/number comes through, the audio is correct —
keep the best attempt. The slide shows the number visually and the subtitle uses the
original text, so the viewer has triple redundancy. For digit-heavy narration, run
`python scripts/rescore.py` — it strips numerals and compares toneless-pinyin multisets
(≥0.90 = pass), which kills most false failures. A real defect = ASR gets the SAME wrong
word consistently across multiple synth attempts (that's the TTS mispronouncing, not
ASR mishearing → rewrite that word).

ASR verification is **concurrent** (default concurrency=4, set via `asr.concurrency` in config).
10 slides verify in ~6s instead of ~20s. Concurrency >6 may OOM the ForcedAligner GPU process.

---

## Step 4: FFmpeg Assembly (`scripts/assemble.js`)

```bash
node scripts/assemble.js [project_dir]
```

Pairs each `slides/slide_XX.png` with `audio/slide_XX.wav`, creates per-slide clips,
concatenates into `video.mp4`.

Key flags (all already in the script):
- `-b:a 192k` — without it audio can silently render at 2kbps (present but inaudible)
- `-tune stillimage` — much smaller files for slide video
- `-pix_fmt yuv420p` — plays everywhere
- `-movflags +faststart` — video streams/plays inline instead of "link won't open"

> 🔴 **Mixing clips from different sources** (e.g. your narrated slides + a real screen
> recording)? Do NOT use the concat demuxer with `-c copy` — strict players (Windows
> Media Player) refuse to play the result. Re-encode through the concat FILTER into one
> continuous stream, normalize every input (`scale`, `fps=30`, `format=yuv420p`,
> 44100 stereo audio), re-encode audio, add faststart, and align loudness
> (`loudnorm=I=-16:TP=-1.5:LRA=11`). Details in references/lessons-learned.md.

> 🔴 **Mix TTS from two providers in one video?** Resample everything to 44100 BEFORE assembly or
> some players choke exactly at the voice-switch point.
>
> ⚠️ **Qwen3-TTS outputs 24 kHz WAV** — the assemble script now adds `-ar 44100` automatically,
> but if you hand-roll ffmpeg commands, always resample to 44100 before concatenation, or
> the splice points may click or be rejected by some players.

---

## Step 5: Quality Check (three checks, all required)

### 5a. Audio bitrate
```bash
ffprobe -v error -show_entries stream=codec_type,codec_name,bit_rate -of default video.mp4
```
✅ ~130–192 kbps AAC ❌ ~2 kbps or N/A = TTS failed silently

### 5b. Visual verification
```bash
ffmpeg -ss 3 -i video.mp4 -frames:v 1 -update 1 verify.png
```
Compare `verify.png` against `slides/slide_01.png` with an image tool. Content must match.

### 5c. Font size check
Inspect `verify.png`: is every text element readable at mobile size?

---

## Step 6: Subtitles (`scripts/gen_subtitles.js`)

```bash
node scripts/gen_subtitles.js [project_dir]
```

Produces `subtitles_aligned.srt`: **Qwen3-ASR word timestamps for timing, original
narration text for display** (never use ASR output as subtitle text — it mishears).
Line breaks are width-aware (CJK=1, Latin=0.5, ≤16 full-width per line) and never cut
inside an English word. After SRT generation, **automatically burns subtitles into
`video_sub.mp4`** (white text + black outline, `Noto Sans CJK TC`, 22pt).
Style is configurable via `config.json` → `subtitles` (fontName, fontSize, marginV, outline).

> **video_sub.mp4 is the delivery file.** `video.mp4` is the intermediate.

> ⚠️ **The #1 subtitle bug: drift from assuming clip duration = audio + padding.**
> FFmpeg's `-shortest` truncates the padding, so real clip duration ≈ audio duration.
> The script therefore reads ACTUAL durations from `temp/clip_XX.mp4` with ffprobe.
> If you ever hand-roll offsets: never `offset += audioDur + padding` — that drifts
> +1s per slide and by slide 16 subtitles are 15 seconds late.

Ship options:
- **External SRT track** (recommended when your platform supports it — viewers can
  toggle, nothing covers the slides)
- **Burn-in**: `node scripts/pad_and_burn.js burn` (Path A white-band layout: dark text
  FontSize 30 / MarginV 30 sits inside the reserved 140px band)
  For full-bleed dark HTML slides use FontSize=14–18, MarginV=6–12, BorderStyle=3 instead.

For rough/cloned voices where Qwen3-ASR timestamps collapse, there is a geometry-based
fallback (ffmpeg `silencedetect` + character-width proportional alignment) — see
references/lessons-learned.md § subtitle alignment.

---

## Step 8: Cover / Thumbnail (`scripts/cover_gen.py`)

```bash
python scripts/cover_gen.py "一張 YouTube 影片封面，橫式 16:9，白底手繪教學風…主標題用超大粗黑體繁體中文寫「你的標題」…"
```

- Generate at 1536×1024, then **pad — do not crop — to 1280×720**:
  crop cuts off the top of your title. `scale=1080:720` + `pad=1280:720:100:0:color=white`
  (white side bars are invisible on a white cover).
- Target ≤2MB for YouTube.
- Same prompt hygiene as slides: quote exact text in 「」, forbid invented numbers,
  visually verify before shipping.

---

## Step 9: Upload

Platform-specific; do it however you normally operate (browser automation, manual, CLI).
Regardless of method, these rules survived contact with reality:

1. Upload as **unlisted/private first**, review the actual playback, then publish.
2. **Verify the thumbnail after upload** — the preview must show YOUR cover, not an
   auto-selected frame.
3. Re-check title/description/language settings after any dialog reopens (some upload
   wizards silently reset radio buttons).
4. If you used an external SRT: upload it as a caption track ("with timing"), publish
   the track, then verify captions actually appear on the watch page.
5. Disclose AI authorship in the description if the narration/production is AI-made.

---

## Output Structure

```
my-video-project/
├── config.json              ← project config (from references/config-example.json)
├── narration.json           ← script text per slide
├── slides_prompts.json      ← (Path A) one sd-server prompt per slide
├── slides_raw/              ← (Path A) raw 1536×1024 generations
├── slides/                  ← final 1920×1080 PNGs (padded or screenshotted)
│   ├── slide_01.png
│   └── ...
├── audio/
│   ├── slide_01.wav
│   └── ...
├── temp/                    ← per-slide clips + whisper word caches
├── video.mp4                ← assembled video (no subtitles)
├── video_sub.mp4            ← video with subtitles burned in (delivery file)
├── subtitles_aligned.srt    ← aligned SRT subtitle track
└── thumbnail.jpg            ← cover, 1280×720
```

---

## Scripts Reference

All scripts take the project directory as an optional first argument (default: CWD).

| Script | Purpose |
|--------|---------|
| `scripts/slides_gen.py` | Local image generation from slides_prompts.json (ERNIE-Image-Turbo) |
| `scripts/pad_and_burn.js` | pad 3:2 images to 16:9 + subtitle band / burn SRT |
| `scripts/screenshot.js` | Playwright HTML→PNG screenshots |
| `scripts/generate_slides.js` | Node Canvas fallback slide renderer |
| `scripts/tts_with_asr.js` | Qwen3-TTS + Qwen3-ASR verification loop |
| `scripts/gen_script.py` | LLM-powered auto-generation of narration + slides_prompts + cover |
| `scripts/assemble.js` | FFmpeg per-slide clips + concat |
| `scripts/gen_subtitles.js` | aligned SRT (Qwen3-ASR timing + original text) |
| `scripts/rescore.py` | homophone/digit-tolerant second-chance ASR scoring |
| `scripts/cover_gen.py` | Local image cover generation (ERNIE-Image-Turbo) |

---

## Sub-agents

If you spawn a sub-agent to produce a video, the task prompt must explicitly say
**"read the video-production SKILL.md first"**. Sub-agents that aren't told skip the
pipeline and reinvent (worse) wheels. Re-read the skill fresh each session — it evolves.

## When things break

`references/lessons-learned.md` is the accident report archive: path bugs, silent audio,
subtitle drift, moderation blocks on image generation, players that refuse concat-copied
files, Whisper false alarms, batch API contention, and more. Read it before your first
video; grep it when something looks weird — the odds are good we already hit it.
