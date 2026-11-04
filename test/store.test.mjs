import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/store.mjs';

test('SQLite records survive reopening and keep channel-scoped records',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'nexora-store-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const first=createStore(dir);
  first.put('channels',{id:'science',name:'Science',createdAt:'2026-01-01T00:00:00.000Z'});
  first.put('channels',{id:'travel',name:'Travel',createdAt:'2026-01-01T00:00:00.000Z'});
  first.put('trends',{id:'idea-1',topic:'Ocean heat',createdAt:'2026-01-02T00:00:00.000Z'},'science');
  first.put('trends',{id:'idea-2',topic:'Train journeys',createdAt:'2026-01-03T00:00:00.000Z'},'travel');
  first.close();
  const second=createStore(dir);
  assert.equal(second.get('trends','idea-1').topic,'Ocean heat');
  assert.equal(second.list('channels').some(c=>c.id==='science'),true);
  assert.deepEqual(second.list('trends',200,'science').map(x=>x.id),['idea-1']);
  assert.deepEqual(second.list('trends',200,'travel').map(x=>x.id),['idea-2']);
  assert.equal(second.list('trends').length,2);
  assert.equal(second.countSince('trends','2026-01-01T00:00:00.000Z'),2);
  second.close();
});

test('worker claims are exclusive and expired leases recover with a bounded retry count',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'nexora-worker-'));
  const store=createStore(dir);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true})});
  const start=new Date('2026-01-01T00:00:00.000Z');
  store.put('jobs',{id:'job-a',channelId:'default',status:'queued',stage:'queued',retryCount:0,createdAt:start.toISOString()});
  const claimed=store.claimNextJob('worker-a',15_000,start);
  assert.equal(claimed.status,'running');assert.equal(claimed.lease.workerId,'worker-a');
  assert.equal(store.claimNextJob('worker-b',15_000,start),null);
  let time=new Date(start.getTime()+15_001);
  let recovered=store.recoverExpiredJobs(time);assert.equal(recovered[0].status,'queued');assert.equal(recovered[0].retryCount,1);assert.equal(recovered[0].lease,null);
  for(let retry=0;retry<3;retry++){
    const job=store.claimNextJob(`worker-${retry}`,15_000,time);assert.ok(job);
    time=new Date(time.getTime()+15_001);recovered=store.recoverExpiredJobs(time);
  }
  assert.equal(recovered[0].status,'failed');assert.equal(recovered[0].retryCount,3);
});
