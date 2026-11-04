import { spawn as spawnProcess } from 'node:child_process';
import { mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateAssetRights } from './domain.mjs';

const IMAGE_TYPES=new Set(['.jpg','.jpeg','.png','.webp']);
const AUDIO_TYPES=new Set(['.mp3','.wav','.m4a','.aac','.flac','.ogg']);

export function buildRenderArgs({slides,audioPath,outputPath,layout='landscape'}) {
  const size=layout==='vertical'?'1080:1920':'1920:1080';
  const args=['-hide_banner','-nostdin','-n'];
  for(const slide of slides) args.push('-loop','1','-t',String(slide.duration),'-i',slide.filePath);
  args.push('-i',audioPath);
  const [width,height]=size.split(':');
  const chains=slides.map((_,i)=>`[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=30,format=yuv420p[v${i}]`);
  chains.push(`${slides.map((_,i)=>`[v${i}]`).join('')}concat=n=${slides.length}:v=1:a=0[v]`);
  const audioIndex=slides.length;
  args.push('-filter_complex',chains.join(';'),'-map','[v]','-map',`${audioIndex}:a:0`,'-shortest','-c:v','libx264','-preset','medium','-crf','21','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-movflags','+faststart',outputPath);
  return args;
}

export function createMediaRenderer({dataDir,env=process.env,spawnImpl=spawnProcess}) {
  const assetRoot=path.resolve(env.NEXORA_ASSET_DIR||path.join(dataDir,'assets'));
  const exportRoot=path.resolve(dataDir,'exports');
  async function safeFile(file,root,extensions) {
    if(!file)throw new Error('Every input needs a file path.');
    const candidate=path.resolve(root,String(file)); const realRoot=await realpath(root).catch(async()=>{await mkdir(root,{recursive:true});return realpath(root)}); const actual=await realpath(candidate);
    if(!actual.startsWith(realRoot+path.sep))throw new Error('Media inputs must remain inside the configured asset directory.');
    const info=await stat(actual); if(!info.isFile()||info.size<1)throw new Error('Every media input must be a non-empty file.');
    if(!extensions.has(path.extname(actual).toLowerCase()))throw new Error(`Unsupported media input type: ${path.extname(actual)||'(none)'}.`);
    return actual;
  }
  async function render({slides,audioFile,audioRights,layout='landscape',outputName}) {
    if(!Array.isArray(slides)||slides.length<1||slides.length>24)throw new Error('Provide 1–24 licensed image slides.');
    if(!['landscape','vertical'].includes(layout))throw new Error('layout must be landscape or vertical.');
    const name=String(outputName||`nexora-${randomUUID()}`).slice(0,80); if(!/^[a-zA-Z0-9_-]+$/.test(name))throw new Error('outputName may contain only letters, numbers, hyphens, and underscores.');
    const total=slides.reduce((n,s)=>n+Number(s.duration||0),0); if(slides.some(s=>!Number.isFinite(Number(s.duration))||Number(s.duration)<1||Number(s.duration)>120)||total>3600)throw new Error('Each slide must last 1–120 seconds and total runtime must not exceed one hour.');
    const rightsInputs=[...slides.map(s=>({...s.rights,url:path.basename(String(s.filePath||''))})),{...audioRights,url:path.basename(String(audioFile||''))}];
    const rights=validateAssetRights(rightsInputs); if(!rights.ready)throw new Error(`Rights review required: ${rights.issues.join(' ')}`);
    const imagePaths=[]; for(const slide of slides)imagePaths.push(await safeFile(slide.filePath,assetRoot,IMAGE_TYPES));
    const audioPath=await safeFile(audioFile,assetRoot,AUDIO_TYPES); await mkdir(exportRoot,{recursive:true});
    const outputPath=path.join(exportRoot,`${name}.mp4`); const args=buildRenderArgs({slides:slides.map((s,i)=>({...s,filePath:imagePaths[i]})),audioPath,outputPath,layout});
    const binary=env.NEXORA_FFMPEG_PATH||'ffmpeg';
    await new Promise((resolve,reject)=>{
      let stderr=''; const child=spawnImpl(binary,args,{shell:false,windowsHide:true,stdio:['ignore','ignore','pipe']});
      child.stderr?.on('data',chunk=>{stderr+=String(chunk);if(stderr.length>4000)stderr=stderr.slice(-4000)});
      child.once('error',error=>reject(new Error(`FFmpeg could not start (${error.message}). Install FFmpeg and retry; no video was produced.`)));
      child.once('close',code=>code===0?resolve():reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-1000)}`)));
    });
    const output=await stat(outputPath).catch(()=>null); if(!output?.isFile()||output.size===0)throw new Error('FFmpeg reported success but produced no video file.');
    return {id:randomUUID(),status:'completed',filePath:outputPath,sizeBytes:output.size,plannedDurationSeconds:total,layout,renderer:'FFmpeg',sourceAssets:rightsInputs,createdAt:new Date().toISOString(),note:'Static-image edit with licensed inputs and supplied audio; no generated footage or voiceover.'};
  }
  return {render,assetRoot,exportRoot};
}
