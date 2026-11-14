import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import * as i18n from '../public/i18n.js';
import * as session from '../public/session.js';
import * as briefClient from '../public/briefs.js';
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const script=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/gm,'');
const items=(start,count=30)=>Array.from({length:count},(_,i)=>({id:start+i,name:'repo-'+(start+i),owner:'author',topics:[],description:'Synthetic pagination record',stars:1000}));
const batch=(start,cursor='c1')=>({items:items(start),hasMore:!!cursor,nextCursor:cursor,source:'github',fetchedAt:'2026-11-11T12:00:00Z',ordering:'created-windows'});
const flush=()=>new Promise(r=>setTimeout(r,0));
async function page(t,handle){
  const dom=new JSDOM(html,{url:'http://githok.test',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;t.after(()=>w.close());Object.assign(w,i18n,session,briefClient);
  w.localStorage.setItem('githok:language','en');const calls=[];
  w.fetch=async url=>{const u=new URL(url,w.location);calls.push(u);return {ok:true,json:async()=>handle(u,calls.length)};};
  w.eval(script+'\nwindow.__streamRead=expression=>eval(expression);');await flush();await flush();
  return {w,calls,read:s=>w.__streamRead(s),$:id=>w.document.getElementById(id)};
}

test('prefetch starts five projects before the end, keeps navigation live and deduplicates within and across batches',async t=>{
  let finish;const pending=new Promise(r=>{finish=r;});
  const p=await page(t,(_,n)=>n===1?batch(1):pending);
  p.read('state.indexes.discover=24;render()');await flush();assert.equal(p.calls.length,2);
  await p.read('move(1)');assert.equal(p.read('current().id'),26);assert.equal(p.$('next-button').disabled,false);
  assert.equal(p.calls[1].searchParams.get('cursor'),'c1');assert.equal(p.calls[1].searchParams.get('stream'),'1');
  finish({...batch(31,null),items:[...items(30,2),...items(31)]});await flush();await flush();
  assert.equal(p.read('state.seen.size'),60);assert.equal(p.read('state.feed.length'),60);assert.equal(p.read('current().id'),26);
  p.read('state.indexes.discover=29');await p.read('move(1)');assert.equal(p.read('current().id'),31);
});

test('continuous stream passes 1,200 distinct projects while retaining at most 300 full records',async t=>{
  const p=await page(t,(_,n)=>batch((n-1)*30+1,n<42?'c'+n:null));
  for(let i=0;i<41;i++){p.read('state.indexes.discover=state.feed.length-1');await p.read('move(1)');await flush();}
  assert.equal(p.read('state.seen.size'),1260);assert.ok(p.read('state.feed.length')<=300);assert.ok(p.read('state.feedOffset')>=900);
  assert.match(p.$('feed-position').textContent,/1260 loaded/);assert.ok(p.read('state.history.length')<=200);
});

test('late old-filter responses cannot contaminate a newly selected topic',async t=>{
  let finish;const pending=new Promise(r=>{finish=r;});
  const p=await page(t,(u,n)=>n===1?batch(1):u.searchParams.get('topic')==='ai'?batch(1001,null):pending);
  p.read('state.indexes.discover=24;render()');await flush();p.w.document.querySelector('[data-topic="ai"]').click();await flush();
  finish(batch(31,null));await flush();await flush();
  assert.equal(p.read('current().id'),1001);assert.equal(p.read('state.feed.length'),30);assert.equal(p.read('state.seen.has(31)'),false);
});

test('empty continuations stop after a bounded scan and can be explicitly continued',async t=>{
  const p=await page(t,(_,n)=>n===1?batch(1):n<5?{...batch(1,'c'+n),items:[]}:batch(31,null));
  p.read('state.indexes.discover=24;render()');await flush();await flush();
  assert.equal(p.calls.length,4);assert.equal(p.read('state.appendBlocked'),true);assert.equal(p.read('state.hasMore'),true);
  p.$('language-toggle').click();await flush();assert.equal(p.calls.length,4);
  p.read('state.indexes.discover=29');await p.read('move(1)');assert.equal(p.read('current().id'),31);assert.equal(p.calls.length,5);
});

test('initial empty windows expose a continue action rather than falsely reporting no projects',async t=>{
  const p=await page(t,(_,n)=>n<=3?{...batch(1,'c'+n),items:[]}:batch(31,null));
  assert.equal(p.calls.length,3);assert.match(p.$('empty-action').textContent,/Keep exploring/);
  p.$('empty-action').click();await flush();await flush();assert.equal(p.read('current().id'),31);
});

test('rate limiting blocks automatic retries while existing projects remain browsable',async t=>{
  const until=Date.now()+60_000;
  const p=await page(t,(_,n)=>{if(n===1)return batch(1);throw Object.assign(new Error('GitHub 请求额度暂时用完了，稍后会恢复。'),{retryAt:until});});
  p.read('state.indexes.discover=24;render()');await flush();await flush();
  assert.equal(p.calls.length,2);await p.read('move(1)');assert.equal(p.read('current().id'),26);
  p.$('save-button').click();p.$('language-toggle').click();await flush();assert.equal(p.calls.length,2);
  p.read('state.indexes.discover=29');await p.read('move(1)');assert.equal(p.calls.length,2);assert.equal(p.read('current().id'),30);
});
