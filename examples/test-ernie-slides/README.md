# Test: ERNIE-Image-Turbo Local Slide Generation

This example demonstrates **Path A** of the pipeline — generating slides locally using `sd-server` with ERNIE-Image-Turbo (GGUF), then padding them to 1920×1080 with a subtitle-safe bottom band.

## What was tested

| Step | Detail |
|------|--------|
| Image model | `ernie-image-turbo-Q4_K_M.gguf` via sd-server (:8080) |
| VAE | `flux2-vae.safetensors` |
| Text encoder | `ministral-3-3b.safetensors` |
| Resolution | 1536×1024 → padded to 1920×1080 |
| Sampling steps | 50 |
| Slides | 3 (LLM basics: definition, training, applications) |

## Files

```
slides_prompts.json      — prompts used (shared style + slide-specific content)
config.json              — sd-server endpoint config
slides_raw/slide_0*.png   — raw 1536×1024 generated images
slides/slide_0*.png       — final 1920×1080 (padded with 140px subtitle band)
```

## Results

- **Slides 1 & 2:** ✅ Chinese text correct and readable, composition matches hand-drawn teaching style
- **Slide 3:** ❌ Middle body text has garbled/fabricated characters (proving the SKILL.md warning: "It will invent fake numbers / typo content words — always eyeball each PNG")

Generation time: ~192s per slide at 50 steps. Padding: <2s total.

## Commands used

```bash
# Skip: sd-server was already running
python3 scripts/slides_gen.py --dir examples/test-ernie-slides
node scripts/pad_and_burn.js pad examples/test-ernie-slides
```
