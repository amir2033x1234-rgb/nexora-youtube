import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const READ_SCOPES = ['https://www.googleapis.com/auth/youtube.readonly','https://www.googleapis.com/auth/yt-analytics.readonly'];
const UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
const MANAGE_SCOPE = 'https://www.googleapis.com/auth/youtube';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const API = 'https://www.googleapis.com/youtube/v3';
const ANALYTICS = 'https://youtubeanalytics.googleapis.com/v2/reports';
const b64url = buffer => buffer.toString('base64url');

export function createYouTubeIntegration({ store, env = process.env, port = 3000, dataDir = './data', fetchImpl = fetch }) {
  const pending = new Map();
  const redirectUri = env.NEXORA_GOOGLE_REDIRECT_URI || `http://127.0.0.1:${port}/api/youtube/oauth/callback`;
  const configured = Boolean(env.NEXORA_GOOGLE_CLIENT_ID && env.NEXORA_TOKEN_ENCRYPTION_KEY);
  const key = (() => { try { const value=Buffer.from(env.NEXORA_TOKEN_ENCRYPTION_KEY||'','base64'); return value.length===32?value:null; } catch { return null; } })();
  function encrypt(value) {
    if(!key) throw new Error('Set NEXORA_TOKEN_ENCRYPTION_KEY to a base64-encoded 32-byte key before connecting YouTube.');
    const iv=randomBytes(12); const cipher=createCipheriv('aes-256-gcm',key,iv); const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    return {v:1,iv:b64url(iv),tag:b64url(cipher.getAuthTag()),data:b64url(encrypted)};
  }
  function decrypt(box) {
    if(!key||!box||box.v!==1) return null;
    try { const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(box.iv,'base64url')); decipher.setAuthTag(Buffer.from(box.tag,'base64url')); return JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data,'base64url')),decipher.final()]).toString('utf8')); }
    catch { return null; }
  }
  function readTokens() { return decrypt(store.get('secrets','youtube_tokens')?.box); }
  function saveTokens(tokens) { store.put('secrets',{id:'youtube_tokens',box:encrypt(tokens),updatedAt:new Date().toISOString()}); }
  function status() {
    const tokens=readTokens();
    return { configured, connected:Boolean(tokens?.refresh_token), uploadAuthorized:Boolean(tokens?.refresh_token&&tokens.scope.split(' ').includes(UPLOAD_SCOPE)), manageAuthorized:Boolean(tokens?.refresh_token&&tokens.scope.split(' ').includes(MANAGE_SCOPE)),clientIdConfigured:Boolean(env.NEXORA_GOOGLE_CLIENT_ID),encryptionKeyConfigured:Boolean(key),redirectUri,scope:tokens?.scope||null,mode:tokens?.mode||null,note:configured?'OAuth uses one-time state, PKCE and encrypted token storage.':'Add client ID and a 32-byte encryption key through protected environment settings.' };
  }
  function start(mode='read') {
    if(!configured||!key) throw new Error('YouTube OAuth is not configured. Add NEXORA_GOOGLE_CLIENT_ID and NEXORA_TOKEN_ENCRYPTION_KEY in the protected environment.');
    if(!['read','manage','publish'].includes(mode)) throw new Error('mode must be read, manage, or publish');
    const state=b64url(randomBytes(32)); const verifier=b64url(randomBytes(48)); const challenge=b64url(createHash('sha256').update(verifier).digest());
    pending.set(state,{verifier,mode,createdAt:Date.now()});
    for(const [k,v] of pending) if(Date.now()-v.createdAt>10*60*1000) pending.delete(k);
    const query=new URLSearchParams({client_id:env.NEXORA_GOOGLE_CLIENT_ID,redirect_uri:redirectUri,response_type:'code',scope:[...READ_SCOPES,...(mode==='manage'?[MANAGE_SCOPE]:[]),...(mode==='publish'?[UPLOAD_SCOPE]:[])].join(' '),access_type:'offline',prompt:'consent',state,code_challenge:challenge,code_challenge_method:'S256'});
    return `${AUTH_URL}?${query}`;
  }
  async function callback({code,state,error}) {
    const item=pending.get(state); pending.delete(state);
    if(error) throw new Error('Google authorization was denied or cancelled.');
    if(!item||Date.now()-item.createdAt>10*60*1000) throw new Error('OAuth state is missing, expired, or already used. Start the connection again.');
    const params=new URLSearchParams({client_id:env.NEXORA_GOOGLE_CLIENT_ID,code,code_verifier:item.verifier,redirect_uri:redirectUri,grant_type:'authorization_code'});
    if(env.NEXORA_GOOGLE_CLIENT_SECRET) params.set('client_secret',env.NEXORA_GOOGLE_CLIENT_SECRET);
    const response=await fetchImpl(TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:params});
    const data=await response.json(); if(!response.ok) throw new Error(`Google token exchange failed (${response.status}); check OAuth client and redirect settings.`);
    const old=readTokens(); if(!data.refresh_token&&old?.refresh_token) data.refresh_token=old.refresh_token;
    if(!data.refresh_token) throw new Error('Google returned no refresh token. Revoke the previous grant in your Google account and connect again.');
    saveTokens({access_token:data.access_token,refresh_token:data.refresh_token,expires_at:Date.now()+Number(data.expires_in||3600)*1000,scope:data.scope||'',mode:item.mode,token_type:data.token_type||'Bearer'});
    return {connected:true,mode:item.mode,scope:data.scope||'',expiresIn:Number(data.expires_in||3600)};
  }
  async function accessToken(requiredScope) {
    let tokens=readTokens(); if(!tokens?.refresh_token) throw new Error('YouTube is not connected.');
    if(requiredScope && !tokens.scope.split(' ').includes(requiredScope)) throw new Error(`Reconnect with ${requiredScope} access to use this operation.`);
    if(tokens.expires_at>Date.now()+60_000) return tokens.access_token;
    const params=new URLSearchParams({client_id:env.NEXORA_GOOGLE_CLIENT_ID,refresh_token:tokens.refresh_token,grant_type:'refresh_token'});
    if(env.NEXORA_GOOGLE_CLIENT_SECRET) params.set('client_secret',env.NEXORA_GOOGLE_CLIENT_SECRET);
    const response=await fetchImpl(TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:params}); const data=await response.json();
    if(!response.ok) { if(response.status===400||response.status===401) store.delete('secrets','youtube_tokens'); throw new Error(`Google token refresh failed (${response.status}). Reconnect the channel.`); }
    tokens={...tokens,access_token:data.access_token,expires_at:Date.now()+Number(data.expires_in||3600)*1000}; saveTokens(tokens); return tokens.access_token;
  }
  async function api(url, scope='https://www.googleapis.com/auth/youtube.readonly', options={}) {
    const token=await accessToken(scope); const response=await fetchImpl(url,{...options,headers:{authorization:`Bearer ${token}`,...options.headers}}); const data=await response.json();
    if(!response.ok) throw new Error(`YouTube API request failed (${response.status}): ${data.error?.message||'provider rejected the request'}`); return data;
  }
  async function channel() { const data=await api(`${API}/channels?part=snippet,statistics,contentDetails&mine=true`); return data.items||[]; }
  async function videos(maxResults=25,pageToken='') {
    const channels=await channel(); const uploads=channels[0]?.contentDetails?.relatedPlaylists?.uploads; if(!uploads) return {items:[],nextPageToken:null,channel:null};
    const q=new URLSearchParams({part:'snippet,contentDetails,status',playlistId:uploads,maxResults:String(Math.max(1,Math.min(50,Number(maxResults)||25)))}); if(pageToken) q.set('pageToken',pageToken);
    const data=await api(`${API}/playlistItems?${q}`); return {items:(data.items||[]).map(x=>({id:x.contentDetails?.videoId,title:x.snippet?.title,publishedAt:x.contentDetails?.videoPublishedAt||x.snippet?.publishedAt,thumbnail:x.snippet?.thumbnails?.medium?.url})),nextPageToken:data.nextPageToken||null,channel:channels[0]};
  }
  async function researchVideos({query,regionCode='US',publishedAfter,maxResults=15,order='relevance'}={}) {
    const q=String(query||'').trim();
    if(q.length<2||q.length>100)throw new Error('Research query must be 2–100 characters.');
    const region=String(regionCode||'US').toUpperCase();
    if(!/^[A-Z]{2}$/.test(region))throw new Error('regionCode must be a two-letter country or region code.');
    if(!['relevance','date','viewCount'].includes(order))throw new Error('order must be relevance, date, or viewCount.');
    if(publishedAfter&&(!Number.isFinite(Date.parse(publishedAfter))||Date.parse(publishedAfter)>Date.now()))throw new Error('publishedAfter must be a valid past date.');
    const normalizedAfter=publishedAfter?new Date(publishedAfter).toISOString():'';
    const cacheId=createHash('sha256').update(`${q.toLocaleLowerCase()}|${region}|${normalizedAfter}|${order}|${Math.max(5,Math.min(25,Number(maxResults)||15))}`).digest('hex').slice(0,24);
    const cached=store.get('youtube_research_cache',cacheId);
    if(cached&&Date.now()-Date.parse(cached.fetchedAt)<10*60*1000)return {...cached,cached:true};
    const dayStart=new Date();dayStart.setUTCHours(0,0,0,0);
    const limit=5;
    if(store.countSince('youtube_search_requests',dayStart.toISOString())>=limit)throw new Error(`Daily YouTube research limit reached (${limit} searches). Try again after UTC midnight.`);
    const params=new URLSearchParams({part:'snippet',type:'video',q,regionCode:region,maxResults:String(Math.max(5,Math.min(25,Number(maxResults)||15))),order});
    if(normalizedAfter)params.set('publishedAfter',normalizedAfter);
    const search=await api(`${API}/search?${params}`,READ_SCOPES[0]);
    store.put('youtube_search_requests',{id:randomBytes(12).toString('hex'),createdAt:new Date().toISOString(),query:q,regionCode:region});
    const ids=(search.items||[]).map(item=>item.id?.videoId).filter(Boolean).slice(0,25);
    const details=ids.length?await api(`${API}/videos?${new URLSearchParams({part:'snippet,statistics,contentDetails',id:ids.join(',')})}`,READ_SCOPES[0]):{items:[]};
    const now=Date.now();
    const items=(details.items||[]).map(video=>{
      const views=Number(video.statistics?.viewCount);const published=Date.parse(video.snippet?.publishedAt||'');
      const ageDays=Number.isFinite(published)?Math.max(1/24,(now-published)/86_400_000):null;
      return {id:video.id,title:video.snippet?.title||'',channelTitle:video.snippet?.channelTitle||'',channelId:video.snippet?.channelId||null,publishedAt:video.snippet?.publishedAt||null,views:Number.isFinite(views)?views:null,likes:video.statistics?.likeCount==null?null:Number(video.statistics.likeCount),viewsPerDay:Number.isFinite(views)&&ageDays?Math.round(views/ageDays):null,duration:video.contentDetails?.duration||null,url:`https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`};
    });
    const viewRates=items.map(item=>item.viewsPerDay).filter(Number.isFinite).sort((a,b)=>a-b);
    const viewCounts=items.map(item=>item.views).filter(Number.isFinite).sort((a,b)=>a-b);
    const median=values=>values.length?(values.length%2?values[Math.floor(values.length/2)]:Math.round((values[values.length/2-1]+values[values.length/2])/2)):null;
    const result={query:q,regionCode:region,order,source:'YouTube Data API search.list + videos.list',fetchedAt:new Date().toISOString(),cached:false,quotaPolicy:{applicationSearchesUsedToday:store.countSince('youtube_search_requests',dayStart.toISOString()),applicationDailyLimit:limit},sampleSize:items.length,approximateSearchResultCount:search.pageInfo?.totalResults??null,medianViews:median(viewCounts),medianViewsPerDay:median(viewRates),items,note:'A recent public-video sample for competitive context only. Search rank and sample metrics are not total market size, audience demand, or a prediction.'};
    store.put('youtube_research_cache',{...result,id:cacheId,createdAt:result.fetchedAt});
    store.record('youtube_market_research',{query:q,regionCode:region,sampleSize:items.length,fetchedAt:result.fetchedAt});
    return result;
  }
  async function playlists(pageToken='') {
    const q=new URLSearchParams({part:'snippet,status',mine:'true',maxResults:'50'});if(pageToken)q.set('pageToken',pageToken);
    const data=await api(`${API}/playlists?${q}`);return {items:data.items||[],nextPageToken:data.nextPageToken||null};
  }
  async function createPlaylist({title,description='',privacyStatus='private',explicitApproval=false,publicVisibilityApproval=false}) {
    if(explicitApproval!==true)throw new Error('Explicit approval is required before creating a playlist.');
    if(!String(title||'').trim()||String(title).length>150)throw new Error('Playlist title is required and must be 150 characters or fewer.');
    if(!['private','unlisted','public'].includes(privacyStatus))throw new Error('privacyStatus must be private, unlisted, or public.');
    if(privacyStatus==='public'&&publicVisibilityApproval!==true)throw new Error('Public playlist visibility requires separate approval.');
    return api(`${API}/playlists?part=snippet,status`,MANAGE_SCOPE,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({snippet:{title:String(title).trim(),description:String(description).slice(0,5000)},status:{privacyStatus}})});
  }
  async function updateVideo({videoId,title,description,tags,explicitApproval=false}) {
    if(explicitApproval!==true)throw new Error('Explicit approval is required before changing YouTube metadata.');
    if(!/^[A-Za-z0-9_-]{6,20}$/.test(String(videoId||'')))throw new Error('A valid YouTube video ID is required.');
    const current=await api(`${API}/videos?part=snippet&id=${encodeURIComponent(videoId)}`);const existing=current.items?.[0];if(!existing)throw new Error('Video was not found on the authorized channel.');
    const nextTitle=String(title??existing.snippet?.title??'').trim();const nextDescription=String(description??existing.snippet?.description??'');const nextTags=Array.isArray(tags)?tags.map(x=>String(x).slice(0,100)).slice(0,30):existing.snippet?.tags;
    if(!nextTitle||nextTitle.length>100||/[<>]/.test(nextTitle))throw new Error('Video title must be 1–100 characters and cannot contain < or >.');
    if(Buffer.byteLength(nextDescription,'utf8')>5000||/[<>]/.test(nextDescription))throw new Error('Video description must be at most 5000 UTF-8 bytes and cannot contain < or >.');
    const snippet={title:nextTitle,description:nextDescription,categoryId:existing.snippet?.categoryId};if(nextTags)snippet.tags=nextTags;
    return api(`${API}/videos?part=snippet`,MANAGE_SCOPE,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({id:videoId,snippet})});
  }
  async function analytics({startDate,endDate}) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate||'')||!/^\d{4}-\d{2}-\d{2}$/.test(endDate||'')) throw new Error('startDate and endDate must use YYYY-MM-DD.');
    const q=new URLSearchParams({ids:'channel==MINE',startDate,endDate,metrics:'views,estimatedMinutesWatched,averageViewDuration,subscribersGained',dimensions:'day',sort:'day'});
    return api(`${ANALYTICS}?${q}`,'https://www.googleapis.com/auth/yt-analytics.readonly');
  }
  async function popular({regionCode='US',videoCategoryId}) {
    const q=new URLSearchParams({part:'snippet,statistics,contentDetails',chart:'mostPopular',regionCode:String(regionCode).slice(0,2).toUpperCase(),maxResults:'25'}); if(videoCategoryId)q.set('videoCategoryId',String(videoCategoryId));
    const data=await api(`${API}/videos?${q}`); return {items:(data.items||[]).map(v=>({id:v.id,title:v.snippet?.title,channelTitle:v.snippet?.channelTitle,publishedAt:v.snippet?.publishedAt,views:Number(v.statistics?.viewCount||0),likes:Number(v.statistics?.likeCount||0),url:`https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}`})),source:'YouTube Data API mostPopular chart',fetchedAt:new Date().toISOString(),note:'Popularity snapshot, not a trend trajectory or performance forecast.'};
  }
  async function upload({filePath,title,description='',tags=[],privacyStatus='private',explicitApproval=false,publicVisibilityApproval=false,assets,quality}) {
    if(explicitApproval!==true) throw new Error('Explicit approval is required before uploading to YouTube.');
    const readyAssets=Array.isArray(assets)&&assets.some(a=>a?.url===path.basename(String(filePath||''))&&a?.license&&a?.proof&&a?.commercialUse===true);
    if(!readyAssets) throw new Error('The exact upload file must have a documented license, proof, and confirmed commercial-use permission.');
    const {scoreQuality,validateAssetRights}=await import('./domain.mjs'); const rights=validateAssetRights(assets); if(!rights.ready)throw new Error(`Media-rights gate failed: ${rights.issues.join(' ')}`);
    const score=scoreQuality(quality||{}); if(!score.ready)throw new Error(`Quality gate failed: ${score.reasons.join(' ')}`);
    if(!['private','unlisted','public'].includes(privacyStatus))throw new Error('privacyStatus must be private, unlisted, or public.');
    if(privacyStatus==='public'&&publicVisibilityApproval!==true)throw new Error('Public visibility requires separate explicit approval.');
    const exportRoot=path.resolve(dataDir,'exports'); await mkdir(exportRoot,{recursive:true}); const realRoot=await realpath(exportRoot); const realFile=await realpath(path.resolve(filePath));
    if(!realFile.startsWith(realRoot+path.sep))throw new Error('Upload file must be inside the protected data/exports directory.');
    const info=await stat(realFile); const maxBytes=Math.max(1,Number(env.NEXORA_MAX_UPLOAD_BYTES)||2*1024*1024*1024); if(!info.isFile()||info.size<1||info.size>maxBytes)throw new Error(`Upload must be a non-empty file smaller than ${maxBytes} bytes.`);
    const extension=path.extname(realFile).toLowerCase(); const types={'.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.avi':'video/x-msvideo','.m4v':'video/x-m4v'}; const contentType=types[extension]; if(!contentType)throw new Error('Supported upload formats: MP4, MOV, WebM, AVI, and M4V.');
    if(!String(title||'').trim())throw new Error('Video title is required.');
    const token=await accessToken(UPLOAD_SCOPE); const metadata={snippet:{title:String(title).trim().slice(0,100),description:String(description).slice(0,5000),tags:Array.isArray(tags)?tags.map(x=>String(x).slice(0,100)).slice(0,30):[]},status:{privacyStatus}};
    const start=await fetchImpl(`https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json; charset=UTF-8','x-upload-content-length':String(info.size),'x-upload-content-type':contentType},body:JSON.stringify(metadata)});
    const session=start.headers.get('location'); if(!start.ok||!session)throw new Error(`YouTube did not create an upload session (${start.status}).`);
    const uploaded=await fetchImpl(session,{method:'PUT',headers:{'content-type':contentType,'content-length':String(info.size)},body:createReadStream(realFile),duplex:'half',signal:AbortSignal.timeout(Math.max(120_000,Number(env.NEXORA_UPLOAD_TIMEOUT_MS)||3_600_000))});
    let result={}; try{result=await uploaded.json()}catch{}
    if(!uploaded.ok)throw new Error(`YouTube upload failed (${uploaded.status}); check upload processing status before retrying to avoid duplicate uploads.`);
    return {videoId:result.id,url:result.id?`https://www.youtube.com/watch?v=${encodeURIComponent(result.id)}`:null,privacyStatus,uploaded:true,approvalRecorded:true,qualityScore:score.score,createdAt:new Date().toISOString()};
  }
  async function disconnect() { store.delete('secrets','youtube_tokens'); return {connected:false}; }
  return { status, start, callback, channel, videos, researchVideos, playlists, createPlaylist, updateVideo, analytics, popular, upload, disconnect, accessToken, api, scopes:{read:READ_SCOPES,manage:MANAGE_SCOPE,upload:UPLOAD_SCOPE} };
}
