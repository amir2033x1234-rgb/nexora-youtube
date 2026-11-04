import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from '../src/auth.mjs';

test('login creates an HttpOnly session, CSRF is enforced, and logout revokes it',()=>{
  const auth=createAuth({username:'owner',password:'a-long-test-password',secureCookie:true});
  const failed=auth.login('owner','incorrect','127.0.0.1');assert.equal(failed.status,401);
  const logged=auth.login('owner','a-long-test-password','127.0.0.1');assert.equal(logged.ok,true);assert.match(auth.cookie(logged.token),/HttpOnly/);assert.match(auth.cookie(logged.token),/Secure/);
  const req={method:'POST',url:'/api/channels',headers:{cookie:`nexora_session=${logged.token}`}};
  assert.equal(auth.authorize(req).status,403);req.headers['x-csrf-token']=logged.csrfToken;assert.equal(auth.authorize(req).ok,true);
  assert.equal(auth.sessionInfo({headers:{cookie:`nexora_session=${logged.token}`}}).authenticated,true);
  auth.logout({headers:{cookie:`nexora_session=${logged.token}`}});assert.equal(auth.sessionInfo({headers:{cookie:`nexora_session=${logged.token}`}}).authenticated,false);
});

test('login attempts are throttled and short admin secrets are rejected',()=>{
  assert.throws(()=>createAuth({password:'tiny'}),/at least 12/);
  let now=10;const auth=createAuth({username:'owner',password:'a-long-test-password',now:()=>now,maxAttempts:2,windowMs:1000});
  assert.equal(auth.login('owner','bad','client').status,401);assert.equal(auth.login('owner','bad','client').status,401);assert.equal(auth.login('owner','a-long-test-password','client').status,429);
  now+=1001;assert.equal(auth.login('owner','a-long-test-password','client').ok,true);
});
