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

- **Node.js** ≥ 18
- **Python** ≥ 3.9
- **FFmpeg + FFprobe** on PATH
- **Local services:** sd-server (:8080), TTS vLLM-Omni (:8001), vLLM ASR (:8002), ASR Server (:8012)

## Configuration

From `references/config-example.json`. Sections: tts, asr, video, branding.

## Checklist

```
□ 0. Read teaching/narration style guides
□ 1. Write narration.json
□ 1.5 ⭐ ALIGNMENT CHECK
□ 2. Generate slides
□ 3. ⭐ Visual check every PNG
□ 4. TTS + ⭐ ASR verification
□ 5. FFmpeg assemble
□ 6. ⭐ Quality check
□ 7. Subtitles
□ 8. ⭐ Cover image
□ 9. Upload
□ 10. ⭐ Verify thumbnail
```

## Steps

1. Script (narration.json) — one string per slide, 80–150 chars
2. Slides — Path A (sd-server), Path B (HTML+Playwright), or Path C (Node Canvas)
3. TTS+ASR — `node scripts/tts_with_asr.js`
4. Assembly — `node scripts/assemble.js`
5. Quality check — bitrate + frame extract
6. Subtitles — `node scripts/gen_subtitles.js`
7. Cover — `python scripts/cover_gen.py`
8. Upload — unlisted first, review, publish

## Scripts

slides_gen.py, pad_and_burn.js, screenshot.js, generate_slides.js, tts_with_asr.js, gen_script.py, assemble.js, gen_subtitles.js, rescore.py, cover_gen.py

## When things break

See `references/lessons-learned.md`.

## 驗證報告

- [ERNIE-Image GGUF 全量 Pipeline 驗證報告](docs/reports/2026-07-08-ernie-gguf-pipeline-verification.md)

## Git Management

This skill is symlinked from the GitHub repo at `/home/rong/video-production-skill/`. Auto-commit cron job every 30min (no_agent mode). See `references/git-management.md` for details.