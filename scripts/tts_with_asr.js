/**
 * TTS + ASR Verification Script (Local Edition, Concurrent ASR)
 *
 * Phase 1: Serial TTS synthesis for all slides
 * Phase 2: Concurrent ASR verification (configurable concurrency)
 * Phase 3: Serial retry of failed slides
 *
 * Usage: node tts_with_asr.js [project_dir]
 */
const fs = require('fs');
const path = require('path');

const PROJECT_DIR = path.resolve(process.argv[2] || process.cwd());
const CONFIG_PATH = path.join(PROJECT_DIR, 'config.json');
const config = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {};
const TTS_CFG = config.tts || {};
const ASR_CFG = config.asr || {};
const PASS_THRESHOLD = ASR_CFG.passThreshold || 0.85;
const MAX_RETRIES = TTS_CFG.maxRetries || 5;
const CONCURRENCY = ASR_CFG.concurrency || 4;

if (!TTS_CFG.baseURL) { console.error('ERROR: tts.baseURL not set in config.json'); process.exit(1); }
const TTS_URL = `${TTS_CFG.baseURL.replace(/\/+$/, '')}/audio/speech`;

const NARR_PATH = path.join(PROJECT_DIR, 'narration.json');
if (!fs.existsSync(NARR_PATH)) { console.error(`ERROR: narration.json not found`); process.exit(1); }
const narration = JSON.parse(fs.readFileSync(NARR_PATH, 'utf8'));
const TOTAL = narration.length;

const audioDir = path.join(PROJECT_DIR, 'audio');
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

console.log(`Project: ${PROJECT_DIR}`);
console.log(`Slides: ${TOTAL} | TTS: ${TTS_CFG.model || 'default'} | Threshold: ${PASS_THRESHOLD} | Concurrency: ${CONCURRENCY}`);
console.log('---');

// --- asyncPool: concurrency-limited Promise pool ---
async function asyncPool(limit, items, fn) {
  const results = [];
  const executing = [];
  for (let i = 0; i < items.length; i++) {
    const p = Promise.resolve().then(() => fn(items[i], i));
    const e = p.then(r => { results[i] = r; });
    executing.push(e);
    if (executing.length >= limit) {
      await Promise.race(executing);
      executing.splice(executing.findIndex(e => e === p), 1);
    }
  }
  await Promise.all(executing);
  return results;
}

// --- Similarity ---
function similarity(a, b) {
  if (!a || !b) return 0;
  const sa = a.replace(/[\s!"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~]/g, '');
  const sb = b.replace(/[\s!"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~]/g, '');
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
    const mod = require(url.protocol === 'https:' ? 'https' : 'http');
    const req = mod.request(url, {
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

// --- ASR via HTTP ---
async function asrTranscribe(audioPath) {
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

// --- Main ---
(async () => {
  console.log(`\nPhase 1: TTS synthesis (serial) — ${TOTAL} slides\n`);

  // Phase 1: Serial TTS
  const slides = [];
  for (let i = 0; i < TOTAL; i++) {
    const num = String(i + 1).padStart(2, '0');
    const text = narration[i];
    const outPath = path.join(audioDir, `slide_${num}.wav`);
    console.log(`[${num}/${String(TOTAL).padStart(2, '0')}] TTS...`);
    try {
      await synthesize(text, outPath);
      const size = fs.statSync(outPath).size;
      console.log(`  → ${Math.round(size / 1024)} KB`);
      slides.push({ idx: i, num, text, path: outPath });
    } catch (err) {
      console.log(`  ❌ TTS failed: ${err.message}`);
    }
  }

  if (slides.length === 0) { console.error('No slides generated, aborting.'); process.exit(1); }

  // Phase 2: Concurrent ASR verification
  console.log(`\nPhase 2: ASR verification (concurrency=${CONCURRENCY})\n`);
  const results = await asyncPool(CONCURRENCY, slides, async (slide) => {
    const transcript = await asrTranscribe(slide.path);
    const sim = similarity(slide.text, transcript);
    const passed = sim >= PASS_THRESHOLD;
    const status = passed ? '✅' : '❌';
    console.log(`[ASR] ${slide.num}/${TOTAL}: ${(sim * 100).toFixed(1)}% ${status}`);
    if (!passed) {
      console.log(`  Original: ${slide.text.substring(0, 60)}...`);
      console.log(`  ASR got:  ${transcript.substring(0, 60)}...`);
    }
    return { ...slide, transcript, sim, passed, retries: 0 };
  });

  // Phase 3: Retry failed slides (serial, with maxRetries)
  let final = results;
  const failed = results.filter(r => !r.passed);
  if (failed.length > 0) {
    console.log(`\nPhase 3: Retrying ${failed.length} failed slide(s)\n`);
    for (const slide of failed) {
      const num = slide.num;
      for (let attempt = 2; attempt <= MAX_RETRIES; attempt++) {
        console.log(`[${num}/${TOTAL}] Retry ${attempt}/${MAX_RETRIES}...`);
        try {
          await synthesize(slide.text, slide.path);
          const transcript = await asrTranscribe(slide.path);
          const sim = similarity(slide.text, transcript);
          const passed = sim >= PASS_THRESHOLD;
          console.log(`[ASR] ${num}/${TOTAL}: ${(sim * 100).toFixed(1)}% ${passed ? '✅' : '❌'}`);
          if (passed) { slide.passed = true; slide.sim = sim; slide.retries = attempt - 1; break; }
        } catch (err) {
          console.log(`  ERROR: ${err.message}`);
        }
      }
    }
  }

  const passedCount = final.filter(r => r.passed).length;
  const failedCount = final.filter(r => !r.passed).length;

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Done! Passed: ${passedCount}, Failed: ${failedCount}, Total: ${TOTAL}`);
  if (failedCount > 0) {
    console.log(`⚠️ ${failedCount} slide(s) did not meet ASR threshold — check for homophone false alarms before re-rolling forever.`);
  }
})();
