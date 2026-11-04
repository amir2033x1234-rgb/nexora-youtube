import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SESSION_MS=8*60*60*1000;
const COOKIE='nexora_session';

export function createAuth({username='admin',password='',secureCookie=false,now=()=>Date.now(),maxAttempts=5,windowMs=15*60*1000}={}) {
  const enabled=Boolean(password);
  if(enabled&&String(password).length<12)throw new Error('NEXORA_ADMIN_PASSWORD must contain at least 12 characters.');
  const salt=randomBytes(16);
  const passwordHash=enabled?scryptSync(password,salt,64):null;
  const sessions=new Map();
  const attempts=new Map();
  const sessionKey=randomBytes(32);
  const secure=secureCookie?'; Secure':'';
  function parseCookie(header='') { const pair=header.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${COOKIE}=`)); return pair?.slice(COOKIE.length+1)||null; }
  function digest(token) { return createHmac('sha256',sessionKey).update(token).digest('base64url'); }
  function sessionFor(req) {
    if(!enabled)return {id:null,csrf:null,expiresAt:Infinity};
    const token=parseCookie(req.headers.cookie||''); if(!token)return null;
    const id=digest(token); const session=sessions.get(id);
    if(!session)return null;
    if(session.expiresAt<=now()){sessions.delete(id);return null;}
    return {...session,id};
  }
  function publicRoute(method,url) {
    if(!url.startsWith('/api/'))return true;
    return (method==='GET'&&['/api/health','/api/auth/session','/api/youtube/oauth/callback'].includes(url.split('?')[0]))||
      (method==='POST'&&url.split('?')[0]==='/api/auth/login');
  }
  function authorize(req) {
    if(!enabled||publicRoute(req.method,req.url))return {ok:true,session:null};
    const session=sessionFor(req); if(!session)return {ok:false,status:401,error:'authentication_required'};
    if(!['GET','HEAD','OPTIONS'].includes(req.method)){
      const provided=req.headers['x-csrf-token']||'';
      if(!provided||provided.length!==session.csrf.length||!timingSafeEqual(Buffer.from(provided),Buffer.from(session.csrf)))return {ok:false,status:403,error:'csrf_validation_failed'};
    }
    return {ok:true,session};
  }
  function login(usernameAttempt,passwordAttempt,ip='unknown') {
    const at=now(); const recent=(attempts.get(ip)||[]).filter(t=>at-t<windowMs);
    if(attempts.size>10000&&!attempts.has(ip))for(const [key,times] of attempts)if(!times.some(t=>at-t<windowMs))attempts.delete(key);
    if(recent.length>=maxAttempts){attempts.set(ip,recent);return {ok:false,status:429,error:'login_rate_limited'};}
    attempts.set(ip,[...recent,at]);
    const candidate=scryptSync(String(passwordAttempt||''),salt,64);
    const userOk=String(usernameAttempt||'')===username;
    const passOk=enabled&&timingSafeEqual(candidate,passwordHash);
    if(!userOk||!passOk)return {ok:false,status:401,error:'invalid_credentials'};
    attempts.delete(ip);
    const token=randomBytes(32).toString('base64url'); const session={csrf:randomBytes(32).toString('base64url'),expiresAt:at+SESSION_MS};
    sessions.set(digest(token),session); return {ok:true,token,csrfToken:session.csrf,expiresAt:session.expiresAt};
  }
  function logout(req) { const session=sessionFor(req); if(session?.id)sessions.delete(session.id); return {loggedOut:true}; }
  function sessionInfo(req) { const session=sessionFor(req); return {authRequired:enabled,authenticated:!enabled||Boolean(session),csrfToken:session?.csrf||null,expiresAt:session?.expiresAt||null}; }
  function cookie(token) { return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_MS/1000)}${secure}`; }
  function clearCookie() { return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`; }
  return {enabled,authorize,login,logout,sessionInfo,cookie,clearCookie};
}
