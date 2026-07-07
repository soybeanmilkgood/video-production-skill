/**
 * TTS + ASR Verification Script (Local Edition)
 *
 * Reads narration.json from the project directory, synthesizes each entry
 * via Qwen3-TTS HTTP API, and verifies with Qwen3-ASR (qwen_asr library).
 *
 * Usage: node tts_with_asr.js [project_dir]
 *   - project_dir: directory containing narration.json (default: CWD)
 *
 * config.json in project_dir:
 *   { "tts": { "baseURL": "http://localhost:8001/v1", "model": "...",
 *              "voice": "vivian", "maxRetries": 5 },
 *     "asr": { "condaEnv": "qwen3-asr", "model": "Qwen/Qwen3-ASR-1.7B",
 *              "forcedAligner": "Qwen/Qwen3-ForcedAligner-0.6B", "passThreshold": 0.85 } }
 */

const fs = require('fs');
const path = require('path');

// --- Resolve project directory ---
const PROJECT_DIR = path.resolve(process.argv[2] || process.cwd());

// --- Load config ---
const CONFIG_PATH = path.join(PROJECT_DIR, 'config.json');
const config = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {};

const TTS_CFG = config.tts || {};
const ASR_CFG = config.asr || {};
const PASS_THRESHOLD = ASR_CFG.passThreshold || 0.85;
const MAX_RETRIES = TTS_CFG.maxRetries || 5;

if (!TTS_CFG.baseURL) { console.error('ERROR: tts.baseURL not set in config.json'); process.exit(1); }
const TTS_URL = `${TTS_CFG.baseURL.replace(/\/+$/, '')}/audio/speech`;

if (!ASR_CFG.condaEnv) { console.error('ERROR: asr.condaEnv not set in config.json'); process.exit(1); }

// --- Load narration ---
const narrationPath = path.join(PROJECT_DIR, 'narration.json');
if (!fs.existsSync(narrationPath)) {
  console.error(`ERROR: narration.json not found in ${PROJECT_DIR}`);
  process.exit(1);
}
const narration = JSON.parse(fs.readFileSync(narrationPath, 'utf8'));

const audioDir = path.join(PROJECT_DIR, 'audio');
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

console.log(`Project: ${PROJECT_DIR}`);
console.log(`Slides: ${narration.length} | TTS: ${TTS_CFG.model || 'default'} | Threshold: ${PASS_THRESHOLD}`);
console.log('---');

// --- Similarity: character overlap ratio ---
function similarity(a, b) {
  if (!a || !b) return 0;
  const sa = a.replace(/[\s\p{P}]/gu, '');
  const sb = b.replace(/[\s\p{P}]/gu, '');
  if (!sa || !sb) return 0;
  let matches = 0;
  const bChars = sb.split('');
  for (const c of sa) {
    const idx = bChars.indexOf(c);
    if (idx >= 0) { matches++; bChars.splice(idx, 1); }
  }
  return matches / Math.max(sa.length, sb.length);
}

// --- Qwen3-TTS via HTTP API ---
function synthesize(text, outputPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(TTS_URL);
    const body = JSON.stringify({
      model: TTS_CFG.model || undefined,
      input: text,
      voice: TTS_CFG.voice || 'vivian',
      response_format: TTS_CFG.response_format || 'wav',
      speed: TTS_CFG.speed ?? 1.0,
      language: TTS_CFG.language || undefined,
    });
    const https = require(url.protocol === 'https:' ? 'https' : 'http');
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      if (res.statusCode !== 200) {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => reject(new Error(`TTS HTTP ${res.statusCode}: ${data.slice(0, 200)}`)));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { fs.writeFileSync(outputPath, Buffer.concat(chunks)); resolve(); });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// --- Qwen3-ASR via HTTP server (port 8012) ---
async function asrTranscribe(audioPath) {
  const fs = require('fs');
  const buffer = fs.readFileSync(audioPath);
  const form = new FormData();
  form.append('file', new Blob([buffer]), 'audio.wav');
  form.append('return_timestamps', 'false');
  const url = `${ASR_CFG.baseURL || 'http://localhost:8012'}/v1/audio/transcriptions`;
  const res = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`ASR HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.text;
}

// --- Process one slide ---
async function processSlide(idx) {
  const num = String(idx + 1).padStart(2, '0');
  const text = narration[idx];
  const outPath = path.join(audioDir, `slide_${num}.wav`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[${num}/${String(narration.length).padStart(2, '0')}] Attempt ${attempt}/${MAX_RETRIES}...`);

    try {
      await synthesize(text, outPath);
      const size = fs.statSync(outPath).size;
      console.log(`  TTS OK: ${Math.round(size / 1024)} KB`);

      console.log(`  ASR verifying...`);
      const transcript = asrTranscribe(outPath);
      const sim = similarity(text, transcript);
      console.log(`  Similarity: ${(sim * 100).toFixed(1)}%`);

      if (sim >= PASS_THRESHOLD) {
        console.log(`  ✅ PASS`);
        return true;
      } else {
        console.log(`  ❌ FAIL (need ≥${(PASS_THRESHOLD * 100).toFixed(0)}%)`);
        console.log(`  Original: ${text.substring(0, 60)}...`);
        console.log(`  ASR got:  ${transcript.substring(0, 60)}...`);
      }
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
    }
  }

  console.log(`  ⚠️ Keeping best attempt after ${MAX_RETRIES} tries`);
  return false;
}

// --- Main ---
(async () => {
  console.log(`\nStarting TTS+ASR for ${narration.length} slides\n`);
  let passed = 0, failed = 0;

  for (let i = 0; i < narration.length; i++) {
    const ok = await processSlide(i);
    if (ok) passed++; else failed++;
  }

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Done! Passed: ${passed}, Failed: ${failed}, Total: ${narration.length}`);
  if (failed > 0) console.log(`⚠️ ${failed} slide(s) did not meet ASR threshold — see SKILL.md "verify the words, ship on redundancy" before re-rolling forever.`);
})();
