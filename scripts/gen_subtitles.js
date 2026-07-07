/* Generate aligned SRT: Qwen3-ASR word timestamps for timing, ORIGINAL narration text
   for display (ASR output mishears — never use it as subtitle text).
   Offsets come from ACTUAL clip durations (ffprobe on temp/clip_XX.mp4), which avoids
   the -shortest drift bug (assuming audioDur+padding drifts +1s per slide).

   Usage: node gen_subtitles.js [project_dir]
   Needs: config.json with asr.condaEnv / asr.model / asr.forcedAligner,
   temp/clip_XX.mp4 from assemble.js, audio/slide_XX.wav, narration.json.
   Word timings are cached in temp/words_NN.json (re-runs are free). */
const fs=require('fs'),path=require('path'),{execSync}=require('child_process');
const DIR=path.resolve(process.argv[2]||process.cwd());
const cfgP=path.join(DIR,'config.json');
const cfg=fs.existsSync(cfgP)?JSON.parse(fs.readFileSync(cfgP,'utf8')):{};
const ASR_CFG=cfg.asr||{};
const FFPROBE=cfg.ffprobe||'ffprobe';
const narration=JSON.parse(fs.readFileSync(path.join(DIR,'narration.json'),'utf8'));
const N=narration.length;

if(!ASR_CFG.condaEnv){console.error('ERROR: asr.condaEnv not set in config.json');process.exit(1);}

function clipDur(i){const p=path.join(DIR,'temp',`clip_${String(i+1).padStart(2,'0')}.mp4`);return parseFloat(execSync(`"${FFPROBE}" -v error -show_entries format=duration -of csv=p=0 "${p}"`,{encoding:'utf8'}).trim());}

async function asrWords(audioPath, knownText){
  const fs2=require('fs');
  const buf=fs2.readFileSync(audioPath);
  const fd=new FormData();
  fd.append('file',new Blob([buf]),'audio.wav');
  fd.append('return_timestamps','true');
  fd.append('text',knownText);
  const url=`${ASR_CFG.baseURL||'http://localhost:8012'}/v1/audio/transcriptions`;
  const res=await fetch(url,{method:'POST',body:fd,signal:AbortSignal.timeout(120000)});
  if(!res.ok)throw new Error(`ASR HTTP ${res.status}`);
  const data=await res.json();
  return data.words;
}

// split into tokens, marking strong (sentence-ending) boundaries; strip punctuation for display
function splitTokens(text){
  const toks=[]; let cur='';
  for(const ch of text){
    if('。！？'.includes(ch)){ if(cur.trim())toks.push({t:cur.trim(),strong:true}); cur=''; }
    else if('，；、：—–…\n,;:'.includes(ch)){ if(cur.trim())toks.push({t:cur.trim(),strong:false}); cur=''; }
    else if('「」『』（）()《》'.includes(ch)){ /* drop quotes/brackets */ }
    else cur+=ch;
  }
  if(cur.trim())toks.push({t:cur.trim(),strong:false});
  return toks.filter(x=>x.t);
}
// display width: CJK = 1, Latin/space = 0.5 (max 16 full-width per line to avoid wrapping)
function dw(s){let w=0;for(const c of s)w+= c.charCodeAt(0)<=0xff?0.5:1; return w;}
function capSplit(s,maxw){ // split s into pieces of width<=maxw, never inside a Latin run
  const parts=[]; let cur='', curw=0;
  for(let i=0;i<s.length;i++){
    let seg=s[i];
    if(/[A-Za-z0-9]/.test(seg)){ while(i+1<s.length && /[A-Za-z0-9]/.test(s[i+1])) seg+=s[++i]; }
    const w=dw(seg);
    if(curw+w>maxw && cur){ parts.push(cur); cur=''; curw=0; }
    cur+=seg; curw+=w;
  }
  if(cur)parts.push(cur);
  return parts;
}
function chunks(text){
  const toks=splitTokens(text);
  const out=[];
  for(const tk of toks){
    const prev=out[out.length-1];
    if(prev && !prev.strong && (tk.t.length<6 || prev.t.length<8) && (dw(prev.t)+dw(tk.t))<=16){
      prev.t+=tk.t; prev.strong=tk.strong;
    } else out.push({t:tk.t,strong:tk.strong});
  }
  const capped=[];
  for(const o of out){ for(const p of capSplit(o.t,16)) capped.push(p); }
  return capped;
}

function fmt(t){let ms=Math.round((t-Math.floor(t))*1000);let sec=Math.floor(t);if(ms>=1000){ms-=1000;sec+=1;}const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;}

(async()=>{
  let offset=0, srt='', idx=1;
  for(let i=0;i<N;i++){
    const cd=clipDur(i);
    const wav=path.join(DIR,'audio',`slide_${String(i+1).padStart(2,'0')}.wav`);
    const cacheP=path.join(DIR,'temp',`words_${String(i+1).padStart(2,'0')}.json`);
    let words=[];
    if(fs.existsSync(cacheP)){ words=JSON.parse(fs.readFileSync(cacheP,'utf8')); }
    else { try{words=await asrWords(wav,narration[i]);fs.writeFileSync(cacheP,JSON.stringify(words));}catch(e){console.log(`slide ${i+1} asr err: ${e.message} — falling back to proportional timing`);} }
    const speechStart = words.length? Math.max(0, words[0].start-0.05):0;
    const speechEnd = words.length? Math.min(cd, words[words.length-1].end):cd;
    const span = Math.max(0.5, speechEnd-speechStart);
    const ch = chunks(narration[i]);
    const strip2=(s)=>s.replace(/\s+/g,'');
    const totalChars = ch.reduce((a,c)=>a+strip2(c).length,0)||1;
    const flat=[];
    for(const w of words){
      const t=strip2(w.word||''); const n2=t.length||1;
      for(let j=0;j<t.length;j++) flat.push(w.start + (w.end-w.start)*(j/n2));
    }
    const timeAtChar=(k)=>{
      if(!flat.length) return speechStart + (k/totalChars)*span;
      const idx2=Math.min(flat.length-1, Math.max(0, Math.round(k*flat.length/totalChars)));
      return Math.min(Math.max(flat[idx2], speechStart), speechEnd);
    };
    let cum=0;
    for(let k=0;k<ch.length;k++){
      const c=ch[k];
      const a=cum, b=cum+strip2(c).length; cum+=strip2(c).length;
      let st=offset+ timeAtChar(a);
      let en=offset+ (k===ch.length-1? speechEnd : timeAtChar(b));
      if(en-st<0.6) en=st+0.6;
      srt+=`${idx++}\n${fmt(st)} --> ${fmt(en)}\n${c}\n\n`;
    }
    offset+=cd;
    console.log(`slide ${String(i+1).padStart(2,'0')}: clip=${cd.toFixed(2)}s words=${words.length} chunks=${ch.length}`);
  }
  fs.writeFileSync(path.join(DIR,'subtitles_aligned.srt'), '\ufeff'+srt, 'utf8');
  console.log(`\nSRT written. total video offset=${offset.toFixed(2)}s`);
})();
