#!/usr/bin/env python3
"""
Qwen3-ASR HTTP Server with dual backends:
  - /v1/audio/transcriptions?return_timestamps=false → vLLM (ASR 1.7B, fast)
  - /v1/audio/transcriptions?return_timestamps=true  → ForcedAligner (0.6B, word timestamps)
"""
import os, sys, json, tempfile, io, asyncio
from http.server import HTTPServer, BaseHTTPRequestHandler

# ── vLLM ASR client ──
import requests as req
VLLM_URL = "http://localhost:8002/v1/audio/transcriptions"

def asr_vllm(wav_path: str) -> str:
    """Pure text transcription via vLLM (fast, ~3s)."""
    with open(wav_path, "rb") as f:
        r = req.post(VLLM_URL, files={"file": f}, data={"model": "Qwen/Qwen3-ASR-1.7B"}, timeout=120)
    r.raise_for_status()
    return r.json()["text"]

# ── ForcedAligner (lazy-loaded) ──
ALIGNER = None

def align_words(wav_path: str, known_text: str) -> list:
    """Word-level timestamps via Qwen3ForcedAligner (0.6B, CPU-capable)."""
    global ALIGNER
    if ALIGNER is None:
        print("Loading ForcedAligner...", flush=True)
        from qwen_asr import Qwen3ForcedAligner
        ALIGNER = Qwen3ForcedAligner.from_pretrained(
            "Qwen/Qwen3-ForcedAligner-0.6B")
        print("ForcedAligner loaded.", flush=True)
    result = ALIGNER.align(audio=wav_path, text=known_text, language="zh")
    return [{"word": it.text, "start": it.start_time, "end": it.end_time} for it in result[0].items]

# ── HTTP Handler ──
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path != "/v1/audio/transcriptions":
            self.send_error(404); return
        # Parse multipart form
        ctype = self.headers.get("Content-Type", "")
        boundary = ctype.split("boundary=")[-1].strip() if "boundary=" in ctype else ""
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        # Extract fields
        wav_data = None
        return_ts = False
        known_text = None
        for part in raw.split(f"--{boundary}".encode()):
            if b"Content-Disposition" not in part: continue
            hdr, _, body = part.partition(b"\r\n\r\n")
            body = body.rstrip(b"\r\n--")
            name = ""
            if b'name="file"' in hdr:
                wav_data = body
            elif b'name="return_timestamps"' in hdr:
                return_ts = body.decode().strip() == "true"
            elif b'name="text"' in hdr:
                known_text = body.decode().strip()
        if not wav_data:
            self.send_error(400, "Missing file"); return
        try:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp.write(wav_data); wav_path = tmp.name
            if return_ts:
                if not known_text:
                    # Get known text from narration cache or fallback to vLLM ASR
                    known_text = asr_vllm(wav_path)
                words = align_words(wav_path, known_text)
                text = " ".join(w["word"] for w in words)
                resp = {"text": text, "words": words}
            else:
                text = asr_vllm(wav_path)
                resp = {"text": text}
            os.unlink(wav_path)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(resp, ensure_ascii=False).encode())
        except Exception as e:
            import traceback; traceback.print_exc()
            self.send_error(500, str(e))

if __name__ == "__main__":
    import socketserver
    class T(socketserver.ThreadingMixIn, HTTPServer): allow_reuse_address = True
    s = T(("0.0.0.0", 8012), H)
    print(f"ASR server on http://0.0.0.0:8012", flush=True)
    s.serve_forever()
