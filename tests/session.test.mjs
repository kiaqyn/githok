import test from 'node:test';
import assert from 'node:assert/strict';
import { readResume, writeResume, RESUME_KEY, MAX_RESUME_CHARS } from '../public/session.js';
const now=Date.now();
const repo=id=>({id,owner:'author',name:'repo-'+id,topics:['tools'],description:'Public project',stars:10,forks:2});
const checkpoint=()=>({topic:'web',mode:'gems',query:'render',feed:[repo(18),repo(19)],index:1,offset:17,seen:Array.from({length:19},(_,i)=>i+1),hasMore:true,cursor:'opaque-continuation'});
function storage(){const map=new Map();return {map,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}

test('checkpoint preserves selected project, filters, continuation and previously evicted IDs',()=>{
  const s=storage(),input=checkpoint();input.feed[0].unrelated='not-for-storage';
  assert.equal(writeResume(s,input,now),true);const result=readResume(s,now+1000);
  assert.equal(result.feed[result.index].id,19);assert.equal(result.offset,17);assert.equal(result.cursor,input.cursor);
  assert.deepEqual(result.seen,input.seen);assert.equal(result.topic,'web');assert.equal(result.query,'render');
  assert.equal(s.getItem(RESUME_KEY).includes('not-for-storage'),false);
});
test('expired, corrupt, oversized and inconsistent snapshots are ignored safely',()=>{
  const good={...checkpoint(),v:1,at:now};
  const bad=[{...good,v:2},{...good,at:now-25*3600_000},{...good,at:now+120_000},{...good,index:2},{...good,offset:0},{...good,seen:[18,18]},{...good,topic:'__proto__'},{...good,query:'bad\nquery'},{...good,cursor:'x'.repeat(4097)},{...good,feed:[{...repo(18),owner:undefined},repo(19)]}];
  for(const data of bad){const s=storage();s.setItem(RESUME_KEY,JSON.stringify(data));assert.equal(readResume(s,now),null);}
  for(const raw of ['{broken','x'.repeat(MAX_RESUME_CHARS+1)]){const s=storage();s.setItem(RESUME_KEY,raw);assert.equal(readResume(s,now),null);}
});
test('quota failure removes only the unusable checkpoint and keeps saved projects and history',()=>{
  const s=storage();s.map.set('githok:saved','saved-data');s.map.set('githok:history','history-data');s.map.set(RESUME_KEY,'old-position');
  s.setItem=()=>{throw Error('quota');};assert.equal(writeResume(s,checkpoint(),now),false);
  assert.equal(s.getItem(RESUME_KEY),null);assert.equal(s.getItem('githok:saved'),'saved-data');assert.equal(s.getItem('githok:history'),'history-data');
});
test('checkpoint size is bounded without imposing a browsing limit',()=>{
  const s=storage(),data={...checkpoint(),feed:Array.from({length:300},(_,i)=>({...repo(i+1),description:'x'.repeat(6000)})),seen:Array.from({length:300},(_,i)=>i+1),offset:0,index:299};
  assert.equal(writeResume(s,data,now),false);assert.equal(s.getItem(RESUME_KEY),null);
});

test('one in-flight prefetch while backtracking can be checkpointed without dropping the selected project',()=>{
  const s=storage(),data={...checkpoint(),feed:Array.from({length:330},(_,i)=>repo(i+1)),seen:Array.from({length:330},(_,i)=>i+1),offset:0,index:0};
  assert.equal(writeResume(s,data,now),true);const result=readResume(s,now);assert.equal(result.feed.length,330);assert.equal(result.feed[result.index].id,1);
});
