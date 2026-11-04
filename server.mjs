import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { capabilities, scoreIdea, createScript, assessClaims, makeSubtitles, scoreQuality, suggestMetadata, makeThumbnailSvg, newJob } from './src/domain.mjs';
import { createStore } from './src/store.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
if (!['127.0.0.1','::1','localhost'].includes(host) && process.env.NEXORA_TRUSTED_PROXY !== 'true') {
  throw new Error('Refusing a non-local bind without NEXORA_TRUSTED_PROXY=true; put the app behind a TLS proxy that enforces authentication.');
}
const dataDir = path.resolve(process.env.NEXORA_DATA_DIR || path.join(root, 'data'));
const dailyLimit = Math.max(1, Number(process.env.NEXORA_DAILY_JOB_LIMIT || 20));
const store = createStore(dataDir);
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml; charset=utf-8', '.json':'application/json; charset=utf-8' };
const send = (res, status, body, type='application/json; charset=utf-8') => { res.writeHead(status, { 'content-type': type, 'x-content-type-options':'nosniff', 'cache-control':'no-store', 'content-security-policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" }); res.end(type.startsWith('application/json') ? JSON.stringify(body) : body); };
async function body(req) { let raw=''; for await (const chunk of req) { raw+=chunk; if(raw.length>1_000_000) throw new Error('request body exceeds 1 MB'); } return raw ? JSON.parse(raw) : {}; }
const dateStart = () => new Date(new Date().setUTCHours(0,0,0,0)).toISOString();
function status() {
  const jobs=store.list('jobs',500); const channels=store.list('channels',500);
  return { app:'NEXORA YOUTUBE AI', version:'0.1.0', persistence:'SQLite', channels:channels.length, ideas:store.list('trends',500).length, scripts:store.list('scripts',500).length, jobs:{queued:jobs.filter(j=>j.status==='queued').length,failed:jobs.filter(j=>j.status==='failed').length,completed:jobs.filter(j=>j.status==='completed').length}, dailyJobs:store.countSince('jobs',dateStart()), dailyJobLimit:dailyLimit, capabilities, integrations:{youtube:{status:'PROVIDER_REQUIRED',configured:false},ai:{status:'PROVIDER_REQUIRED',configured:false},media:{status:'PROVIDER_REQUIRED',configured:false}}, publishing:{enabled:false,reason:'Publishing is not implemented; no YouTube write calls are made.'} };
}
async function handle(req,res) {
  const url=new URL(req.url,'http://localhost'); const route=url.pathname; const method=req.method;
  try {
    if(method==='GET' && route==='/api/health') return send(res,200,{ok:true});
    if(method==='GET' && route==='/api/status') return send(res,200,status());
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
    if(method==='POST' && route==='/api/publish/prepare') { const x=await body(req); store.record('publish_prepare_requested',{channelId:x.channelId||'default',approvalProvided:x.explicitApproval===true}); return send(res,409,{status:'NOT_IMPLEMENTED',published:false,approvalReceived:x.explicitApproval===true,reason:'YouTube OAuth and publishing adapter are not implemented. No content was uploaded.'}); }
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
