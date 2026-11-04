import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildRenderArgs, createMediaRenderer } from '../src/media.mjs';

const rights={license:'CC BY 4.0',proof:'saved license record',commercialUse:true};

test('FFmpeg args use fixed filters, no shell, and select vertical canvas',()=>{
  const args=buildRenderArgs({slides:[{duration:4,filePath:'image.png'}],audioPath:'voice.wav',outputPath:'out.mp4',layout:'vertical'});
  assert.ok(args.some(arg=>String(arg).includes('1080:1920'))); assert.ok(args.includes('-nostdin')); assert.ok(args.includes('-shortest')); assert.equal(args.at(-1),'out.mp4');
});

test('media render blocks unlicensed/missing assets and shell metacharacters in output name',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'nexora-media-gate-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const root=path.join(dir,'assets'); await mkdir(root); await writeFile(path.join(root,'slide.png'),'image'); await writeFile(path.join(root,'voice.wav'),'audio');
  const renderer=createMediaRenderer({dataDir:dir,env:{NEXORA_ASSET_DIR:root},spawnImpl(){throw new Error('renderer must not run')}});
  await assert.rejects(()=>renderer.render({slides:[{filePath:'slide.png',duration:4,rights}],audioFile:'voice.wav',audioRights:{...rights,commercialUse:false}}),/Rights review required/);
  await assert.rejects(()=>renderer.render({slides:[{filePath:'slide.png',duration:4,rights}],audioFile:'voice.wav',audioRights:rights,outputName:'x;whoami'}),/outputName/);
});

test('media renderer creates a completed export through an injected FFmpeg process',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'nexora-media-run-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const root=path.join(dir,'assets'); await mkdir(root); await writeFile(path.join(root,'slide.png'),'image'); await writeFile(path.join(root,'voice.wav'),'audio');
  let invocation;
  const renderer=createMediaRenderer({dataDir:dir,env:{NEXORA_ASSET_DIR:root},spawnImpl(binary,args,options){invocation={binary,args,options};const child=new EventEmitter();child.stderr=new EventEmitter();setImmediate(async()=>{await writeFile(args.at(-1),'rendered mp4 bytes');child.emit('close',0)});return child;}});
  const result=await renderer.render({slides:[{filePath:'slide.png',duration:6,rights}],audioFile:'voice.wav',audioRights:rights,layout:'vertical',outputName:'verified-export'});
  assert.equal(result.status,'completed'); assert.equal(result.layout,'vertical'); assert.equal(result.plannedDurationSeconds,6); assert.equal(invocation.options.shell,false); assert.equal(invocation.binary,'ffmpeg'); assert.match(result.filePath,/exports[\\/]verified-export\.mp4$/);
});
