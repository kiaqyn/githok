import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker, EdgeGitHubService } from '../cloud/worker.mjs';
import { ApiError, feedParams } from '../core/github.mjs';

const params=()=>feedParams(new URLSearchParams());
test('default transport does not bind the runtime fetch function to a service instance',async t=>{
  const original=globalThis.fetch;
  globalThis.fetch=function(){assert.equal(this instanceof EdgeGitHubService,false);return Promise.resolve(Response.json({items:[],total_count:0}));};
  t.after(()=>{globalThis.fetch=original;});
  const service=new EdgeGitHubService();
  assert.equal((await service.feed(params())).source,'github');
});
test('cloud routes serve embedded assets and retain validation before reading GitHub',async()=>{
  let calls=0;
  const app=createWorker({assets:{'/index.html':{type:'text/html',body:'<h1>GitHok</h1>'}},github:{feed:async()=>{calls++;return {items:[]};}}});
  const get=path=>app.fetch(new Request('https://test.invalid'+path));
  assert.equal(await (await get('/')).text(),'<h1>GitHok</h1>');
  assert.equal((await get('/api/feed?page=999')).status,400);assert.equal(calls,0);
  assert.equal((await get('/api/feed')).status,200);assert.equal(calls,1);
  assert.equal((await get('/__proto__')).status,404);
  assert.equal((await app.fetch(new Request('https://test.invalid/api/feed',{method:'POST'}))).status,405);
});
test('cloud default feed can use a dated real snapshot only when upstream fails',async()=>{
  const time=Date.now();const seed={items:[{id:1}],fetchedAt:new Date(time-60_000).toISOString()};
  const github={feed:async()=>{throw new ApiError('offline',502);}};
  const app=createWorker({github,seed,now:()=>time});
  const fallback=await (await app.fetch(new Request('https://test.invalid/api/feed'))).json();
  assert.equal(fallback.stale,true);assert.equal(fallback.fetchedAt,seed.fetchedAt);assert.equal(fallback.warning,'offline');
  assert.equal((await app.fetch(new Request('https://test.invalid/api/feed?q=another'))).status,502);
  const expired=createWorker({github,seed,now:()=>time+8*86_400_000});
  assert.equal((await expired.fetch(new Request('https://test.invalid/api/feed'))).status,502);
});
test('edge cache survives a new isolate and exposes stale data correctly on failure',async()=>{
  let time=Date.now(),calls=0;const store=new Map();
  const edge={match:async request=>store.get(request.url)?.clone(),put:async(request,response)=>{store.set(request.url,response.clone());}};
  const fetchImpl=async()=>{calls++;return Response.json({items:[],total_count:0});};
  const a=new EdgeGitHubService({edge,now:()=>time,fetchImpl});await a.feed(params());assert.equal(calls,1);
  const b=new EdgeGitHubService({edge,now:()=>time,fetchImpl});assert.equal((await b.feed(params())).source,'cache');assert.equal(calls,1);
  time+=16*60_000;
  const c=new EdgeGitHubService({edge,now:()=>time,fetchImpl:async()=>{throw Error('offline');}});
  assert.equal((await c.feed(params())).stale,true);
});
test('malformed encoded repository paths return a client error in the cloud runtime',async()=>{
  const app=createWorker({github:{readme:async()=>{throw Error('must not reach');}}});
  assert.equal((await app.fetch(new Request('https://test.invalid/api/readme/%ZZ/repo'))).status,400);
});
test('rate-limited README uses one bounded public raw fallback without forwarding credentials',async()=>{
  const urls=[];
  const service=new EdgeGitHubService({token:'synthetic-test-only',fetchImpl:async(url,options)=>{
    urls.push(url);
    if(url.startsWith('https://api.github.com/'))return new Response('{}',{status:403,headers:{'retry-after':'120'}});
    assert.equal(options.headers.Authorization,undefined);
    return new Response('# Real README\n'+'x'.repeat(40_000));
  }});
  const result=await service.readme('author','sample');
  assert.equal(result.contentSource,'github-raw');assert.equal(result.text.length,24_000);assert.equal(result.truncated,true);
  assert.equal(urls.length,2);assert.equal(urls[1],'https://raw.githubusercontent.com/author/sample/HEAD/README.md');
  await service.readme('author','sample');assert.equal(urls.length,2);
});
test('unavailable conventional raw README preserves the original failure without scanning filenames',async()=>{
  let calls=0;
  const service=new EdgeGitHubService({fetchImpl:async()=>{calls++;return new Response('{}',{status:calls===1?403:404});}});
  await assert.rejects(service.readme('author','sample'),{status:429});assert.equal(calls,2);
});
