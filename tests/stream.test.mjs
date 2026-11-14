import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubService, feedParams } from '../core/github.mjs';

const now=Date.parse('2026-11-11T12:00:00Z');
const base=()=>feedParams(new URLSearchParams('stream=1'));
const raw=(id,time)=>({id,name:'repo-'+id,full_name:'author/repo-'+id,owner:{login:'author'},topics:[],stargazers_count:2000,forks_count:1,created_at:new Date(time).toISOString()});

test('stream crosses 1,000 results through nonoverlapping creation windows without dropping tied-star projects',async()=>{
  const records=Array.from({length:1500},(_,i)=>raw(i+1,Date.parse('2026-01-01')+i*15000_000));
  records.push(...Array.from({length:75},(_,i)=>raw(1501+i,Date.parse('2025-06-01')+i*1000)));
  let reads=0;const paths=[];
  const service=new GitHubService({now:()=>now,fetchImpl:async value=>{
    reads++;const u=new URL(value),q=u.searchParams.get('q');paths.push(u);
    const m=q.match(/created:(\S+)\.\.(\S+)/);assert.ok(m);assert.match(q,/stars:>1000/);assert.match(q,/is:public fork:false archived:false/);
    const subset=records.filter(r=>Date.parse(r.created_at)>=Date.parse(m[1])&&Date.parse(r.created_at)<=Date.parse(m[2]));
    const p=Number(u.searchParams.get('page'));assert.ok(p*30<=990);
    return Response.json({items:subset.slice((p-1)*30,p*30),total_count:subset.length,incomplete_results:false});
  }});
  const ids=[];let cursor='',iterations=0;
  while(true){
    const before=reads,r=await service.feed({...base(),cursor});assert.ok(reads-before<=4);
    ids.push(...r.items.map(x=>x.id));
    if(!r.hasMore)break;
    assert.ok(r.nextCursor&&r.nextCursor!==cursor);cursor=r.nextCursor;assert.ok(++iterations<150);
  }
  assert.equal(ids.length,1575);assert.equal(new Set(ids).size,1575);assert.ok(paths.length>33);
});

test('cursor is bounded, validated and bound to the original filters before any upstream call',async()=>{
  let calls=0;const service=new GitHubService({now:()=>now,fetchImpl:async()=>{calls++;return Response.json({items:[],total_count:0});}});
  const root=await service.feed(base());assert.equal(root.scanning,true);
  const valid=JSON.parse(root.nextCursor);
  const bad=[ 'not-json', JSON.stringify({...valid,scope:'different'}), JSON.stringify({...valid,ranges:[[0,1,1]]}), JSON.stringify({...valid,ranges:[[valid.at,valid.at,34]]}),JSON.stringify({...valid,at:valid.at+86400}),JSON.stringify({...valid,ranges:Array(65).fill(valid.ranges[0])}) ];
  const before=calls;
  for(const cursor of bad)await assert.rejects(service.feed({...base(),cursor}),{status:400});
  await assert.rejects(service.feed({...base(),topic:'web',cursor:root.nextCursor}),{status:400});
  assert.equal(calls,before);
  assert.throws(()=>feedParams(new URLSearchParams('cursor=anything')),{status:400});
  assert.throws(()=>feedParams(new URLSearchParams('stream=1&cursor='+'x'.repeat(4097))),{status:400});
});

test('incomplete indivisible intervals disclose limited coverage rather than pretending exhaustive results',async()=>{
  const at=Math.floor(now/1000);
  const cursor=JSON.stringify({v:1,scope:JSON.stringify(['all','popular','']),at,ranges:[[at,at,1]]});
  const service=new GitHubService({now:()=>now,fetchImpl:async()=>Response.json({items:[raw(1,now)],total_count:1,incomplete_results:true})});
  const result=await service.feed({...base(),cursor});assert.equal(result.coverageLimited,true);assert.equal(result.incomplete,true);
});

test('new projects keep the 90-day scope, and a cached continuation keeps its original reference date',async()=>{
  let time=now;const urls=[];
  const service=new GitHubService({now:()=>time,fetchImpl:async value=>{urls.push(new URL(value));return Response.json({items:Array.from({length:30},(_,i)=>raw(i+1,now)),total_count:31});}});
  const params={...base(),mode:'new'};const first=await service.feed(params);
  assert.match(urls[0].searchParams.get('q'),/stars:>10/);
  const low=Date.parse(urls[0].searchParams.get('q').match(/created:(\S+)\.\./)[1]);assert.equal(low,now-90*86400_000);
  time+=86400_000;await service.feed({...params,cursor:first.nextCursor});
  assert.equal(JSON.parse(first.nextCursor).at,Math.floor(now/1000));
});

test('visitors within the same 15-minute window share cached discovery requests',async()=>{
  let time=now,calls=0;const service=new GitHubService({now:()=>time,fetchImpl:async()=>{calls++;return Response.json({items:[raw(1,now)],total_count:1});}});
  await service.feed(base());time+=123_000;await service.feed(base());assert.equal(calls,1);
});
