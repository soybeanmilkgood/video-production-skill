/* Pad slides into 1920x1080 with subtitle-safe bottom band.

   Two input aspect ratios handled:
   - 3:2 (1536x1024, old ERNIE-Image-Turbo): scale to 1410x940, pad to 1920x1080
   - 16:9 (1024x576, Z-Image-Turbo): scale to 1920x940, white pad to 1920x1080

   Usage:
     node pad_and_burn.js pad  [project_dir]  # slides_raw/slide_NN.png -> slides/slide_NN.png
     node pad_and_burn.js burn [project_dir]  # video.mp4 + subtitles_aligned.srt -> video_sub.mp4

   Why pad: generated slides are full-bleed — burning subtitles straight onto them covers
   slide content. The white band keeps subtitles fully separated from content.
   Tune burn style with env vars SUB_FS (font size, default 30) / SUB_MV (margin, 30). */
const fs=require('fs'), path=require('path'), {execSync}=require('child_process');
const mode=process.argv[2];
const DIR=path.resolve(process.argv[3]||process.cwd());
const cfgP=path.join(DIR,'config.json');
const cfg=fs.existsSync(cfgP)?JSON.parse(fs.readFileSync(cfgP,'utf8')):{};
const FFMPEG=cfg.ffmpeg||'ffmpeg';
const FFPROBE=cfg.ffprobe||'ffprobe';
const SRC=path.join(DIR,'slides_raw'), OUT=path.join(DIR,'slides');

if(mode==='pad'){
  if(!fs.existsSync(SRC)){console.error(`ERROR: ${SRC} not found`);process.exit(1);}
  if(!fs.existsSync(OUT)) fs.mkdirSync(OUT,{recursive:true});
  // clear old padded slides
  for(const f of fs.readdirSync(OUT)) if(/^slide_\d+\.png$/i.test(f)) fs.unlinkSync(path.join(OUT,f));
  const files=fs.readdirSync(SRC).filter(f=>/^slide_\d+\.png$/i.test(f)).sort();
  for(const f of files){
    const inp=path.join(SRC,f), outp=path.join(OUT,f);
    // Detect aspect ratio: 3:2 gets 1410x940 scale, 16:9 gets 1920x940
    const dimCmd=`"${FFPROBE}" -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${inp}"`;
    const dimOut=execSync(dimCmd,{stdio:'pipe'}).toString().trim();
    const [w,h]=dimOut.split(',').map(Number);
    const ratio=w/h;
    let vf;
    if(Math.abs(ratio-16/9)<0.01){
      // 16:9 → scale to 1920x940, pad to 1920x1080 (140px bottom band)
      vf=`scale=1920:940:flags=lanczos,pad=1920:1080:0:0:color=white`;
    } else {
      // 3:2 or other → scale to 1410x940, pad centered to 1920x1080
      vf=`scale=1410:940:flags=lanczos,pad=1920:1080:255:0:color=white`;
    }
    execSync(`"${FFMPEG}" -y -i "${inp}" -vf "${vf}" "${outp}"`,{stdio:'pipe'});
    console.log(`padded ${f}`);
  }
  console.log(`Done: padded ${files.length} slides.`);
}
else if(mode==='burn'){
  const srt=path.join(DIR,'subtitles_aligned.srt');
  const vin=path.join(DIR,'video.mp4');
  const vout=path.join(DIR,'video_sub.mp4');
  // dark text inside the white bottom band; FontSize/MarginV tuned for 1080p 140px band.
  // For full-bleed dark slides (HTML path) use SUB_FS=14-18, SUB_MV=6-12 and a
  // BorderStyle=3 boxed style instead — see SKILL.md Step 6.
  const FS=process.env.SUB_FS||'30', MV=process.env.SUB_MV||'30';
  const style=`FontName=Microsoft JhengHei,FontSize=${FS},PrimaryColour=&H00202020,OutlineColour=&H00FFFFFF,BorderStyle=1,Outline=1,Shadow=0,MarginV=${MV},Alignment=2`;
  // ffmpeg subtitles filter needs escaped path on Windows
  const srtEsc=srt.replace(/\\/g,'/').replace(/:/g,'\\:');
  execSync(`"${FFMPEG}" -y -i "${vin}" -vf "subtitles='${srtEsc}':force_style='${style}'" -c:v libx264 -tune stillimage -pix_fmt yuv420p -c:a copy "${vout}"`,{stdio:'pipe'});
  const sz=(fs.statSync(vout).size/1024/1024).toFixed(1);
  console.log(`Burned subtitles -> video_sub.mp4 (${sz} MB)`);
}
else { console.log('usage: node pad_and_burn.js pad|burn [project_dir]'); }
