import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import * as i18n from '../public/i18n.js';
import * as session from '../public/session.js';
import * as briefs from '../public/briefs.js';
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const script=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/gm,'');
const repos=[1,2].map(id=>({id,owner:'author',name:'project-'+id,description:'Public project '+id,topics:['tools'],stars:500}));
const flush=()=>new Promise(resolve=>setTimeout(resolve,10));
async function page(t,{authenticated=true,configured=true,write,read,sessionRead}={}){
  const dom=new JSDOM(html,{url:'http://githok.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;t.after(()=>w.close());
  Object.assign(w,i18n,session,briefs);w.AbortSignal=globalThis.AbortSignal;
  w.localStorage.setItem('githok:language','zh');const calls=[];
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.fetch=async(path,options={})=>{
    calls.push({path,options});
    if(path==='/api/github/session')return sessionRead?sessionRead():Response.json({configured,authenticated,csrf:'synthetic-csrf',user:{login:'synthetic-user'}});
    if(path.startsWith('/api/github/star/'))return options.method==='PUT'?(write?write(path):Response.json({starred:true})):(read?read(path):Response.json({starred:false}));
    if(path==='/api/github/logout')return Response.json({authenticated:false});
    if(path==='/api/brief-status')return Response.json({enabled:false});
    return Response.json({items:repos,hasMore:false,source:'github',fetchedAt:new Date().toISOString()});
  };
  w.eval(script);await flush();
  const $=selector=>w.document.querySelector(selector);
  const pointer=(type,target,extra={})=>{const event=new w.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:120,clientY:200,...extra});Object.defineProperties(event,{pointerId:{value:extra.pointerId??1},isPrimary:{value:extra.isPrimary??true}});target.dispatchEvent(event);};
  const tap=(target=$('.project-stage'),extra={})=>{pointer('pointerdown',target,extra);pointer('pointerup',target,extra);};
  return{w,$,calls,pointer,tap,star:()=>{tap();tap();},writes:()=>calls.filter(c=>c.options.method==='PUT')};
}

