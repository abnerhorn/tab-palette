#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const help = `Encode captured UI-film frames serially as MP4, WebM, poster and optional GIF.
Required: --capture DIRECTORY --output /absolute/stem
Options: --ffmpeg PATH (or FFMPEG), --poster-ms NUMBER, --gif, --overwrite
Reads capture.json and requires a complete fresh frame sequence.`;
const options = {};
for (let i=2;i<process.argv.length;i++) {
  const key=process.argv[i].replace(/^--/,'');
  if (key==='help') { console.log(help); process.exit(0); }
  if (['gif','overwrite'].includes(key)) { options[key]=true; continue; }
  if (!['capture','output','ffmpeg','poster-ms'].includes(key) || !process.argv[i+1] || process.argv[i+1].startsWith('--')) throw new Error(`Invalid argument: ${process.argv[i]}\n${help}`);
  options[key]=process.argv[++i];
}
if (!options.capture || !options.output) throw new Error(help);
const capture=path.resolve(options.capture), output=path.resolve(options.output);
const metadata=JSON.parse(await fs.readFile(path.join(capture,'capture.json'),'utf8'));
if (!metadata.capturedFrames || metadata.capturedFrames!==metadata.frameCount) throw new Error('Capture contains stills only or an incomplete sequence.');
if (metadata.exportWidth%2 || metadata.exportHeight%2) throw new Error('Export dimensions must be even.');
const frames=path.join(capture,'frames');
const names=(await fs.readdir(frames)).filter(name=>/^\d{5}\.png$/.test(name));
if (names.length!==metadata.frameCount) throw new Error('Frame count differs from capture metadata.');
for(let index=0;index<metadata.frameCount;index++) await fs.access(path.join(frames,`${String(index).padStart(5,'0')}.png`));
const posterMs=Number(options['poster-ms']??metadata.durationMs*.75);
if (!(posterMs>=0 && posterMs<metadata.durationMs)) throw new Error('Poster time is outside the film.');
await fs.mkdir(path.dirname(output),{recursive:true});
const extensions=['mp4','webm','png','json',...(options.gif?['gif']:[])];
if (!options.overwrite) for(const extension of extensions) { try { await fs.access(`${output}.${extension}`); throw new Error(`Output exists: ${output}.${extension}; use --overwrite deliberately.`); } catch(error) { if(error.code!=='ENOENT') throw error; } }
const ffmpeg=options.ffmpeg || process.env.FFMPEG || 'ffmpeg';
const run=args=>{
  const result=spawnSync(ffmpeg,['-hide_banner','-loglevel','warning','-filter_threads','1','-filter_complex_threads','1',options.overwrite?'-y':'-n',...args],{stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`FFmpeg exited ${result.status}`);
};
run(['-framerate',String(metadata.fps),'-i',path.join(frames,'%05d.png'),'-frames:v',String(metadata.frameCount),'-an','-c:v','libx264','-preset','slow','-crf','14','-pix_fmt','yuv420p','-movflags','+faststart','-threads','2',`${output}.mp4`]);
run(['-i',`${output}.mp4`,'-an','-c:v','libvpx-vp9','-crf','18','-b:v','0','-deadline','good','-cpu-used','3','-pix_fmt','yuv420p','-threads','2',`${output}.webm`]);
if(options.gif)run(['-i',`${output}.mp4`,'-filter_complex','fps=20,scale=2160:1176:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=full:reserve_transparent=0[p];[b][p]paletteuse=dither=none:diff_mode=rectangle','-loop','0','-threads','2',`${output}.gif`]);
const posterFrame=Math.min(metadata.frameCount-1,Math.round(posterMs*metadata.fps/1000));
await fs.copyFile(path.join(frames,`${String(posterFrame).padStart(5,'0')}.png`),`${output}.png`);
await fs.writeFile(`${output}.json`,JSON.stringify({capture,exportWidth:metadata.exportWidth,exportHeight:metadata.exportHeight,fps:metadata.fps,frameCount:metadata.frameCount,durationSeconds:metadata.frameCount/metadata.fps,posterFrame,audio:false,formats:options.gif?['mp4','webm','gif']:['mp4','webm'],codecs:{mp4:'H.264 CRF14 slow yuv420p faststart',webm:'VP9 CRF18 bitrate0 good cpu-used3 yuv420p'},verifiedEncodedFrames:false},null,2)+'\n');
console.log('Saved MP4, WebM, full-resolution poster and export metadata. Inspect decoded output before delivery.');
