import test from 'node:test';
import assert from 'node:assert/strict';
import {createBriefController,briefKey} from '../public/briefs.js';
const r=id=>({id,owner:'author',name:'project-'+id,description:'Public description '+id,topics:['tools'],language:'JavaScript'});
const a=r(1),b=r(2),c=r(3);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(options={}){
  let current=a,language='zh',visible=true,time=Date.now(),counter=0,calls=0;
  const jobs=new Map(),values=options.values||new Map(),changes=[];
  const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>{if(options.storageFailure)throw Error('quota');values.set(key,value);}};
  const data=(repo=a,extra={})=>({version:1,fullName:repo.owner+'/'+repo.name,fingerprint:'a'.repeat(64),at:time,original:repo.description,evidenceSource:'description',translation:'这是中文简介。',summary:'这是简短中文速览。',audience:null,...extra});
  const client=createBriefController({storage,getCurrent:()=>current,getLanguage:()=>language,isVisible:()=>visible,now:()=>time,setTimer:(fn,ms)=>{jobs.set(++counter,{fn,at:time+ms});return counter;},clearTimer:id=>jobs.delete(id),fetchImpl:async url=>{calls++;return options.fetchImpl?options.fetchImpl(url,data):Response.json(data(current));},onChange:()=>changes.push({repo:current?.name,state:current?client.peek(current):null})});
  async function advance(ms=650){time+=ms;for(const [id,job] of [...jobs])if(job.at<=time){jobs.delete(id);job.fn();}await flush();}
  return {client,data,values,changes,advance,calls:()=>calls,current:repo=>{current=repo;},language:value=>{language=value;},visible:value=>{visible=value;}};
}
test('rapid scrolling generates only the project where the reader actually stops',async()=>{
  const h=harness();h.client.select(a);h.current(b);h.client.select(b);h.current(c);h.client.select(c);
  await h.advance(649);assert.equal(h.calls(),0);await h.advance(1);assert.equal(h.calls(),1);
  assert.equal(h.client.peek(c).state,'ready');assert.equal(h.client.peek(a).state,'idle');
  h.client.destroy();
});
test('English and hidden pages do not trigger a paid request',async()=>{
  const h=harness();h.language('en');h.client.select(a);await h.advance();assert.equal(h.calls(),0);
  h.language('zh');h.visible(false);h.client.select(a);await h.advance();assert.equal(h.calls(),0);
  h.visible(true);h.client.select(a);h.client.pause();await h.advance();assert.equal(h.calls(),0);h.client.destroy();
});
test('a queued project stays pending and late results cannot overwrite the new project',async()=>{
  let finish;const h=harness({fetchImpl:(url,data)=>url.endsWith('project-1')?new Promise(resolve=>{finish=()=>resolve(Response.json(data(a)));}):Response.json(data(b))});
  h.client.select(a);await h.advance();assert.equal(h.calls(),1);
  h.current(b);h.client.select(b);assert.equal(h.client.peek(b).state,'pending');
  finish();await flush();assert.notEqual(h.client.peek(b).data?.fullName,'author/project-1');
  await h.advance();assert.equal(h.client.peek(b).state,'ready');assert.equal(h.client.peek(b).data.fullName,'author/project-2');
  h.current(a);h.client.select(a);assert.equal(h.client.peek(a).state,'ready');assert.equal(h.calls(),2);h.client.destroy();
});
test('summary, translation and original modes reuse one cached result across refresh',async()=>{
  const h=harness();h.client.select(a);await h.advance();
  for(const mode of ['translation','original','summary']){h.client.mode(a,mode);assert.equal(h.client.peek(a).mode,mode);}
  h.client.mode(a,'invalid');assert.equal(h.client.peek(a).mode,'summary');assert.equal(h.calls(),1);h.client.destroy();
  const restored=harness({values:h.values});restored.client.select(a);await restored.advance();assert.equal(restored.calls(),0);assert.equal(restored.client.peek(a).state,'ready');
  const changed={...a,description:'Changed public description'};restored.current(changed);restored.client.select(changed);await restored.advance();assert.equal(restored.calls(),1);restored.client.destroy();
});
test('failure and cooldown never retry automatically, including after navigation',async()=>{
  const h=harness({fetchImpl:(url,data)=>Response.json({code:'BRIEF_COOLDOWN',retryAt:data().at+5000},{status:429})});
  h.client.select(a);await h.advance();assert.equal(h.calls(),1);assert.equal(h.client.peek(a).state,'error');
  h.client.select(a);await h.advance();assert.equal(h.calls(),1);h.client.select(a,{manual:true});await h.advance();assert.equal(h.calls(),1);
  await h.advance(5001);assert.equal(h.calls(),1);h.client.select(a,{manual:true});await h.advance(0);assert.equal(h.calls(),2);h.client.destroy();
});
test('wrong repository, changed evidence and malformed output remain errors rather than cached successes',async()=>{
  for(const extra of [{fullName:'other/project'},{original:'Different source'},{summary:'English only'}]){
    const h=harness({fetchImpl:(url,data)=>Response.json(data(a,extra))});h.client.select(a);await h.advance();assert.equal(h.client.peek(a).state,'error');assert.equal(h.client.peek(a).data,undefined);h.client.destroy();
  }
});
test('storage failures keep the current translated text usable',async()=>{
  const h=harness({storageFailure:true});h.client.select(a);await h.advance();assert.equal(h.client.peek(a).state,'ready');h.client.select(a);await h.advance();assert.equal(h.calls(),1);h.client.destroy();
});
test('destroying a controller prevents late callbacks after the page is gone',async()=>{
  let finish;const h=harness({fetchImpl:(url,data)=>new Promise(resolve=>{finish=()=>resolve(Response.json(data(a)));})});
  h.client.select(a);await h.advance();h.client.destroy();const before=h.changes.length;finish();await flush();assert.equal(h.changes.length,before);
});
test('cache entries are bounded and malformed saved cache is ignored',async()=>{
  const values=new Map([['githok:briefs:v1',JSON.stringify({v:1,entries:[['invalid',{}],[briefKey(a),{version:1}]]})]]);
  const h=harness({values});assert.equal(h.client.peek(a).state,'idle');h.client.select(a);await h.advance();assert.equal(h.calls(),1);h.client.destroy();
});
