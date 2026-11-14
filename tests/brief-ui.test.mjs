import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import * as i18n from '../public/i18n.js';
import * as session from '../public/session.js';
import * as briefs from '../public/briefs.js';
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const script=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/gm,'');
const repos=[1,2].map(id=>({id,owner:'author',name:'project-'+id,description:'Original description '+id,topics:['tools'],stars:500,language:'JavaScript',license:'MIT',pushedAt:'2026-11-01T00:00:00Z'}));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let i=0;i<200;i++){if(predicate())return;await sleep(5);}throw Error('Expected brief state did not arrive');}
const output=(repo,extra={})=>({version:1,fullName:repo.owner+'/'+repo.name,original:repo.description,evidenceSource:'description',fingerprint:'b'.repeat(64),at:Date.now(),translation:'用于检查公开项目依赖版本的工具。',summary:'检查项目依赖版本。',audience:null,...extra});
async function page(t,provider){
  const dom=new JSDOM(html,{url:'http://githok.test',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  t.after(()=>w.close());Object.assign(w,i18n,session,briefs);w.createBriefController=options=>briefs.createBriefController({...options,delay:0});
  w.localStorage.setItem('githok:language','zh');let briefCalls=0,feedCalls=0;
  w.fetch=async url=>{
    if(url.startsWith('/api/brief/')){briefCalls++;const repo=repos.find(r=>url.endsWith(r.name));return provider?provider(repo):Response.json(output(repo));}
    if(url.startsWith('/api/readme/'))return Response.json({text:'# Original README\n> [!NOTE]\n> Quote &mdash; text <script>window.compromised=true</script>\n原作者的文字不变。'});
    feedCalls++;return Response.json({items:repos,hasMore:false,source:'github',fetchedAt:new Date().toISOString()});
  };
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.eval(script);await until(()=>briefCalls>0);await sleep(5);
  return{w,$:s=>w.document.querySelector(s),briefCalls:()=>briefCalls,feedCalls:()=>feedCalls};
}
test('Chinese overview, translated introduction and author text switch without another request',async t=>{
  const p=await page(t);await until(()=>!p.$('.brief-controls').hidden);assert.equal(p.$('.repo-description').textContent,'检查项目依赖版本。');assert.match(p.$('.brief-proof').textContent,/依据作者简介/);
  p.$('[data-brief-mode="translation"]').click();assert.equal(p.$('.repo-description').textContent,'用于检查公开项目依赖版本的工具。');
  p.$('[data-brief-mode="original"]').click();assert.equal(p.$('.repo-description').textContent,repos[0].description);
  p.$('[data-brief-mode="summary"]').click();assert.equal(p.briefCalls(),1);const feeds=p.feedCalls();
  p.$('#language-toggle').click();assert.equal(p.$('.repo-description').textContent,repos[0].description);assert.equal(p.$('.brief-controls').hidden,true);
  p.$('#language-toggle').click();await sleep(5);assert.equal(p.$('.repo-description').textContent,'检查项目依赖版本。');assert.equal(p.briefCalls(),1);assert.equal(p.feedCalls(),feeds);
  p.$('#readme-button').click();await sleep(5);assert.match(p.$('#readme-content').textContent,/原作者的文字不变/);assert.match(p.$('#readme-content blockquote').textContent,/Quote — text/);assert.doesNotMatch(p.$('#readme-content').textContent,/\[!NOTE\]|&mdash;/);assert.equal(p.$('#readme-content script'),null);assert.equal(p.w.compromised,undefined);
});
test('late first-project response does not display its summary on the next project',async t=>{
  let finish;const p=await page(t,repo=>repo.id===1?new Promise(resolve=>{finish=()=>resolve(Response.json(output(repo,{summary:'第一个项目的速览。'})));}):Response.json(output(repo,{summary:'第二个项目的速览。'})));
  p.$('#next-button').click();assert.equal(p.$('.project-title').textContent,'project-2');assert.equal(p.$('.repo-description').textContent,repos[1].description);assert.match(p.$('.brief-status').textContent,/正在生成/);
  finish();await sleep(20);assert.equal(p.$('.project-title').textContent,'project-2');assert.equal(p.$('.repo-description').textContent,'第二个项目的速览。');assert.equal(p.briefCalls(),2);
});
test('generated markup remains literal text and cannot create executable elements',async t=>{
  const text='中文 <img src=x onerror="window.compromised=true"> <script>window.compromised=true</script>';
  const p=await page(t,repo=>Response.json(output(repo,{summary:text,translation:text})));
  await until(()=>!p.$('.brief-controls').hidden);
  assert.equal(p.$('.repo-description').textContent,text);assert.equal(p.$('.project-intro img'),null);assert.equal(p.$('.project-intro script'),null);assert.equal(p.w.compromised,undefined);
  p.$('[data-brief-mode="translation"]').click();assert.equal(p.$('.repo-description').textContent,text);
});
test('generation failure preserves the original with a manual retry rather than a loop',async t=>{
  const p=await page(t,()=>Response.json({code:'BRIEF_FAILED'},{status:502}));assert.equal(p.$('.repo-description').textContent,repos[0].description);assert.equal(p.$('.brief-retry').hidden,false);assert.equal(p.$('.brief-controls').hidden,true);
  await sleep(25);assert.equal(p.briefCalls(),1);p.$('.brief-retry').click();await sleep(15);assert.equal(p.briefCalls(),2);assert.equal(p.$('.repo-description').textContent,repos[0].description);
});
