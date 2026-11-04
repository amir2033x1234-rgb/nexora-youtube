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
  first.put('trends',{id:'idea-1',topic:'Ocean heat',createdAt:'2026-01-02T00:00:00.000Z'},'science');
  first.close();
  const second=createStore(dir);
  assert.equal(second.get('trends','idea-1').topic,'Ocean heat');
  assert.equal(second.list('channels').some(c=>c.id==='science'),true);
  assert.equal(second.countSince('trends','2026-01-01T00:00:00.000Z'),1);
  second.close();
});
