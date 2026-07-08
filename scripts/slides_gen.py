"""Local image generation (ERNIE-Image-Turbo / sd-server) — replaces gpt-image-2.

Reads slides_prompts.json from the project directory. Two accepted formats:

  1. Array of full prompt strings (one per slide):
     ["<full prompt slide 1>", "<full prompt slide 2>", ...]

  2. Object with a shared style block prepended to every slide prompt:
     { "style": "<shared style text>", "slides": ["<slide 1>", "<slide 2>", ...] }

Usage:
  python slides_gen.py                 # generate all slides
  python slides_gen.py 3 7            # regenerate only slides 3 and 7 (1-based)
  python slides_gen.py --dir my-proj  # project directory (default: cwd)

Output: slides_raw/slide_NN.png (1024x576). Pad to 1920x1080 afterwards with
`node pad_and_burn.js pad`.

Config in config.json:
  { "image": { "baseURL": "http://localhost:8080/v1", "model": "...", "size": "1536x1024" } }

Tips (learned the hard way):
  - Run at most 4-5 of these in parallel; don't run ASR at the same time.
  - Visually inspect EVERY output; regenerate single slides on typos/garbled text.
"""
import json, base64, os, sys, time, subprocess, re
from urllib import request

# --- sd-cli config ---
SD_CLI = os.path.expanduser("~/.local/bin/sd-cli")
VAE = os.path.expanduser("~/comfy_ggufs/ComfyUI/models/vae/flux2-vae.safetensors")
LLM = os.path.expanduser("~/comfy_ggufs/ComfyUI/models/text_encoders/ministral-3-3b.safetensors")
TURBO_MODEL = os.path.expanduser("~/comfy_ggufs/ComfyUI/models/unet/turbo/ernie-image-turbo-UD-Q5_K_M.gguf")
FULL_MODEL = os.path.expanduser("~/comfy_ggufs/ComfyUI/models/unet/full/ernie-image-UD-Q5_K_M.gguf")


def generate_one(prompt, output_path, mode="turbo"):
    """Generate one image via sd-cli (subprocess). Turbo=8s, Full=42s."""
    if mode == "full":
        model, cfg, steps = FULL_MODEL, "4.0", "20"
    else:
        model, cfg, steps = TURBO_MODEL, "1.0", "8"

    cmd = [
        SD_CLI, "--diffusion-model", model, "--vae", VAE, "--llm", LLM,
        "-p", prompt, "--cfg-scale", cfg, "--steps", steps,
        "--width", "1024", "--height", "576",
        "--vae-tiling", "--diffusion-fa", "-o", output_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        raise RuntimeError(f"sd-cli failed:\n{result.stderr}")
    # Extract image size from stderr or check file
    kb = os.path.getsize(output_path) // 1024
    return kb


def choose_mode(slide_idx, total_slides):
    """Cover and last slide use Full; bulk slides use Turbo."""
    if slide_idx == 0 or slide_idx == total_slides - 1:
        return "full"
    return "turbo"

args = [a for a in sys.argv[1:]]
proj = "."
if "--dir" in args:
    i = args.index("--dir"); proj = args[i+1]; args = args[:i] + args[i+2:]
PROJ = os.path.abspath(proj)

# Load config
config_path = os.path.join(PROJ, "config.json")
if not os.path.exists(config_path):
    sys.exit(f"ERROR: {config_path} not found")
config = json.load(open(config_path, encoding="utf-8"))
IMG_CFG = config.get("image", {})
BASE_URL = IMG_CFG.get("baseURL", "http://localhost:8080/v1").rstrip("/")
MODEL = IMG_CFG.get("model", "ERNIE-Image-Turbo")
SIZE = IMG_CFG.get("size", "1024x576")

OUT = os.path.join(PROJ, "slides_raw")
os.makedirs(OUT, exist_ok=True)

spec = json.load(open(os.path.join(PROJ, "slides_prompts.json"), encoding="utf-8"))
if isinstance(spec, dict):
    style = spec.get("style", "")
    prompts = [style + "\n" + s for s in spec["slides"]]
else:
    prompts = list(spec)

def gen(i):  # i is 1-based
    out = os.path.join(OUT, f"slide_{i:02d}.png"); t0 = time.time()
    mode = choose_mode(i - 1, len(prompts))
    print(f"[{i}] gen ({mode})...", flush=True)
    kb = generate_one(prompts[i - 1], out, mode)
    dt = time.time() - t0
    print(f"[{i}] -> {out} ({kb}KB) {dt:.0f}s", flush=True)

targets = [int(a) for a in args if a.isdigit()] if args else list(range(1, len(prompts) + 1))
for i in targets:
    gen(i)