"""
Cover / thumbnail generation — ERNIE-Image Full mode (sd-cli, 20 steps, cfg 4.0).
Uses Full mode for better long-title rendering.

Usage:
  python cover_gen.py "full cover prompt"
  python cover_gen.py --dir my-proj [prompt]

Output: cover_raw.png (1024x576). Pad to 1280x720:
  ffmpeg -y -i cover_raw.png -vf "scale=1080:720,pad=1280:720:100:0:color=white" thumbnail.jpg
"""
import os, sys, json, time, subprocess

SD_CLI = os.path.expanduser("~/.local/bin/sd-cli")
VAE = os.path.expanduser("~/comfy_ggufs/ComfyUI/models/vae/flux2-vae.safetensors")
LLM = os.path.expanduser("~/comfy_ggufs/ComfyUI/models/text_encoders/ministral-3-3b.safetensors")
FULL_MODEL = os.path.expanduser("~/comfy_ggufs/ComfyUI/models/unet/full/ernie-image-UD-Q5_K_M.gguf")

args = list(sys.argv[1:])
proj = "."
if "--dir" in args:
    i = args.index("--dir"); proj = args[i+1]; args = args[:i] + args[i+2:]
PROJ = os.path.abspath(proj)

if args:
    PROMPT = args[0]
else:
    pf = os.path.join(PROJ, "cover_prompt.txt")
    if not os.path.exists(pf):
        sys.exit("ERROR: pass prompt or create cover_prompt.txt")
    PROMPT = open(pf, encoding="utf-8").read()

out = os.path.join(PROJ, "cover_raw.png")
t0 = time.time()
print("gen cover (full)...", flush=True)
cmd = [
    SD_CLI, "--diffusion-model", FULL_MODEL, "--vae", VAE, "--llm", LLM,
    "-p", PROMPT, "--cfg-scale", "4.0", "--steps", "20",
    "--width", "1024", "--height", "576",
    "--vae-tiling", "--diffusion-fa", "-o", out
]
result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
if result.returncode != 0:
    sys.exit(f"sd-cli failed:\n{result.stderr}")
kb = os.path.getsize(out) // 1024
print(f"-> {out} ({kb}KB) {time.time()-t0:.0f}s")
