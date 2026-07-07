# Lessons Learned — Video Production

Hard-won lessons from producing 40+ educational videos on an AI-run channel.
Read this before your first video to avoid repeating these mistakes; grep it when
something looks weird — the odds are good we already hit it.

---

## 🔴 Critical (caused batch failures)

### 1. API keys in source code
**What happened:** API key was committed to a public GitHub repo → automatically revoked → 32 videos rendered with silent audio.
**Fix:** Always read keys from environment variables (`process.env.ELEVENLABS_API_KEY`). Never hardcode.

### 2. `__dirname` vs CWD path bug
**What happened:** Assembly and TTS scripts used `path.join(__dirname, ...)`, so they always read/wrote to the script's own directory, not the project directory. Result: 11 videos used stale slides from a different project.
**Fix:** Scripts default to CWD (or take the project dir as an argument). Always verify by checking `video.mp4` frame output matches your current slides.

### 3. Skipping visual verification
**What happened:** Videos were "successfully" assembled but used wrong slides. Nobody checked until the professor watched them.
**Fix:** After assembly, extract a frame (`ffmpeg -ss 3 -i video.mp4 -frames:v 1 verify.png`) and visually compare.

### 4. Font size too small
**What happened:** 15 videos used 16-24px body text. The professor said "completely unreadable on mobile." All had to be redone.
**Fix:** Minimum body text 32px. Title ≥72px. Always verify with an image tool at mobile preview size.

---

## 🟡 Quality Issues

### 5. Silent audio (low bitrate)
**What happened:** FFmpeg produced video with 2kbps audio — technically present but inaudible.
**Fix:** Always use `-b:a 192k` in FFmpeg. Always check with `ffprobe` after assembly.

### 6. TTS pronunciation errors
**What happened:** TTS misread English words mixed in Chinese text, wrong number pronunciations.
**Fix:** ASR verification is mandatory (threshold ≥ 0.85). Write TTS-friendly text from the start.

### 6b. Whisper ASR false-alarms on cloned voices — don't loop forever; verify the words, ship on redundancy
**What happened:** 5/16 slides failed the 0.85 ASR gate, stuck at 78–84% even after 5–6 retries. They were the dense number/connective slides. Whisper kept mis-transcribing the cloned voice's homophones — "二十次裡"→"而是磁力", "圍欄"→"蔚藍" — so the *similarity score* tanked even though the *audio was correct*.
**How to tell a false-alarm from a real defect:** transcribe the kept audio and read it — check whether the KEY words/numbers come through. If the critical tokens are present and only connective tissue is garbled, it's Whisper, not the TTS.
**The real fix is two-part:**
1. **Reword only the genuinely-risky words** (audio actually wrong): e.g. `兇巴巴`→heard as `熊爸爸` (→ use `強硬`); `餵牠`→`委託` (→ use `給牠`). Add breath commas.
2. **Then ship on triple redundancy, don't chase 85% forever:** the slide shows the exact number visually + the subtitle uses the **narration original text** (not Whisper output) + the audio. Accept the best-scoring attempt for stubborn-but-correct slides. (Keep BEST attempt, not last.)

### 7. Slide content doesn't match narration
**What happened:** Slides showed 6 bullet points but narration only covered 3. Viewer confusion.
**Fix:** Write narration first → design slides to match. Or cross-check every slide after both are done.

### 8. Empty whitespace in slides
**What happened:** Content occupied only 60% of the 1920×1080 canvas. Looked unprofessional.
**Fix:** Don't use `max-width` to constrain containers. Use `padding: 60-80px` and let content fill the space.

### 9. Content pushed to top
**What happened:** Fixed `padding-top` made content cluster in upper half with blank lower half.
**Fix:** Use flexbox centering (`display:flex; align-items:center; justify-content:center`).

---

## 🟢 Process Improvements

### 10. Multi-version strategy
Making 2-5 versions of a video for the reviewer to choose from is faster than making one, getting feedback, and iterating.

### 11. Always re-read the skill
Before every video session, re-read SKILL.md. Don't rely on memory of old versions — the skill evolves.

