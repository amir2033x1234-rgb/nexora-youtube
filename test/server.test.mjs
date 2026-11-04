import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('HTTP app persists records, enforces rights and never publishes',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'nexora-test-')); const port=32000+Math.floor(Math.random()*2000);
  const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const child=spawn(process.execPath,['server.mjs'],{cwd:projectRoot,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),NEXORA_DATA_DIR:dir,NEXORA_DAILY_JOB_LIMIT:'1'},stdio:['ignore','ignore','pipe']});
  let startupError=''; child.stderr.setEncoding('utf8'); child.stderr.on('data',chunk=>startupError+=chunk); child.on('error',error=>startupError+=`${error.code||''} ${error.message}`);
  t.after(async()=>{child.kill('SIGTERM');await new Promise(r=>setTimeout(r,100));await rm(dir,{recursive:true,force:true})});
  const base=`http://127.0.0.1:${port}`; let ready=false, connectError='';
  for(let i=0;i<50;i++){try{const r=await fetch(`${base}/api/health`);if(r.ok){ready=true;break}}catch(error){connectError=error.cause?.code||error.message} await new Promise(r=>setTimeout(r,100))}
  if(!ready && /EACCES|EPERM|operation not permitted/i.test(`${startupError} ${connectError}`)) { t.skip(`server process or loopback binding is blocked by the execution environment: ${startupError} ${connectError}`.trim()); return; }
  assert.equal(ready,true,`server starts${startupError||connectError?`: ${startupError} ${connectError}`:''}`);
  const status=await fetch(`${base}/api/status`).then(r=>r.json());assert.equal(status.publishing.enabled,false);
  const body={topic:'Test topic',channelId:'default',assets:[{url:'licensed',license:'CC BY',proof:'license page',commercialUse:true}],quality:Object.fromEntries(['originality','storytelling','visualQuality','audioQuality','editingQuality','factualAccuracy','subtitleQuality','thumbnailQuality','audienceValue','copyrightCompliance'].map((k,i)=>[k,i===9?100:90]))};
  const queued=await fetch(`${base}/api/jobs`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(queued.status,202);const job=await queued.json();
  const retry=await fetch(`${base}/api/jobs/${job.id}/retry`,{method:'POST'});assert.equal(retry.status,202);
  const quota=await fetch(`${base}/api/jobs`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(quota.status,429);
  const publish=await fetch(`${base}/api/publish/prepare`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({explicitApproval:true})});assert.equal(publish.status,409);assert.equal((await publish.json()).published,false);
});
