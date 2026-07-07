#!/usr/bin/env python3
"""
DEPRECATED: Replaced by vLLM-Omni serve (vllm serve Qwen/Qwen3-TTS-12Hz-1.7B-Base --omni).
Kept for reference only. Use vLLM-Omni for production (66x faster).

Qwen3-TTS Voice Clone Server (base17b).
OpenAI /v1/audio/speech endpoint.

Reads reference audio at startup, creates voice clone prompt,
then uses generate_voice_clone() for all synthesis requests.
"""
import sys, os, json, io, time
from http.server import HTTPServer, BaseHTTPRequestHandler

HOST, PORT = "0.0.0.0", 8001

# ── Reference audio config ──
REF_AUDIO = os.environ.get(
    "VOICE_CLONE_REF",
    "/home/rong/AI/vllm/models/qwen3-tts/clone_audio/ref_clip.wav",
)
REF_TEXT_PATH = os.environ.get(
    "VOICE_CLONE_REF_TEXT",
    "/home/rong/AI/vllm/models/qwen3-tts/clone_audio/ref_text.txt",
)


class H(BaseHTTPRequestHandler):
    model = None
    voice_clone_prompt = None

    def do_GET(self):
        self.send_error(404)

    def do_POST(self):
        if self.path != "/v1/audio/speech":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length).decode())
        text = body.get("input", "")
        language = body.get("language", "Auto")

        try:
            import torch
            import numpy as np
            from qwen_tts import Qwen3TTSModel

            if H.model is None:
                print("Loading Qwen3-TTS base17b model...", flush=True)
                H.model = Qwen3TTSModel.from_pretrained(
                    "/home/rong/AI/vllm/models/qwen3-tts/qwen3-tts-base17b",
                    device_map="cuda:0",
                    dtype=torch.bfloat16,
                    attn_implementation="sdpa",
                )
                print("Model loaded!", flush=True)

                # Load reference audio and create voice clone prompt
                print(f"Loading voice clone reference: {REF_AUDIO}", flush=True)
                ref_text = None
                if os.path.exists(REF_TEXT_PATH):
                    with open(REF_TEXT_PATH, "r", encoding="utf-8") as f:
                        ref_text = f.read().strip()
                    print(f"Reference text ({len(ref_text)} chars): {ref_text[:60]}...", flush=True)

                H.voice_clone_prompt = H.model.create_voice_clone_prompt(
                    ref_audio=REF_AUDIO,
                    ref_text=ref_text,
                )
                print("Voice clone prompt created!", flush=True)

            t0 = time.time()
            wavs, sr = H.model.generate_voice_clone(
                text=text,
                voice_clone_prompt=H.voice_clone_prompt,
                language=language,
                non_streaming_mode=True,
            )
            t = time.time() - t0
            print(f"TTS: {len(text)}c -> {len(wavs[0])/sr:.1f}s in {t:.1f}s", flush=True)

            audio = (np.asarray(wavs[0]) * 32767).astype(np.int16)
            buf = io.BytesIO()
            n = len(audio)
            import struct as st
            buf.write(b"RIFF")
            buf.write(st.pack("<I", 36 + n * 2))
            buf.write(b"WAVE")
            buf.write(b"fmt ")
            buf.write(st.pack("<IHHIIHH", 16, 1, 1, sr, sr * 2, 2, 16))
            buf.write(b"data")
            buf.write(st.pack("<I", n * 2))
            buf.write(audio.tobytes())

            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(buf.tell()))
            self.end_headers()
            self.wfile.write(buf.getvalue())
        except Exception as e:
            import traceback
            traceback.print_exc()
            self.send_error(500, str(e))


if __name__ == "__main__":
    import socketserver

    class T(socketserver.ThreadingMixIn, HTTPServer):
        allow_reuse_address = True

    s = T((HOST, PORT), H)
    print(f"TTS server (Voice Clone) listening on http://{HOST}:{PORT}", flush=True)
    s.serve_forever()
