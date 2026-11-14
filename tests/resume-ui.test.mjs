import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import * as i18n from '../public/i18n.js';
import * as session from '../public/session.js';
import * as briefClient from '../public/briefs.js';
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const script=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/gm,'');
const items=start=>Array.from({length:30},(_,i)=>({id:start+i,name:'repo-'+(start+i),owner:'author',topics:[],description:'Public checkpoint fixture',stars:1000}));
const batch=(start,cursor='next')=>({items:items(start),hasMore:!!cursor,nextCursor:cursor,source:'github',fetchedAt:new Date().toISOString(),ordering:'created-windows'});
const flush=()=>new Promise(r=>setTimeout(r,0));
async function page(t,{stored={},handle=()=>batch(1),blockedStorage=false}={}){
  const dom=new JSDOM(html,{url:'http://githok.test',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;t.after(()=>w.close());Object.assign(w,i18n,session,briefClient);
  for(const [key,value] of Object.entries({'githok:language':'en',...stored}))w.localStorage.setItem(key,value);
  if(blockedStorage){const original=w.localStorage;Object.defineProperty(w,'localStorage',{value:{getItem:k=>original.getItem(k),removeItem:k=>original.removeItem(k),setItem:()=>{throw Error('quota');}}});}
  const calls=[];w.fetch=async url=>{const u=new URL(url,w.location);calls.push(u);const result=await handle(u,calls.length);return {ok:result.ok!==false,json:async()=>result};};
  w.eval(script+'\nwindow.__read=expression=>eval(expression);');await flush();await flush();
  return {w,calls,$:id=>w.document.getElementById(id),read:s=>w.__read(s)};
}
function storedCheckpoint(){
  const map=new Map(),storage={setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
  session.writeResume(storage,{topic:'web',mode:'gems',query:'render',feed:items(31),index:14,offset:30,seen:Array.from({length:60},(_,i)=>i+1),hasMore:true,cursor:'continue-60'});
  return Object.fromEntries(map);
}

test('restore paints the exact project and filters without refetching, then continues the stored cursor',async t=>{
  const p=await page(t,{stored:storedCheckpoint(),handle:()=>batch(61,'continue-90')});
  assert.equal(p.calls.length,0);assert.equal(p.read('current().id'),45);assert.equal(p.$('search').value,'render');
  assert.equal(p.read('state.topic'),'web');assert.equal(p.read('state.mode'),'gems');assert.equal(p.$('data-origin').textContent,'Local progress');
  assert.match(p.$('source-note').textContent,/Local browsing checkpoint/);assert.match(p.$('feed-position').textContent,/No. 45/);
  p.read('state.indexes.discover=29');await p.read('move(1)');
  assert.equal(p.calls.length,1);assert.equal(p.calls[0].searchParams.get('cursor'),'continue-60');assert.equal(p.calls[0].searchParams.get('topic'),'web');
  assert.equal(p.read('current().id'),61);assert.equal(p.read('state.seen.size'),90);
});
test('pagehide saves the most recent position and a new page keeps it and saved projects',async t=>{
  const p=await page(t,{handle:(_,n)=>n===1?batch(1):batch(31,'after-60')});
  p.read('state.indexes.discover=24;render()');await flush();await flush();
  p.read('state.indexes.discover=40;render()');p.$('save-button').click();p.w.dispatchEvent(new p.w.Event('pagehide'));
  const stored={};for(let i=0;i<p.w.localStorage.length;i++){const key=p.w.localStorage.key(i);stored[key]=p.w.localStorage.getItem(key);}
  const next=await page(t,{stored,handle:()=>{throw Error('should not refetch');}});
  assert.equal(next.read('current().id'),41);assert.equal(next.calls.length,0);assert.equal(next.$('saved-count').textContent,'1');
  next.$('restart-feed').click();await flush();assert.equal(next.calls.length,1);assert.equal(next.$('saved-count').textContent,'1');
});
test('retrying a failed prefetch preserves the current DOM and reading position',async t=>{
  const p=await page(t,{handle:(_,n)=>{if(n===2)throw Error('offline');return n===1?batch(1):batch(31,'after-60');}});
  p.read('state.indexes.discover=24;render()');await flush();await flush();
  assert.equal(p.$('connection-status').hidden,false);assert.equal(p.$('retry-feed').disabled,false);
  const before=p.w.document.querySelector('.project-stage');
  p.$('retry-feed').click();await flush();await flush();
  assert.equal(p.calls.length,3);assert.equal(p.read('current().id'),25);assert.equal(p.w.document.querySelector('.project-stage'),before);
  assert.equal(p.$('connection-status').hidden,true);assert.equal(p.read('state.seen.size'),60);
});
test('initial rate-limit cooldown disables retry until its deadline without more requests',async t=>{
  const retryAt=Date.now()+60_000;
  const p=await page(t,{handle:(_,n)=>n===1?{ok:false,error:'GitHub 请求额度暂时用完了，稍后会恢复。',retryAt}:batch(1)});
  assert.equal(p.$('empty-action').disabled,true);p.$('empty-action').click();assert.equal(p.calls.length,1);
  p.w.Date.now=()=>retryAt+1;p.read('refreshFeedback()');assert.equal(p.$('empty-action').disabled,false);
  p.$('empty-action').click();await flush();await flush();assert.equal(p.calls.length,2);assert.equal(p.read('current().id'),1);
});
test('offline/online feedback changes without automatic request loops',async t=>{
  const p=await page(t);Object.defineProperty(p.w.navigator,'onLine',{value:false,configurable:true});p.w.dispatchEvent(new p.w.Event('offline'));
  assert.equal(p.$('connection-status').hidden,false);assert.equal(p.$('retry-feed').disabled,true);assert.match(p.$('connection-message').textContent,/offline/);
  Object.defineProperty(p.w.navigator,'onLine',{value:true});p.w.dispatchEvent(new p.w.Event('online'));
  assert.equal(p.$('connection-status').hidden,true);assert.equal(p.calls.length,1);
});
test('storage failures leave browsing working and explicitly flag unsaved progress',async t=>{
  const p=await page(t,{blockedStorage:true});p.read('persistProgress()');
  assert.equal(p.read('current().id'),1);assert.match(p.$('source-note').textContent,/could not be saved/);
  await p.read('move(1)');assert.equal(p.read('current().id'),2);
});

test('failure after empty initial windows keeps the continuation and enforces its cooldown',async t=>{
  const retryAt=Date.now()+60_000;
  const p=await page(t,{handle:(_,n)=>n<=3?{...batch(1,'scan-'+n),items:[]}:n===4?{ok:false,error:'GitHub 请求额度暂时用完了，稍后会恢复。',retryAt}:batch(31,'scan-5')});
  p.$('empty-action').click();await flush();await flush();
  assert.equal(p.calls.length,4);assert.equal(p.$('empty-action').disabled,true);
  p.w.Date.now=()=>retryAt+1;p.read('refreshFeedback()');p.$('empty-action').click();await flush();await flush();
  assert.equal(p.calls[4].searchParams.get('cursor'),'scan-3');assert.equal(p.read('current().id'),31);
});
