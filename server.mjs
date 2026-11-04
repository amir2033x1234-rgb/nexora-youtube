import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { capabilities, scoreIdea, createScript, assessClaims, makeSubtitles, scoreQuality, suggestMetadata, makeThumbnailSvg, newJob } from './src/domain.mjs';
import { createStore } from './src/store.mjs';
import { createYouTubeIntegration } from './src/youtube.mjs';
import { createOllamaProvider } from './src/ollama.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
if (!['127.0.0.1','::1','localhost'].includes(host) && process.env.NEXORA_TRUSTED_PROXY !== 'true') {
  throw new Error('Refusing a non-local bind without NEXORA_TRUSTED_PROXY=true; put the app behind a TLS proxy that enforces authentication.');
}
const dataDir = path.resolve(process.env.NEXORA_DATA_DIR || path.join(root, 'data'));
const dailyLimit = Math.max(1, Number(process.env.NEXORA_DAILY_JOB_LIMIT || 20));
const store = createStore(dataDir);
const youtube = createYouTubeIntegration({store,env:process.env,port,dataDir});
const ollama = createOllamaProvider({env:process.env});
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml; charset=utf-8', '.json':'application/json; charset=utf-8' };
const send = (res, status, body, type='application/json; charset=utf-8') => { res.writeHead(status, { 'content-type': type, 'x-content-type-options':'nosniff', 'cache-control':'no-store', 'content-security-policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" }); res.end(type.startsWith('application/json') ? JSON.stringify(body) : body); };
async function body(req) { let raw=''; for await (const chunk of req) { raw+=chunk; if(raw.length>1_000_000) throw new Error('request body exceeds 1 MB'); } return raw ? JSON.parse(raw) : {}; }
const dateStart = () => new Date(new Date().setUTCHours(0,0,0,0)).toISOString();
function status() {
  const jobs=store.list('jobs',500); const channels=store.list('channels',500);
  const yt=youtube.status();
  const ai=ollama.status();
  return { app:'NEXORA YOUTUBE AI', version:'0.3.0', persistence:'SQLite', channels:channels.length, ideas:store.list('trends',500).length, scripts:store.list('scripts',500).length, jobs:{queued:jobs.filter(j=>j.status==='queued').length,failed:jobs.filter(j=>j.status==='failed').length,completed:jobs.filter(j=>j.status==='completed').length}, dailyJobs:store.countSince('jobs',dateStart()), dailyJobLimit:dailyLimit, capabilities:capabilities.map(c=>c.id==='youtube-oauth'&&yt.connected?{...c,status:'IMPLEMENTED',detail:'OAuth connected; provider calls are available for this account.'}:c.id==='youtube-oauth'&&yt.configured?{...c,status:'UNTESTED',detail:'OAuth configured but not yet connected to a channel.'}:c.id==='youtube-publishing'&&yt.uploadAuthorized?{...c,status:'UNTESTED',detail:'Upload adapter requires explicit approval, private-by-default visibility, verified rights, and a live provider check.'}:c.id==='script-generator'&&ai.configured?{...c,status:'UNTESTED',detail:'Local Ollama model is configured; inference must be exercised.'}:c),integrations:{youtube:{status:yt.connected?'CONNECTED':yt.configured?'UNTESTED':'PROVIDER_REQUIRED',configured:yt.configured,connected:yt.connected,uploadAuthorized:yt.uploadAuthorized},ai:{status:ai.status,provider:ai.provider,model:ai.model,configured:ai.configured},media:{status:'PROVIDER_REQUIRED',configured:false}},publishing:{enabled:yt.uploadAuthorized,requiresExplicitApproval:true,defaultVisibility:'private',reason:yt.uploadAuthorized?'Upload adapter enabled only for the explicitly approved file after its rights and quality gates pass.':'Connect with upload permission to enable the guarded upload endpoint.'} };
}
async function handle(req,res) {
  const url=new URL(req.url,'http://localhost'); const route=url.pathname; const method=req.method;
  try {
    if(method==='GET' && route==='/api/health') return send(res,200,{ok:true});
    if(method==='GET' && route==='/api/status') return send(res,200,status());
    if(method==='GET' && route==='/api/ai/status') return send(res,200,ollama.status());
    if(method==='POST' && route==='/api/scripts/ai') { const item=await ollama.generateScript(await body(req)); store.put('scripts',item); return send(res,201,item); }
    if(method==='GET' && route==='/api/youtube/status') return send(res,200,youtube.status());
    if(method==='GET' && route==='/api/youtube/oauth/start') { const location=youtube.start(url.searchParams.get('mode')||'read'); res.writeHead(302,{location,'cache-control':'no-store','referrer-policy':'no-referrer'}); return res.end(); }
    if(method==='GET' && route==='/api/youtube/oauth/callback') { const result=await youtube.callback({code:url.searchParams.get('code'),state:url.searchParams.get('state'),error:url.searchParams.get('error')}); return send(res,200,{message:'YouTube account connected. You may close this page.',...result}); }
    if(method==='POST' && route==='/api/youtube/disconnect') return send(res,200,await youtube.disconnect());
    if(method==='GET' && route==='/api/youtube/channel') return send(res,200,{items:await youtube.channel()});
    if(method==='GET' && route==='/api/youtube/videos') return send(res,200,await youtube.videos(url.searchParams.get('maxResults'),url.searchParams.get('pageToken')||''));
    if(method==='GET' && route==='/api/youtube/analytics') return send(res,200,await youtube.analytics({startDate:url.searchParams.get('startDate'),endDate:url.searchParams.get('endDate')}));
    if(method==='GET' && route==='/api/youtube/popular') return send(res,200,await youtube.popular({regionCode:url.searchParams.get('regionCode')||'US',videoCategoryId:url.searchParams.get('videoCategoryId')}));
    if(method==='POST' && route==='/api/youtube/publish') { const x=await body(req); store.record('youtube_upload_requested',{title:String(x.title||'').slice(0,100),privacyStatus:x.privacyStatus||'private',explicitApproval:x.explicitApproval===true,publicVisibilityApproval:x.publicVisibilityApproval===true,requestedAt:new Date().toISOString()}); const result=await youtube.upload(x); store.record('youtube_upload_completed',{videoId:result.videoId,privacyStatus:result.privacyStatus,completedAt:result.createdAt}); return send(res,201,result); }
    if(method==='GET' && route==='/api/dashboard') return send(res,200,{...status(), recentJobs:store.list('jobs',8), recentTrends:store.list('trends',8), calendar:store.list('calendar',12)});
    if(method==='GET' && route==='/api/channels') return send(res,200,store.list('channels'));
    if(method==='POST' && route==='/api/channels') { const x=await body(req); if(!x.name?.trim()) return send(res,400,{error:'name is required'}); const item={id:randomUUID(),name:x.name.trim().slice(0,120),language:String(x.language||'en').slice(0,12),audience:String(x.audience||'').slice(0,300),category:String(x.category||'').slice(0,100),cadencePerWeek:Math.max(1,Math.min(14,Number(x.cadencePerWeek)||2)),brand:x.brand||{},createdAt:new Date().toISOString()}; store.put('channels',item); return send(res,201,item); }
    if(method==='GET' && route==='/api/trends') return send(res,200,store.list('trends'));
    if(method==='POST' && route==='/api/trends/score') { const x=await body(req); const result=scoreIdea(x); const item={id:randomUUID(),title:String(x.title||x.topic||'').slice(0,180),topic:String(x.topic||x.title||'').slice(0,180),channelId:x.channelId||'default',sources:x.sources||[],scores:result,createdAt:new Date().toISOString()}; store.put('trends',item,item.channelId); return send(res,201,item); }
    if(method==='POST' && route==='/api/fact-check') return send(res,200,{results:assessClaims((await body(req)).claims),verifiedBy:'submitted evidence only'});
    if(method==='POST' && route==='/api/scripts') { const item=createScript(await body(req)); store.put('scripts',item); return send(res,201,item); }
    if(method==='GET' && route==='/api/scripts') return send(res,200,store.list('scripts'));
    if(method==='GET' && route==='/api/calendar') return send(res,200,store.list('calendar'));
    if(method==='POST' && route==='/api/calendar') { const x=await body(req); if(!x.title||!x.scheduledFor||Number.isNaN(Date.parse(x.scheduledFor))) return send(res,400,{error:'title and valid scheduledFor are required'}); const item={id:randomUUID(),title:String(x.title).slice(0,180),channelId:x.channelId||'default',scheduledFor:new Date(x.scheduledFor).toISOString(),status:'planned',createdAt:new Date().toISOString()}; store.put('calendar',item,item.channelId); return send(res,201,item); }
    if(method==='POST' && route==='/api/subtitles') return send(res,200,makeSubtitles(await body(req)));
    if(method==='POST' && route==='/api/metadata') return send(res,200,suggestMetadata(await body(req)));
    if(method==='POST' && route==='/api/thumbnails') return send(res,200,{format:'svg',width:1280,height:720,svg:makeThumbnailSvg(await body(req)),note:'Editable title-card template only. Replace with licensed imagery and review legibility.'});
    if(method==='POST' && route==='/api/quality-score') return send(res,200,scoreQuality(await body(req)));
    if(method==='POST' && route==='/api/jobs') { const x=await body(req); if(store.countSince('jobs',dateStart())>=dailyLimit) return send(res,429,{error:'daily_resource_quota_reached',dailyLimit}); const created=newJob(x); if(!created.accepted) return send(res,422,created); const job=store.put('jobs',created.job,created.job.channelId); store.record('job_queued',{jobId:job.id,channelId:job.channelId}); return send(res,202,job); }
    const retry=route.match(/^\/api\/jobs\/([^/]+)\/retry$/);
    if(method==='POST' && retry) { const job=store.get('jobs',decodeURIComponent(retry[1])); if(!job) return send(res,404,{error:'job_not_found'}); if(job.status==='completed'||job.retryCount>=3) return send(res,409,{error:'retry_not_allowed',retryCount:job.retryCount}); const updated={...job,status:'queued',retryCount:job.retryCount+1,updatedAt:new Date().toISOString()}; store.put('jobs',updated,updated.channelId); store.record('job_retry',{jobId:job.id,retryCount:updated.retryCount}); return send(res,202,updated); }
    if(method==='POST' && route==='/api/publish/prepare') { const x=await body(req); store.record('publish_prepare_requested',{channelId:x.channelId||'default',approvalProvided:x.explicitApproval===true}); return send(res,409,{status:'USE_GUARDED_UPLOAD',published:false,approvalReceived:x.explicitApproval===true,reason:'No upload was performed. Use /api/youtube/publish, which enforces upload scope, exact-file rights, quality, and explicit approval.'}); }
    if(method==='POST' && route==='/api/analytics') { const x=await body(req); const item={id:randomUUID(),channelId:x.channelId||'default',videoId:String(x.videoId||'').slice(0,100),views:Math.max(0,Number(x.views)||0),watchMinutes:Math.max(0,Number(x.watchMinutes)||0),ctr:x.ctr==null?null:Math.max(0,Number(x.ctr)||0),source:'user_entered',recordedAt:new Date().toISOString()}; store.put('analytics',item,item.channelId); return send(res,201,item); }
    if(method==='GET' && route==='/api/analytics') return send(res,200,store.list('analytics'));
    if(method==='GET' && route==='/') { const file=path.join(root,'public','index.html'); return send(res,200,await import('node:fs/promises').then(fs=>fs.readFile(file,'utf8')),'text/html; charset=utf-8'); }
    if(method==='GET' && route.startsWith('/')) { const target=path.resolve(root,'public',`.${decodeURIComponent(route)}`); const pub=path.resolve(root,'public')+path.sep; if(!target.startsWith(pub)||!existsSync(target)) return send(res,404,{error:'not_found'}); return send(res,200,await import('node:fs/promises').then(fs=>fs.readFile(target)) ,mime[path.extname(target)]||'application/octet-stream'); }
    return send(res,404,{error:'not_found'});
  } catch(error) { return send(res,error instanceof SyntaxError?400:422,{error:'invalid_request',message:String(error.message||error)}); }
}

const server=createServer((req,res)=>{ if(req.method==='OPTIONS') return send(res,405,{error:'method_not_allowed'}); void handle(req,res); });
server.listen(port,host,()=>console.log(`NEXORA listening on http://${host}:${port}; SQLite: ${dataDir}`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{store.close();process.exit(0);}));
