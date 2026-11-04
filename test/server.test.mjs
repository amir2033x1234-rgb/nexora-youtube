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
  const child=spawn(process.execPath,['server.mjs'],{cwd:projectRoot,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),NEXORA_DATA_DIR:dir,NEXORA_DAILY_JOB_LIMIT:'1',NEXORA_ADMIN_USERNAME:'owner',NEXORA_ADMIN_PASSWORD:'test-password-only'},stdio:['ignore','ignore','pipe']});
  let startupError=''; child.stderr.setEncoding('utf8'); child.stderr.on('data',chunk=>startupError+=chunk); child.on('error',error=>startupError+=`${error.code||''} ${error.message}`);
  t.after(async()=>{child.kill('SIGTERM');await new Promise(r=>setTimeout(r,100));await rm(dir,{recursive:true,force:true})});
  const base=`http://127.0.0.1:${port}`; let ready=false, connectError='';
  for(let i=0;i<50;i++){try{const r=await fetch(`${base}/api/health`);if(r.ok){ready=true;break}}catch(error){connectError=error.cause?.code||error.message} await new Promise(r=>setTimeout(r,100))}
  if(!ready && /EACCES|EPERM|operation not permitted/i.test(`${startupError} ${connectError}`)) { t.skip(`server process or loopback binding is blocked by the execution environment: ${startupError} ${connectError}`.trim()); return; }
  assert.equal(ready,true,`server starts${startupError||connectError?`: ${startupError} ${connectError}`:''}`);
  const blocked=await fetch(`${base}/api/status`);assert.equal(blocked.status,401);
  const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'owner',password:'test-password-only'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];const {csrfToken}=await login.json();
  const secureFetch=(url,options={})=>fetch(url,{...options,headers:{cookie,'content-type':'application/json',...(options.headers||{})}});
  const status=await secureFetch(`${base}/api/status`).then(r=>r.json());assert.equal(status.publishing.enabled,false);assert.equal(status.security.authenticationRequired,true);
  const channelResponse=await secureFetch(`${base}/api/channels`,{method:'POST',headers:{'x-csrf-token':csrfToken},body:JSON.stringify({name:'Science'})});assert.equal(channelResponse.status,201);const channel=await channelResponse.json();
  const savedScript=await secureFetch(`${base}/api/scripts`,{method:'POST',headers:{'x-csrf-token':csrfToken},body:JSON.stringify({topic:'Ocean heat',channelId:channel.id})});assert.equal(savedScript.status,201);
  const scopedScripts=await secureFetch(`${base}/api/scripts?channelId=${channel.id}`).then(r=>r.json());assert.equal(scopedScripts.length,1);assert.equal(scopedScripts[0].channelId,channel.id);
  const invalidScript=await secureFetch(`${base}/api/scripts`,{method:'POST',headers:{'x-csrf-token':csrfToken},body:JSON.stringify({topic:'Bad channel',channelId:'missing'})});assert.equal(invalidScript.status,404);  const unknownChannel=await secureFetch(`${base}/api/calendar?channelId=missing`);assert.equal(unknownChannel.status,404);  const csrfDenied=await secureFetch(`${base}/api/calendar`,{method:'POST',body:JSON.stringify({title:'No CSRF',scheduledFor:new Date().toISOString()})});assert.equal(csrfDenied.status,403);
  const body={topic:'Test topic',channelId:'default',assets:[{url:'licensed',license:'CC BY',proof:'license page',commercialUse:true}],quality:Object.fromEntries(['originality','storytelling','visualQuality','audioQuality','editingQuality','factualAccuracy','subtitleQuality','thumbnailQuality','audienceValue','copyrightCompliance'].map((k,i)=>[k,i===9?100:90]))};
  const queued=await secureFetch(`${base}/api/jobs`,{method:'POST',headers:{'x-csrf-token':csrfToken},body:JSON.stringify(body)});assert.equal(queued.status,202);const job=await queued.json();
  const retry=await secureFetch(`${base}/api/jobs/${job.id}/retry`,{method:'POST',headers:{'x-csrf-token':csrfToken}});assert.equal(retry.status,202);
  const quota=await secureFetch(`${base}/api/jobs`,{method:'POST',headers:{'x-csrf-token':csrfToken},body:JSON.stringify(body)});assert.equal(quota.status,429);
  const publish=await secureFetch(`${base}/api/publish/prepare`,{method:'POST',headers:{'x-csrf-token':csrfToken},body:JSON.stringify({explicitApproval:true})});assert.equal(publish.status,409);assert.equal((await publish.json()).published,false);
});