### 12. Sub-agents and video production
When spawning a sub-agent to make a video, the task prompt must explicitly say "read the video-production skill first." Otherwise the sub-agent will skip the pipeline.

### 13. ASR threshold history
- Started at 0.60 — too lenient, listeners heard errors
- Raised to 0.85 — much better
- Important videos: target 0.90+

### 14. FFmpeg `-tune stillimage`
Reduces file size dramatically for slide-based videos (static images + audio). Always use it.

### 15. `fontstyle=italic` bug
FFmpeg `drawtext` with `fontstyle=italic` caused rendering errors. Remove italic from drawtext filters.

### 16. 1920×1080 vs 1280×720
On some cloud platforms, 1920×1080 caused FFmpeg to output 0-byte files. If this happens, try 1280×720 instead.

### 17. Whisper subtitle alignment
Whisper's Chinese transcription has errors, but its timestamps are accurate. Solution: use Whisper timestamps + original script text (see `scripts/gen_subtitles.js`).

### 18. Subtitle font size balance (burn-in on full-bleed dark slides)
- FontSize ≥16: blocks slide content at bottom
- FontSize ≤12: invisible on mobile
- **FontSize=14 with MarginV=6**: best balance found
(For the white-band layout from `pad_and_burn.js`, FontSize=30 / MarginV=30 in the 140px band.)

### 19. Audio padding
Add ~1.0 second of silence after each slide's audio. Gives viewers time to read before the next slide. Adjustable in config. (But see #21: `-shortest` means this padding does NOT extend the clip — measure real durations.)

### 20. Google account automation
Google blocks all automated browser logins (Playwright, Puppeteer, CDP). YouTube uploads must use a pre-authenticated real browser session, not a fresh login flow.

### 21. 🔴 Subtitle timing: use clip duration, NOT audio + padding
**What happened:** Subtitle script calculated slide offsets as `audioDur + 1.0s padding`. But FFmpeg's `-shortest` flag makes actual clip duration ≈ audioDur (no padding added to the clip). Result: subtitles drifted +1 second per slide. By slide 16, subtitles were **15 seconds late**.
**Fix:** Always use `ffprobe` on the actual `temp/clip_XX.mp4` files to get the real clip duration. Never assume clip duration = audio duration + padding.
```
// CORRECT
clipDur = ffprobe("temp/clip_01.mp4")  // e.g., 16.579s

// WRONG
clipDur = audioDur + 1.0  // e.g., 17.579s — 1 second too long!
```

### 22. Slide-narration alignment
**What happened:** A script had 16 narration segments but the slide content didn't match 1:1 (two segments mapped to one slide topic, causing all subsequent slides to be off by one).
**Fix:** Before TTS, verify each narration segment against its corresponding slide PNG using image inspection. If a topic needs two narration segments, either merge them or split the slide.

---

## gpt-image-2 full-bleed slides — the traps

**1. The safety system false-blocks (moderation_block, HTTP 400).** Common triggers: military imagery (soldiers/flags), human figures + death/no-return metaphors (a cloaked figure at a point of no return got read as self-harm), "feeding itself" phrasing. Counter: switch to **pure objects / abstract imagery (drop human figures) + neutral wording** and retry; some blocks are stochastic — **the same prompt often passes on one retry**. Parallelize (≤5 lanes) and regenerate failures individually.

**2. Full-bleed 3:2 slides often have text near the bottom → burning subtitles directly covers the slide's own text.** (HTML slides can reserve a safe area; generated images can't.) Counter: pad every slide before assembly (`node scripts/pad_and_burn.js pad`):
```
ffmpeg -i slide.png -vf "scale=1410:940:flags=lanczos,pad=1920:1080:255:0:color=white" out.png
```
→ slide sits in the top 940px, bottom 140px is a white subtitle band, fully separated.

**3. CJK text and numbers are surprisingly accurate — but still verify every image.** A 15-slide batch got 80%+ / 8× / 4分→12小時 / 盧比孔河 all correct with zero garbling — and the NEXT batch invented numbers. Always eyeball each PNG; regenerate the wrong ones.

