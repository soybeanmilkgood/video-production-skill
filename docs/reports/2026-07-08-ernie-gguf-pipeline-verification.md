# ERNIE-Image GGUF 全量 Pipeline 驗證報告

**日期：** 2026-07-08
**Commit:** 52cbd3c
**Tag:** v-ernie-gguf-stable

## 背景

從 Z-Image sd-server 遷移至 ERNIE-Image GGUF (UD-Q5) + sd-cli 雙模式，解決 Z-Image sd-server 每 3-4 張 hang 需重啟的穩定性問題。

## 部署資訊

| 組件 | 路徑 | 大小 |
|------|------|------|
| Turbo UD-Q5 | `unet/turbo/ernie-image-turbo-UD-Q5_K_M.gguf` | 6.3 GB |
| Full UD-Q5 | `unet/full/ernie-image-UD-Q5_K_M.gguf` | 6.3 GB |
| VAE | `vae/flux2-vae.safetensors` | 321 MB |
| Text Encoder | `text_encoders/ministral-3-3b.safetensors` | 7.2 GB |

## 雙模式分工

- 封面 + 第 1 張 + 最後一張 → **Full**（20 steps, cfg 4.0）：長標題/資訊密度品質更優
- 一般內文投影片 → **Turbo**（8 steps, cfg 1.0）：速度優先，用於量產

## 全量測試結果（28 張投影片，2854 字腳本）

### 投影片生成

| 模式 | 張數 | 單張耗時 | 小計 |
|------|:---:|:-------:|:----:|
| Full | 2 | 42s | 84s |
| Turbo | 26 | 15s | 390s |
| **合計** | **28** | — | **474s (7.9 min)** |

### Pipeline 全階段

| 階段 | 結果 |
|------|:----:|
| 投影片生成 | ✅ 28/28 (2 Full + 26 Turbo) |
| Padding | ✅ 28/28, 1920×1080 |
| TTS 合成 | ✅ 28/28, 0 異常（1 次自動重試 14MB 編碼異常） |
| ASR 驗證 | ✅ 28/28 (88.0% ~ 100.0%) |
| FFmpeg 組裝 | ✅ 7:43 (464s), 24 MB, 174kbps |
| 字幕 | ✅ 185 條, drift 0.20s |
| 封面 (Full) | ✅ 1280×720, 42s, 532KB |

### 各階段耗時

| 階段 | 耗時 |
|:-----|:----:|
| 投影片生成 | ~7.9 min |
| TTS + ASR | ~4 min |
| 組裝 | ~1 min |
| 字幕 + 硬壓 | ~1 min |
| 封面 | 42s |
| **總計** | **~15 min** |

## GPU 資源

| 指標 | 數值 |
|:-----|:-----|
| Turbo VRAM 峰值 | ~13.9 GB |
| Full VRAM 峰值 | ~13.9 GB |
| Pipeline 完成後 | 293 MB（全釋放）✅ |

## 與 Z-Image sd-server 方案對比

| 項目 | Z-Image sd-server（舊） | ERNIE sd-cli（新） |
|:-----|:-----------------------:|:-------------------:|
| 穩定性 | 每 3-4 張 hang，需重啟 | subprocess 獨立執行，無 hang |
| GPU 佔用 | 常駐 13GB | 跑完即釋放，閒置 293MB |
| 記憶體洩漏 | VAE 有累積風險 | 無累積（每次全新 process） |
| 模式 | 單一 | Turbo/Full 雙模式自動切換 |
| 投影片生成總耗時 | ~9.3 min（預估） | 7.9 min |
| 速度提升 | — | ~15% |

## 結論

ERNIE-Image GGUF + sd-cli 雙模式方案穩定性與速度均優於 Z-Image sd-server，已標記為穩定版本 `v-ernie-gguf-stable`，建議作為後續影片生產的預設方案。

## 產出檔案（GDrive）

**資料夾：** `gdrive:/long-video-v3/`（6 檔案，38.3 MB）

- `video_sub.mp4`（硬壓字幕交付版，24 MB）
- `video.mp4`（無字幕版，27 MB）
- `subtitles_aligned.srt`
- `thumbnail.jpg`（59 KB）
- `narration.json`
- `slides_prompts.json`
