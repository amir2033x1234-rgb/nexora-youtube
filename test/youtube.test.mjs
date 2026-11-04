import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createStore } from '../src/store.mjs';
import { createYouTubeIntegration, validateRedirectUri } from '../src/youtube.mjs';

test('OAuth redirect accepts cloud HTTPS and local loopback only',()=>{
  assert.equal(validateRedirectUri('https://studio.example.com/api/youtube/oauth/callback'),'https://studio.example.com/api/youtube/oauth/callback');
  assert.equal(validateRedirectUri(undefined,4321),'http://127.0.0.1:4321/api/youtube/oauth/callback');
  assert.equal(validateRedirectUri('http://localhost:3000/api/youtube/oauth/callback'),'http://localhost:3000/api/youtube/oauth/callback');
  for(const uri of ['http://studio.example.com/api/youtube/oauth/callback','https://studio.example.com/other','https://user:pass@studio.example.com/api/youtube/oauth/callback','https://studio.example.com/api/youtube/oauth/callback?next=/']) assert.throws(()=>validateRedirectUri(uri),/OAuth redirect must use HTTPS/);
});

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

test('channel management scope is optional and playlist creation and metadata updates require explicit approval',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'nexora-oauth-manage-'));
  const store=createStore(dir); t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true})});
  const key=Buffer.alloc(32,6).toString('base64'); const calls=[];
  const fetchImpl=async(url,options={})=>{
    calls.push({url:String(url),method:options.method||'GET',body:options.body});
    if(url==='https://oauth2.googleapis.com/token')return new Response(JSON.stringify({access_token:'manage-access',refresh_token:'manage-refresh',expires_in:3600,scope:'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube'}),{status:200});
    if(String(url).includes('/videos?part=snippet&id='))return new Response(JSON.stringify({items:[{id:'abcdefghijk',snippet:{title:'Old',description:'Keep intact',categoryId:'27',tags:['old']}}]}),{status:200});
    if(String(url).includes('/playlists?part=snippet,status'))return new Response(JSON.stringify({id:'playlist123'}),{status:200});
    if(String(url).includes('/videos?part=snippet'))return new Response(JSON.stringify({id:'abcdefghijk'}),{status:200});
    throw new Error(`Unexpected URL ${url}`);
  };
  const yt=createYouTubeIntegration({store,env:{NEXORA_GOOGLE_CLIENT_ID:'client',NEXORA_TOKEN_ENCRYPTION_KEY:key},fetchImpl});
  const read=new URL(yt.start('read'));assert.doesNotMatch(read.searchParams.get('scope'),/auth\/youtube(?:\s|$)/);
  const auth=new URL(yt.start('manage'));assert.match(auth.searchParams.get('scope'),/auth\/youtube(?:\s|$)/);await yt.callback({code:'once',state:auth.searchParams.get('state')});assert.equal(yt.status().manageAuthorized,true);
  await assert.rejects(()=>yt.createPlaylist({title:'Approved later'}),/Explicit approval/);
  await assert.rejects(()=>yt.createPlaylist({title:'Public no second approval',privacyStatus:'public',explicitApproval:true}),/separate approval/);
  const playlist=await yt.createPlaylist({title:'Private series',explicitApproval:true});assert.equal(playlist.id,'playlist123');
  await assert.rejects(()=>yt.updateVideo({videoId:'abcdefghijk',title:'New'}),/Explicit approval/);
  const updated=await yt.updateVideo({videoId:'abcdefghijk',title:'New title',explicitApproval:true});assert.equal(updated.id,'abcdefghijk');
  const write=calls.find(x=>x.method==='PUT');const body=JSON.parse(write.body);assert.equal(body.snippet.categoryId,'27');assert.equal(body.snippet.description,'Keep intact');assert.deepEqual(body.snippet.tags,['old']);
});

test('YouTube research fetches official public competitor samples and enforces a five-search daily cap',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'nexora-youtube-research-'));
  const store=createStore(dir);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true})});
  const scopes='https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly';
  let searchCalls=0;const urls=[];
  const fetchImpl=async(url)=>{
    urls.push(String(url));
    if(url==='https://oauth2.googleapis.com/token')return new Response(JSON.stringify({access_token:'research-access',refresh_token:'research-refresh',expires_in:3600,scope:scopes}),{status:200});
    if(String(url).includes('/search?')){searchCalls++;return new Response(JSON.stringify({pageInfo:{totalResults:50000},items:[{id:{videoId:'videoaaaaaa1'}},{id:{videoId:'videobbbbbb2'}}]}),{status:200});}
    if(String(url).includes('/videos?'))return new Response(JSON.stringify({items:[{id:'videoaaaaaa1',snippet:{title:'Recent example',channelTitle:'Channel A',channelId:'chan-a',publishedAt:new Date(Date.now()-86_400_000).toISOString()},statistics:{viewCount:'100'},contentDetails:{duration:'PT5M'}},{id:'videobbbbbb2',snippet:{title:'Another example',channelTitle:'Channel B',channelId:'chan-b',publishedAt:new Date(Date.now()-2*86_400_000).toISOString()},statistics:{viewCount:'400'},contentDetails:{duration:'PT8M'}}]}),{status:200});
    throw new Error(`Unexpected request ${url}`);
  };
  const yt=createYouTubeIntegration({store,env:{NEXORA_GOOGLE_CLIENT_ID:'client',NEXORA_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,4).toString('base64')},fetchImpl});
  const consent=new URL(yt.start('read'));await yt.callback({code:'research-code',state:consent.searchParams.get('state')});
  const after=new Date(Date.now()-30*86_400_000).toISOString();
  const result=await yt.researchVideos({query:'renewable energy',regionCode:'US',publishedAfter:after,maxResults:15});
  assert.equal(result.sampleSize,2);assert.equal(result.approximateSearchResultCount,50000);assert.equal(result.medianViews,250);assert.equal(result.medianViewsPerDay,150);assert.equal(result.quotaPolicy.applicationSearchesUsedToday,1);assert.match(urls.find(x=>x.includes('/search?')),/type=video/);assert.match(urls.find(x=>x.includes('/search?')),/publishedAfter=/);
  const cached=await yt.researchVideos({query:'RENEWABLE ENERGY',regionCode:'us',publishedAfter:after,maxResults:15});assert.equal(cached.cached,true);assert.equal(searchCalls,1);
  for(let i=0;i<4;i++)await yt.researchVideos({query:`renewable ${i}`});
  await assert.rejects(()=>yt.researchVideos({query:'sixth request'}),/Daily YouTube research limit/);assert.equal(searchCalls,5);
  await assert.rejects(()=>yt.researchVideos({query:'x'}),/2–100 characters/);
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