**4. It will invent fake numbers / repeat background text / typo content words.** Give it a "score table" and it will **fill rows with numbers that don't exist**. → The prompt must explicitly say 「畫面只能出現 X 這幾個數字，其他列留空或畫橫線，不要填任何其他數字」. "Faint background text" gets **printed a dozen times** → say 「背景留白、不要重複任何文字」. Content-word typos (節奏→節泰) and dropped numbers happen → inspect each image, regenerate with the fix named explicitly (「奏不要寫成泰、71 和 53 兩個都要出現」).

---

## 🔴 "Reconstructing content" without a transcript = fabrication

Making a "reading/interpreting someone's video" episode without the actual transcript — reconstructing the content axis from title + comments + domain knowledge — produced three points the speaker NEVER said. Caught by the reviewer.

**Counter (always do first): fetch the real transcript with yt-dlp, don't reconstruct.**
```
yt-dlp --skip-download --write-auto-subs --sub-langs "zh-TW" --sub-format json3 -o "out.%(ext)s" "<url>"
# no json3 → falls back to vtt; --list-subs shows available languages/formats
```
- Tools improve — even if transcript extraction failed for you months ago, retry the current yt-dlp before falling back.
- YouTube auto-caption vtt has **rolling duplication** (each line re-appears incrementally) — dedupe: strip inline `<…>` tags → drop half-lines that prefix the next line → global dedupe → merge every ~8 lines into paragraphs.
- **Cross-check external numbers by reading the original blog/paper directly**; distinguish "written in the report" vs "the speaker's spoken paraphrase" vs "my extrapolation" — attribution in the video must match.

**Root rule: every "someone said X" point in a video must be traceable to a line in the transcript/original text; can't point to it = don't include it.** Reconstruction ≠ quotation.

---

## Batch production: serialize heavy API phases + don't kill processes by name

