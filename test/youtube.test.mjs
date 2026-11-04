import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createStore } from '../src/store.mjs';
import { createYouTubeIntegration } from '../src/youtube.mjs';

test('YouTube OAuth uses one-time state, PKCE, least-privilege read scopes, and encrypted tokens',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'nexora-oauth-'));
  const store=createStore(dir); t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true})});
  const key=Buffer.alloc(32,7).toString('base64'); let sentBody;
  const fakeFetch=async(_url,options)=>{sentBody=options.body.toString();return new Response(JSON.stringify({access_token:'access-secret-value',refresh_token:'refresh-secret-value',expires_in:3600,scope:'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly',token_type:'Bearer'}),{status:200,headers:{'content-type':'application/json'}})};
  const yt=createYouTubeIntegration({store,env:{NEXORA_GOOGLE_CLIENT_ID:'client-id',NEXORA_GOOGLE_CLIENT_SECRET:'client-secret',NEXORA_TOKEN_ENCRYPTION_KEY:key},port:3000,fetchImpl:fakeFetch});
  const url=new URL(yt.start('read')); assert.equal(url.origin,'https://accounts.google.com'); assert.equal(url.searchParams.get('code_challenge_method'),'S256'); assert.ok(url.searchParams.get('code_challenge')); assert.doesNotMatch(url.searchParams.get('scope'),/youtube\.upload/);
  const state=url.searchParams.get('state'); const result=await yt.callback({code:'temporary-auth-code',state}); assert.equal(result.connected,true); assert.equal(yt.status().connected,true); assert.match(sentBody,/code_verifier=/);
  const persisted=JSON.stringify(store.get('secrets','youtube_tokens')); assert.doesNotMatch(persisted,/access-secret-value|refresh-secret-value/);
  assert.equal(await yt.accessToken(), 'access-secret-value'); await assert.rejects(()=>yt.callback({code:'replay',state}),/missing, expired, or already used/);
  await yt.disconnect(); assert.equal(yt.status().connected,false);
});

test('publishing consent is a separate explicit OAuth mode',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'nexora-oauth-publish-'));
  const store=createStore(dir); t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true})});
  const yt=createYouTubeIntegration({store,env:{NEXORA_GOOGLE_CLIENT_ID:'client-id',NEXORA_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64')},fetchImpl:async()=>new Response('{}')});
  const url=new URL(yt.start('publish')); assert.match(url.searchParams.get('scope'),/youtube\.upload/); assert.throws(()=>yt.start('anything'),/mode must be/);
});

test('upload requires explicit approval, exact licensed export, quality, upload scope, and defaults private',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'nexora-upload-'));
  const store=createStore(dir); t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true})});
  const exportDir=path.join(dir,'exports'); await mkdir(exportDir); const filePath=path.join(exportDir,'final.mp4'); await writeFile(filePath,Buffer.from('fake-mp4-data'));
  const key=Buffer.alloc(32,3).toString('base64'); let uploadMetadata; let uploadedBytes=0;
  const fetchImpl=async(url,options)=>{
    if(url==='https://oauth2.googleapis.com/token') return new Response(JSON.stringify({access_token:'access',refresh_token:'refresh',expires_in:3600,scope:'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.upload'}),{status:200});
    if(String(url).includes('uploadType=resumable')) {uploadMetadata=JSON.parse(options.body);return new Response('{}',{status:200,headers:{location:'https://upload.test/session'}})}
    if(url==='https://upload.test/session') {for await(const chunk of options.body) uploadedBytes+=chunk.length;return new Response(JSON.stringify({id:'video-123'}),{status:200})}
    throw new Error(`Unexpected URL ${url}`);
  };
  const yt=createYouTubeIntegration({store,env:{NEXORA_GOOGLE_CLIENT_ID:'client',NEXORA_TOKEN_ENCRYPTION_KEY:key},dataDir:dir,fetchImpl});
  const auth=new URL(yt.start('publish')); await yt.callback({code:'one-time-code',state:auth.searchParams.get('state')});
  const quality=Object.fromEntries(['originality','storytelling','visualQuality','audioQuality','editingQuality','factualAccuracy','subtitleQuality','thumbnailQuality','audienceValue','copyrightCompliance'].map((k,i)=>[k,i===9?100:90]));
  const request={filePath,title:'A careful explainer',assets:[{url:'final.mp4',license:'CC BY 4.0',proof:'license record',commercialUse:true}],quality};
  await assert.rejects(()=>yt.upload(request),/Explicit approval/);
  await assert.rejects(()=>yt.upload({...request,explicitApproval:true,privacyStatus:'public'}),/separate explicit approval/);
  const result=await yt.upload({...request,explicitApproval:true});
  assert.equal(result.uploaded,true); assert.equal(result.privacyStatus,'private'); assert.equal(uploadMetadata.status.privacyStatus,'private'); assert.equal(uploadedBytes,13);
});