test('a double tap stars on GitHub only after confirmation; repeat taps do not unstar or duplicate a pending write',async t=>{
  let release;const p=await page(t,{write:()=>new Promise(r=>{release=()=>r(Response.json({starred:true}));})});
  p.star();await flush();assert.equal(p.writes().length,1);assert.equal(p.$('#github-star-button').getAttribute('aria-pressed'),'false');assert.equal(p.$('.star-burst'),null);
  p.star();await flush();assert.equal(p.writes().length,1);
  release();await flush();assert.equal(p.$('#github-star-button').getAttribute('aria-pressed'),'true');assert.ok(p.$('.star-burst'));assert.equal(p.$('#saved-count').textContent,'0');
  assert.match(p.$('#github-star-status').textContent,/GitHub.*author\/project-1/);assert.equal(p.$('#toast').hidden,true);p.star();await flush();assert.equal(p.writes().length,1);
  assert.equal(p.writes()[0].options.headers['X-GitHok-CSRF'],'synthetic-csrf');
});
test('double taps arriving while session lookup is pending share one Star write',async t=>{
  let release;const p=await page(t,{sessionRead:()=>new Promise(r=>{release=()=>r(Response.json({authenticated:true,configured:true,csrf:'csrf'}));})});
  p.star();await flush();p.star();await flush();release();await flush();assert.equal(p.writes().length,1);
});
test('links, controls, a single tap, drag, cancelled and secondary pointers do not star',async t=>{
  const p=await page(t);p.tap();await flush();assert.equal(p.writes().length,0);
  const stage=p.$('.project-stage');
  p.tap(p.$('.open-repo'));p.tap(p.$('.open-repo'));
  p.tap(p.$('.brief-retry'));p.tap(p.$('.brief-retry'));
  p.pointer('pointerdown',stage);p.pointer('pointermove',stage,{clientY:280});p.pointer('pointerup',stage,{clientY:280});
  p.pointer('pointerdown',stage);p.pointer('pointercancel',stage);p.pointer('pointerup',stage);
  p.tap(stage,{isPrimary:false});p.tap(stage,{isPrimary:false});await flush();assert.equal(p.writes().length,0);
  p.tap();p.$('#next-button').click();p.tap();await flush();assert.equal(p.writes().length,0);
});
test('a late first-project confirmation never lights or animates the second project',async t=>{
  let release;const p=await page(t,{write:()=>new Promise(r=>{release=()=>r(Response.json({starred:true}));})});p.star();await flush();p.$('#next-button').click();
  release();await flush();assert.equal(p.$('.project-title').textContent,'project-2');assert.equal(p.$('#github-star-button').getAttribute('aria-pressed'),'false');assert.equal(p.$('.star-burst'),null);assert.match(p.$('#toast').textContent,/project-1/);
});
test('failed writes keep an unstarred UI and retry only when explicitly requested',async t=>{
  const p=await page(t,{write:()=>Response.json({code:'GITHUB_FORBIDDEN'},{status:403})});p.star();await flush();
  assert.equal(p.$('#github-star-button').getAttribute('aria-pressed'),'false');assert.equal(p.$('.star-burst'),null);assert.match(p.$('#toast').textContent,/GitHub 拒绝/);await flush();assert.equal(p.writes().length,1);
  p.$('#github-star-button').click();await flush();assert.equal(p.writes().length,2);
});
test('logged-out and unconfigured users see the sign-in boundary, and local bookmarks stay independent',async t=>{
  const p=await page(t,{authenticated:false,configured:false});p.star();await flush();assert.equal(p.writes().length,0);assert.equal(p.$('#github-dialog').open,true);assert.match(p.$('#github-account-status').textContent,/尚未开启/);assert.equal(p.$('#github-login').hidden,true);
  p.$('#github-dialog').close();p.$('#save-button').click();assert.equal(p.$('#saved-count').textContent,'1');assert.equal(p.$('#github-star-button').getAttribute('aria-pressed'),'false');
  const q=await page(t,{authenticated:false});q.star();await flush();assert.equal(q.$('#github-login').hidden,false);assert.equal(q.writes().length,0);
});
test('reduced-motion users get an accessible confirmed state without a burst',async t=>{
  const p=await page(t);p.w.matchMedia=()=>({matches:true});p.star();await flush();assert.equal(p.$('#github-star-button').getAttribute('aria-pressed'),'true');assert.equal(p.$('.star-burst'),null);assert.match(p.$('#github-star-button').getAttribute('aria-label'),/已在 GitHub/);
});
test('existing text selection and long presses preserve reading rather than adding a Star',async t=>{
  const p=await page(t),stage=p.$('.project-stage');
  const selection=p.w.getSelection(),range=p.w.document.createRange();range.selectNodeContents(p.$('.repo-description'));selection.addRange(range);
  p.star();await flush();assert.equal(p.writes().length,0);selection.removeAllRanges();
  const now=p.w.Date.now;let time=1000;p.w.Date.now=()=>time;
  p.pointer('pointerdown',stage);time+=400;p.pointer('pointerup',stage);p.tap();await flush();assert.equal(p.writes().length,0);p.w.Date.now=now;
});
test('switching GitHub accounts clears the former account’s cached Star state',async t=>{
  let user='first-user';const p=await page(t,{sessionRead:()=>Response.json({authenticated:true,configured:true,csrf:'csrf',user:{login:user}})});
  p.star();await flush();assert.equal(p.$('#github-star-button').getAttribute('aria-pressed'),'true');
  user='second-user';p.$('#github-account-button').click();await flush();assert.equal(p.$('#github-star-button').getAttribute('aria-pressed'),'false');assert.match(p.$('#github-account-status').textContent,/second-user/);
});