**1. 🔴 Whisper must not run concurrently with batched gpt-image-2 generation.** Running "4 parallel image lanes" + a Whisper subtitle step at the same time starved Whisper into an **infinite hang** (the subtitle script originally had no timeout).
- **Rule: only one "heavy API" type at a time** — either a batch of image generations (≤5 lanes) OR one Whisper step (TTS-ASR or subtitles). Image generation vs pure-local ffmpeg (pad/assemble/burn) CAN overlap (different resources).
- **Per-video phases:** ① images (slides + cover) → ② Whisper (TTS+ASR) → ③ local (assemble) → ④ Whisper (subtitles) → ⑤ local (burn/thumbnail). When pipelining across videos, don't let the next video's image phase overlap the previous one's Whisper phase. Single-video serialization is the safest.
- All Whisper requests need a timeout + fallback (`gen_subtitles.js` has a 90s timeout and proportional-alignment fallback; word caches in `temp/words_NN.json` mean re-runs only fetch what's missing).

**2. 🔴 Never `taskkill /IM node.exe` / `Stop-Process -Name node` to unstick a hang.** That kills **every** node process on the machine — including other sessions' unrelated work. Find the specific PID first (`Get-Process node | Select Id,StartTime`), kill only that one, and report if you killed the wrong thing.

**3. TTS homophone false-fails at 0.85 where the audio is actually correct** (報到↔報導、儀式↔意識、貓派↔毛牌): check whether the ASR "errors" are same/near-sound characters — if yes, the audio is fine; accept. Long sentences with many near-sounds → simplify the sentence, reduce keyword repetition, re-synthesize best-of-5.

**4. Batch efficiency:** narration is the creative core — write it yourself; slide prompts / cover prompts / scaffolding can be prepared while the previous video renders (pure local work, no contention). gpt-image-2 CJK+digits render reliably (~60 images zero typos once) — but still eyeball each one.

**5. 🔴 Narration punctuation density = TTS pause density.** The TTS script converts every punctuation mark into a space → each space is a pause in Chinese TTS. Dense short-comma writing ("今天，我帶你看…" "對，那顆按鈕…") = machine-gun narration. Write in breath groups (~8–22 chars per intonation unit); no comma right after a sentence-initial connective; merge choppy short sentences. Deliberate list rhythm (「打開瀏覽器、找到留言框、再按發佈」) is fine to keep.
- **Verify:** after rewriting, compare TOTAL duration — fewer pauses = obviously shorter (one case: 4:53→4:37, worst slide 19.4s→14.2s). Ears are the final arbiter.
- English words embedded with surrounding spaces each add a pause too; one acronym is fine, don't stack many.

---

## 🔴🔴 "This file won't play" after concatenating mixed sources — the real fix

**Symptom:** narrated slide clips + external real-footage clips concatenated → VLC/ffmpeg play it, but **Windows built-in players refuse** ("can't play").

**Root causes (both together):**
1. **concat demuxer + `-c copy`** across different sources → per-segment AAC priming/edit lists, discontinuous timestamps, per-segment SPS/PPS parameter changes; strict players reject.
2. Burning subtitles with `-c:a copy` keeps that broken audio as-is.
3. No faststart (`moov` after `mdat`).
> ⚠️ `ffmpeg -v error -i x.mp4 -f null -` scans CLEAN on such files — "scan clean" ≠ "plays". Verify faststart and test in a strict player.

**The cure (for mixed-source concat, always):**
- Use the **concat FILTER** (`filter_complex ...concat=n=N:v=1:a=1`) — one decode+re-encode into a single continuous stream.
- **Normalize every input first:** `scale=1920:1080:...,setsar=1,fps=30,format=yuv420p` + `aformat=sample_rates=44100:channel_layouts=stereo,asetpts=N/SR/TB`.
- **Always re-encode audio** (`-c:a aac -b:a 192k -ar 44100 -ac 2`), never `-c:a copy`.
- Burn subtitles in the **same pass** (`[vc]subtitles=...[v]`).
- Always add **`-movflags +faststart`**.
- Loudness: TTS narration (~−25 LUFS) vs normalized external footage (−16) differ by ~10dB and will startle viewers → run narration clips through `loudnorm=I=-16:TP=-1.5:LRA=11` too.

(For SAME-source slide clips produced by `assemble.js`, plain concat demuxer + faststart is fine — that's what the script does.)

---

## TTS fine-points (version numbers, heteronyms, sound-alike substitution)

1. **Version numbers must be read as "點"**: display text keeps `4.5`, TTS text gets 四點五 (separate display-text from TTS-text when needed).
2. **Keep heteronyms (多音字) out of narration**: if Whisper transcription flip-flops on a character across 5 attempts (重 chóng/zhòng), that's an instability signal → rewrite the word (「重出考卷」→「出了新考卷」). Scan drafts for 重/還/得/行/長 etc. — see `heteronyms.json`.
3. **Sound-alike substitution trick**: if the TTS keeps mispronouncing a correct character, feed it a HOMOPHONE that it pronounces right (TTS text 「喚」, subtitle keeps the correct 「換」). Subtitles always come from the original narration text, so the viewer sees the right character while hearing the right sound.
4. **"發呆" trap**: some voices read 呆 with the archaic ái sound. If ASR hears the same wrong vowel five times in a row = real mispronunciation → rewrite (「整個放空」). Random tone-level near-misses across attempts = ASR false alarm → accept.
5. **Words TTS cannot say → put them on the slide, not in the mouth.** Tool names (GPT-SoVITS), code-ish English, pinyin-with-tone-marks all break TTS → narration says 「一個開源的中文語音引擎」, the slide shows the exact name. Subtitle = narration text, so nothing wrong appears on screen; the precise name lives on the slide.

---

## Adding slides to the FRONT of a finished video — renumber, don't redo

When the reviewer asks for "2 extra slides at the start" after everything is verified:
1. **Renumber existing assets in REVERSE order** (`slide_14→16, 13→15, …` — reverse or you overwrite), moving `slides/slide_NN.png`, `audio/slide_NN.mp3`, `temp/words_NN.json` together. k = number of new slides.
2. **Generate + synthesize only the k new slides.**
3. Update `narration.json` to the full N+k entries; re-pad → assemble → gen_subtitles (it reuses renamed `temp/words_NN.json` caches and only fetches the new slides) → burn.
4. Re-extract 2-3 frames to verify the new transitions.
This avoids regenerating N slides and re-synthesizing N TTS clips, and can't introduce new garbled characters into already-verified slides.

**Companion rule:** every number quoted in narration should live in a RESULTS.md (single source of truth) first; before publishing, run an adversarial fact-check pass against it (one review caught "the bigger model got 100%" when the 100% model was actually the *mini*).

---

## Subtitle alignment for rough/cloned voices: do NOT use Whisper word timestamps

**Symptom:** on slightly rough cloned-voice TTS (trailing noise at sentence ends), Whisper word timestamps collapse (everything crammed into the first ~30s) or exceed clip length → subtitles jump backwards, cross slide boundaries, emit illegal `,1000` millisecond values.

**Fix = drop Whisper entirely for timing; use silence geometry:**
1. **Text** = narration.json original (never ASR output).
2. **Timing** = `ffmpeg silencedetect=noise=-36dB:d=0.16` finds natural pauses per clip; onset = end of leading silence, speechEnd = start of trailing silence; middle pauses become line-break points.
3. Distribute break points by **display width** (CJK=1, Latin=0.5) proportionally across [onset, speechEnd], then **snap each break to the nearest real pause** (tolerance ~0.75s, each pause used once), minimum 0.5s per line.
4. Offset each slide by **actual clip duration** (not mp3 duration — that accumulates drift).
5. Watch the `fmt()` millisecond carry bug: `Math.round(frac*1000)` can emit 1000 — carry it into seconds.
6. Guarantee monotone, non-overlapping, in-bounds cues (pure geometry, zero API, offline).

**How to verify subtitle alignment without ears:** sample a few 6s windows (`ffmpeg -ss T -t 6`), ASR each window, and check the spoken words fall inside the subtitle text currently displayed (character overlap). 85%+ = aligned; the remainder is window-edge effects, not misalignment. This catches timeline OFFSET errors better than eyeballing frames.

**Cloned-voice onset-swallow:** some engines randomly swallow the short phrase before the first comma of a sentence. Fix = rewrite those sentences to start with a disposable filler (「原來，…」「後來，…」) so a swallowed onset loses nothing; then best-of-N and pick the attempt with complete onset + highest similarity.

**Note on `assemble.js` `-loop 1 ... -shortest`:** the clip gets cut at audio length (configured padding does NOT extend it). Inter-slide gaps = trailing silence of one clip + leading silence of the next. Subtitle offsets using actual clip lengths are immune to this.

---

## Local API Migration（2026-07）

從 ElevenLabs + OpenAI（gpt-image-2 + Whisper）全部遷移到本地 Qwen 生態系。
以下是踩過的坑，每一條都是真的遇到才寫的。

### #1 ERNIE-Image-Turbo 的正確 VAE 組合

**問題：** 一開始用 `qwen_image_vae.safetensors`，生成的圖片全黑或色彩崩壞。

**原因：** ERNIE-Image-Turbo 的 VAE 與 Qwen-Image 的 VAE 不同。

**解法：** 正確組合是 `ernie-image-turbo-Q4_K_M.gguf` + **`flux2-vae.safetensors`** + `ministral-3-3b.safetensors`（文字編碼器）。不需修改 sd.cpp 原始碼。

**教訓：** 擴散模型的 VAE 不是通用的。換模型時先查清楚配對的 VAE，不要假設同一系列的 VAE 通用。

### #2 sd.cpp Tensor Prefix 不需改

**問題：** 擔心 sd.cpp 的 `"vae."` prefix 與模型內部 `first_stage_model.` 不匹配。

**結果：** 搭配 flux2-vae 時，sd.cpp 原始碼的 `"vae."` prefix 可正常運作，**不需改動原始碼**。

**教訓：** 先試預設值，不要預設要改 code。VAE 前綴問題通常是 VAE 檔案選錯，不是 code 的問題。

### #3 ComfyUI 匯出的 GGUF 缺 Prefix

**問題：** 從 ComfyUI 匯出的 GGUF 檔案缺少 `model.diffusion_model.` prefix，sd-server 載入失敗。

**解法：** 使用 leejet 官方發布的 ERNIE-Image GGUF，可被 sd.cpp 直接讀取。或在匯出時選擇 sd.cpp 相容的 tensor naming convention。

**教訓：** GGUF 來源很重要。ComfyUI 匯出的 GGUF 與 sd.cpp 的 GGUF 格式可能有 prefix 差異。優先用 sd.cpp 官方相容的版本。

### #4 Qwen3-TTS 輸出 24kHz WAV，不是 44100Hz MP3

**問題：** 原本 pipeline 預期 ElevenLabs 的 44100Hz MP3。Qwen3-TTS 輸出 24000Hz WAV，assemble.js 搜尋 `.mp3` 找不到檔案直接報錯。

**解法：**
1. `tts_with_asr.js` 存檔副檔名改 `.wav`
2. `assemble.js` 搜尋 `.wav`
3. `assemble.js` 的 ffmpeg 指令加 `-ar 44100` 統一重採樣

**教訓：** 換 TTS 引擎時，一定要查輸出格式（container + sample rate + channel）。assemble.js 現在對音訊格式有隱含假設，換 provider 時連帶要改的檔案不只 TTS 腳本本身。

### #5 ASR conda subprocess 載入成本

**問題：** `qwen_asr` 每次 spawnSync 調用都要重新載入模型，首次 ~13s。10 張投影片 × 2 次（驗證 + 字幕）= 20 次載入 = ~4 分鐘純載入時間。

**緩解：** 模型載入後 conda 環境駐留在記憶體中，後續呼叫較快。但仍比 HTTP API（Whisper）慢。

**未來改進方向：** 將 qwen_asr 包裝成常駐 HTTP server（類似 TTS 的做法），避免重複載入。或用 vLLM 的 `/v1/audio/transcriptions` 端點（Qwen3-ASR 已被 vLLM 支援）。

**教訓：** subprocess 模式適合 demo 驗證，但正式量產建議改成常駐服務。

### #6 破音字 false alarm 大幅降低

**問題：** 原本 OpenAI Whisper 對繁體中文有大量 Simplified/Traditional 誤判，需要 `rescore.py` 做拼音比對第二道防線。

**結果：** Qwen3-ASR 原生輸出繁體中文，Simplified/Traditional 誤判問題基本消除。Demo pipeline 3/3 ASR similarity ≥ 96.6%，正式影片 10/10 ≥ 89.6%。

**教訓：** 換成原生中文 ASR 後，rescore.py 觸發機率極低但仍保留作為安全網。不要刪除——等跑過 20+ 支影片確認穩定再考慮。

### #7 ERNIE-Image-Turbo Sampling Steps 建議 ≥ 50

**問題：** 預設 steps 太低時，生成的中文字容易出現亂碼或缺筆畫。

**調整：** sampling steps 提高到 50 後，文字清晰度顯著提升。低於 30 steps 不可接受。

**代價：** 50 steps 約 50s/張（vs 低 steps 約 20s/張）。10 張投影片 = ~8 分鐘，可接受。

**教訓：** 含中文字的圖片生成對 steps 敏感度高於純風景圖。文字渲染需要更多擴散步驟才能收斂。config.json 已加入 `image.steps` 欄位，預設 50。

### #8 opencode-go 作為 LLM 後端

**發現：** opencode-go/deepseek-v4-flash 可作為 OpenAI chat completions 的替代，endpoint `https://opencode.ai/zen/go/v1/chat/completions`，OpenAI 相容格式。

**用途：** pipeline 中若 agent 需要生成 narration 初稿或分析投影片內容，可用此 endpoint 而非 OpenAI。

**教訓：** chat completions API 的替代比 image/TTS 簡單——只要 OpenAI 相容格式，改 baseURL + model 即可，不需改邏輯。

### #10 ASR 並發優化：串行 → 批次並發

**問題：** 10 張投影片的 ASR 驗證 + 字幕時間戳共 20 次請求，串行處理約 40s（每次 ~2s）。

**解法：** 用 concurrency-limited Promise pool（asyncPool）並發 POST 到 ASR server。
concurrency=4 時，10 張的 ASR 驗證降至 ~6s，字幕時間戳降至 ~6s，總省 ~28s。

**注意事項：**
- concurrency 過高會 GPU OOM（ForcedAligner 0.6B 每個請求約 1.5GB VRAM）
- 預設 4 是安全值；GPU VRAM ≥ 24GB 可試 6
- SRT 條目生成仍需串行（offset 累加），但 ASR 請求可並發
- 單個請求失敗不中斷整批，用 Promise.allSettled 模式收集結果後統一 retry

**教訓：** I/O bound 的工作（HTTP 呼叫 ASR server）一定要並發。asyncPool 是不新增依賴的最簡方案。

### #11 LLM 自動生成腳本：opencode-go 整合

**問題：** 每支影片手寫 narration.json + slides_prompts.json 很耗時，且容易忘記 TTS 安全性規則（破音字、數字、英文縮寫）。

**解法：** 新增 gen_script.py，用 opencode-go/deepseek-v4-flash 一次生成 narration + slides_prompts + cover_prompt。System prompt 嵌入完整的 teaching-style.md + narration-style.md，確保 LLM 遵守所有規則。

**生成後自動檢查：**
- 破音字掃描（heteronyms.json）
- 字數檢查（80-150 字）
- 阿拉伯數字偵測
- 英文縮寫偵測

**注意事項：**
- LLM 輸出的 JSON 可能包 markdown code fence，需清理
- Alignment check 仍需手動確認（條數相等）
- LLM 生成的腳本是初稿，務必人工 review 再進 pipeline
- temperature=0.7 在創意與穩定間取得平衡

**教訓：** LLM 適合生成初稿但不適合直接交付 pipeline。生成的腳本必須經過人工 review（特別是破音字和數字），否則 TTS 會念錯，ASR 驗證會 fail。

### #12 字幕硬壓：gen_subtitles.js 包含 burn 步驟

**問題：** pipeline 產出 video.mp4（無字幕）+ subtitles_aligned.srt（獨立檔），播放器若不支援外掛字幕就看不到字幕。

**解法：** 在 gen_subtitles.js 末尾加入 FFmpeg subtitles filter 步驟，產出 video_sub.mp4（硬壓字幕版）。使用 force_style 參數控制字體、大小、描邊。

**注意事項：**
- subtitles filter 的路徑必須用絕對路徑
- 中文字體需系統已安裝（Noto Sans CJK TC）
- video_sub.mp4 比 video.mp4 大 10-30%（重新編碼）
- crf=23 在品質與大小間取得平衡
- 樣式可在 config.json 的 subtitles 區塊調整

**教訓：** pipeline 的最終產出應是「開箱即用」的。video_sub.mp4 是交付用，video.mp4 是中間產物。

### #13 字幕切分品質修正：重疊 + 極短合併

**問題：** ForcedAligner 詞級時間戳產生兩個品質問題：
- 17 處微重疊：相鄰詞的 end/start 邊界誤差
- 33 條極短字幕（1-5 字）：單字級時間戳產生的碎片

**解法：** 在 gen_subtitles.js 的 SRT 寫入前加入三步修正：
1. 重疊修正：end = min(end, next.start)
2. 極短合併：≤5 字的條目文字附加到前一條，end 延長
3. 二次重疊修正 + 行寬斷行（>42 CJK 自動分割）

**效果：** 270 條 → 237 條，17→0 重疊，29→1 極短，drift 0.06s。

**教訓：** ForcedAligner 的詞級時間戳是精準的，但直接逐詞生成 SRT 會有碎片。需要後處理：合併碎片 + 修正邊界 + 控制行寬。
