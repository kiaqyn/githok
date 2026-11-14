import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {BriefService,BriefError} from '../core/briefs.mjs';
import {GitHubService,createServer} from '../server.mjs';
import {createWorker} from '../cloud/worker.mjs';
const project={owner:'owner',name:'repo',description:'A tool for checking JavaScript dependency versions.',topics:['developer-tools'],language:'JavaScript'};
const answer={translation:'一个用于检查 JavaScript 依赖版本的工具。',summary:'检查 JavaScript 项目的依赖版本。',audience:null};
const result=data=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(data)}]}]});
const config={baseURL:'https://text.example/v1',apiKey:'synthetic-only-not-real',model:'synthetic-text',resolveProject:async()=>project,fetchImpl:async()=>result(answer)};

test('disabled summaries and invalid paths never read a project or call a model',async()=>{
  let calls=0;const service=new BriefService({resolveProject:()=>{calls++;},fetchImpl:()=>{calls++;}});
  await assert.rejects(service.get('owner','repo'),e=>e.code==='BRIEF_NOT_CONFIGURED');
  for(const [owner,repo] of [['../a','repo'],['owner','..'],['owner','a/b']])await assert.rejects(service.get(owner,repo),{status:400});
  assert.equal(calls,0);
  for(const baseURL of ['http://external.test','https://user:password@example.com/v1','https://example.com/v1?key=unsafe'])assert.throws(()=>new BriefService({...config,baseURL}),BriefError);
  assert.throws(()=>new BriefService({...config,apiKey:'bad\r\nkey'}),BriefError);
  const trimmed=new BriefService({...config,baseURL:'  https://text.example/v1/  ',apiKey:'  synthetic-only-not-real  ',model:'  synthetic-text  ',fetchImpl:async(url,options)=>{assert.equal(url,'https://text.example/v1/responses');assert.equal(options.headers.Authorization,'Bearer synthetic-only-not-real');return result(answer);}});
  assert.equal((await trimmed.get('owner','repo')).summary,answer.summary);
});
test('simultaneous and later readers share one generation and get both Chinese views',async()=>{
  let calls=0,body;const service=new BriefService({...config,fetchImpl:async(url,options)=>{calls++;assert.equal(url,'https://text.example/v1/responses');body=JSON.parse(options.body);await new Promise(r=>setTimeout(r,5));return result(answer);}});
  const [a,b]=await Promise.all([service.get('owner','repo'),service.get('owner','repo')]);
  assert.equal(calls,1);assert.equal(a.summary,answer.summary);assert.equal(b.translation,answer.translation);
  assert.equal((await service.get('owner','repo')).cached,true);assert.equal(calls,1);
  assert.equal(body.store,false);assert.equal(body.max_output_tokens,1600);assert.equal(JSON.parse(body.input).original,project.description);
  assert.equal(JSON.stringify(a).includes('synthetic-only-not-real'),false);
});
test('changed source text invalidates the summary while a star-count change does not',async()=>{
  let source={...project},calls=0;const service=new BriefService({...config,resolveProject:async()=>source,fetchImpl:async()=>{calls++;return result(answer);}});
  await service.get('owner','repo');source={...source,stars:9999};await service.get('owner','repo');assert.equal(calls,1);
  source={...source,description:'A different public description.'};await service.get('owner','repo');assert.equal(calls,2);
});
test('cache persists without a credential and can be reused after a service restart',async()=>{
  let rows,calls=0;const store={load:async()=>rows,save:async value=>{rows=value;}};
  const make=()=>new BriefService({...config,cacheStore:store,fetchImpl:async()=>{calls++;return result(answer);}});
  await make().get('owner','repo');const next=await make().get('owner','repo');assert.equal(next.cached,true);assert.equal(calls,1);
  assert.equal(JSON.stringify(rows).includes(config.apiKey),false);
});
test('private and empty evidence is refused before a generation; README fallback is bounded',async()=>{
  let calls=0,input;const fetchImpl=async(url,options)=>{calls++;input=JSON.parse(JSON.parse(options.body).input);return result(answer);};
  await assert.rejects(new BriefService({...config,fetchImpl,resolveProject:async()=>({...project,private:true})}).get('owner','repo'),e=>e.code==='PRIVATE_PROJECT');
  await assert.rejects(new BriefService({...config,fetchImpl,resolveProject:async()=>({...project,description:''}),readme:async()=>{throw Error();}}).get('owner','repo'),e=>e.code==='BRIEF_INSUFFICIENT');assert.equal(calls,0);
  const data=await new BriefService({...config,fetchImpl,resolveProject:async()=>({...project,description:''}),readme:async()=>({text:'# Public README\n'+'x'.repeat(5000)})}).get('owner','repo');
  assert.equal(calls,1);assert.equal(input.original.length,1800);assert.equal(data.evidenceSource,'readme-excerpt');
});
test('provider errors and incomplete or invalid output are not retried or exposed',async()=>{
  for(const fetchImpl of [async()=>new Response('secret: '+config.apiKey,{status:500}),async()=>Response.json({status:'incomplete'}),async()=>result({...answer,summary:'No Chinese'}),async()=>Response.json({output_text:'not JSON'})]){
    let calls=0;const service=new BriefService({...config,fetchImpl:async(...args)=>{calls++;return fetchImpl(...args);}});
    await assert.rejects(service.get('owner','repo'),e=>e instanceof BriefError&&!e.message.includes(config.apiKey));
    await assert.rejects(service.get('owner','repo'),e=>e.code==='BRIEF_COOLDOWN');assert.equal(calls,1);
  }
});
test('concurrency and hourly allowance are bounded and cached results bypass the allowance',async()=>{
  let resolve,started,time=Date.now(),calls=0;
  let dispatched=new Promise(r=>{started=r;});
  const service=new BriefService({...config,now:()=>time,maxCallsPerHour:1,fetchImpl:()=>{calls++;started();return new Promise(r=>{resolve=r;});}});
  // A zero-delay timer does not guarantee async fingerprinting has finished.
  const first=service.get('owner','repo');await dispatched;
  await assert.rejects(service.get('owner','other'),e=>e.code==='BRIEF_LIMIT');resolve(result(answer));await first;
  assert.equal((await service.get('owner','repo')).cached,true);assert.equal(calls,1);
  time+=3600_001;dispatched=new Promise(r=>{started=r;});const second=service.get('owner','other');await dispatched;resolve(result(answer));await second;assert.equal(calls,2);
});
test('existing feed evidence avoids another GitHub read; private project metadata is never used',async()=>{
  let calls=0;const github=new GitHubService({cacheFile:null,fetchImpl:async()=>{calls++;return Response.json({private:true});}});
  github.cache.set('existing',{at:Date.now(),data:{items:[project]}});
  assert.equal((await github.project('owner','repo')).description,project.description);assert.equal(calls,0);
  await assert.rejects(github.project('owner','other'),{status:404});assert.equal(calls,1);
});
test('local and cloud HEAD requests never generate; malformed paths and POST are rejected',async t=>{
  let calls=0;const briefs={enabled:true,get:async()=>{calls++;return answer;}};
  const server=createServer({briefs});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(base+'/api/brief/owner/repo',{method:'HEAD'})).status,200);assert.equal(calls,0);
  assert.equal((await fetch(base+'/api/brief/owner/repo',{method:'POST'})).status,405);
  assert.equal((await fetch(base+'/api/brief/%ZZ/repo')).status,400);
  assert.equal((await fetch(base+'/api/brief/owner/repo')).status,200);assert.equal(calls,1);
  const app=createWorker({briefs});assert.equal((await app.fetch(new Request('https://app.test/api/brief/owner/repo',{method:'HEAD'}))).status,200);assert.equal(calls,1);
  assert.equal((await app.fetch(new Request('https://app.test/api/brief/%ZZ/repo'))).status,400);
});
