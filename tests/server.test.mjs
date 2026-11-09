import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { GitHubService, createServer, feedParams } from '../server.mjs';

const repo={id:1,name:'sample',full_name:'author/sample',owner:{login:'author',avatar_url:'https://avatars.githubusercontent.com/u/1'},description:'A real response-shaped fixture',stargazers_count:1234,forks_count:40,language:'TypeScript',topics:['developer-tools'],license:{spdx_id:'MIT'},pushed_at:'2026-11-01T00:00:00Z',created_at:'2024-01-01T00:00:00Z',default_branch:'main'};
const response=()=>Response.json({items:[repo],total_count:31,incomplete_results:false});
const params=()=>feedParams(new URLSearchParams());

test('rejects malformed filters, inherited keys, oversized input and unbounded pagination',()=>{
  for(const search of ['topic=toString','topic=__proto__','mode=anything','page=0','page=11','page=1.5','page=01','q='+('a'.repeat(121)),'q=%00'])assert.throws(()=>feedParams(new URLSearchParams(search)),{status:400});
  assert.deepEqual(params(),{topic:'all',mode:'popular',page:1,q:''});
});
test('parallel feed reads share one upstream request and later reads hit the cache',async()=>{
  let calls=0;const service=new GitHubService({cacheFile:null,fetchImpl:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,15));return response();}});
  const [a,b]=await Promise.all([service.feed(params()),service.feed(params())]);
  assert.equal(calls,1);assert.equal(a.items[0].fullName,'author/sample');assert.deepEqual(a,b);
  assert.equal((await service.feed(params())).source,'cache');assert.equal(calls,1);
});
test('search enforces public scope and treats user qualifiers as literal text',async()=>{
  let url;const service=new GitHubService({cacheFile:null,token:undefined,fetchImpl:async value=>{url=new URL(value);return response();}});
  await service.feed({...params(),q:'repo:private/test "hello"'});
  const query=url.searchParams.get('q');assert.match(query,/is:public fork:false archived:false/);assert.match(query,/^"repo:private\/test  hello " in:name,description,topics/);assert.equal(url.searchParams.get('per_page'),'30');
  assert.doesNotMatch(query,/stars:|pushed:|created:/);assert.equal(url.searchParams.has('sort'),false);
});
test('expired cache becomes explicitly stale on network error and stops being served after seven days',async()=>{
  let time=Date.now(),offline=false;
  const service=new GitHubService({cacheFile:null,now:()=>time,fetchImpl:async()=>{if(offline)throw Error('offline');return response();}});
  const first=await service.feed(params());time+=16*60_000;offline=true;
  const stale=await service.feed(params());assert.equal(stale.stale,true);assert.equal(stale.fetchedAt,first.fetchedAt);assert.ok(stale.warning);
  time+=8*86_400_000;await assert.rejects(service.feed(params()),{status:502});
});
test('rate-limit headers stop repeated upstream calls, while README has a separate bucket',async()=>{
  const time=Date.now();let calls=0;
  const service=new GitHubService({cacheFile:null,now:()=>time,fetchImpl:async url=>{calls++;return url.includes('/search/')?new Response('{}',{status:403,headers:{'retry-after':'120'}}):new Response('# Hello');}});
  await assert.rejects(service.feed(params()),e=>e.status===429&&e.retryAt===time+120_000);
  await assert.rejects(service.feed({...params(),page:2}),{status:429});assert.equal(calls,1);
  assert.equal((await service.readme('author','sample')).text,'# Hello');assert.equal(calls,2);
});
test('README is bounded and rejects paths that could escape the intended endpoint',async()=>{
  let calls=0;const service=new GitHubService({cacheFile:null,fetchImpl:async()=>{calls++;return new Response('<script>alert(1)</script>\n'+'x'.repeat(30_000));}});
  const data=await service.readme('author','sample');assert.equal(data.text.length,24_000);assert.equal(data.truncated,true);
  assert.throws(()=>service.readme('author/other','sample'),{status:400});assert.throws(()=>service.readme('author','..'),{status:400});assert.equal(calls,1);
});
test('HTTP routes provide safety headers, validate API input and never serve arbitrary local paths',async t=>{
  let calls=0;const github=new GitHubService({cacheFile:null,fetchImpl:async()=>{calls++;return response();}});
  const server=createServer({github});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port;
  const home=await fetch(base);assert.equal(home.status,200);assert.match(home.headers.get('content-security-policy'),/script-src 'self'/);assert.match(await home.text(),/GitHok/);
  assert.equal((await fetch(base+'/api/feed?page=999')).status,400);assert.equal(calls,0);
  assert.equal((await fetch(base+'/server.mjs')).status,404);assert.equal((await fetch(base+'/api/feed',{method:'POST'})).status,405);
  const feed=await (await fetch(base+'/api/feed')).json();assert.equal(feed.items.length,1);assert.equal(calls,1);
});
