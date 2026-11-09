import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import * as i18n from '../public/i18n.js';

const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const script=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/,'');
const repos=[1,2].map(id=>({id,name:'project-'+id,owner:'author',topics:['tools'],description:'Original author description '+id,stars:1234,forks:20,language:'TypeScript',license:'MIT',pushedAt:'2026-11-09T00:00:00Z',defaultBranch:'main'}));
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
async function page(t,{savedLanguage='en',browserLanguages=['zh-CN'],fail=false}={}){
  const dom=new JSDOM(html,{url:'http://githok.test/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;t.after(()=>w.close());
  Object.assign(w,i18n);
  Object.defineProperty(w.navigator,'languages',{value:browserLanguages});
  if(savedLanguage)w.localStorage.setItem('githok:language',savedLanguage);
  // These tests exercise our DOM state and translations, not native dialog behavior or layout.
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
  let calls=0;
  w.fetch=async url=>{
    calls++;
    if(fail)return{ok:false,json:async()=>({error:'GitHub 请求额度暂时用完了，稍后会恢复。'})};
    if(String(url).startsWith('/api/readme/'))return{ok:true,json:async()=>({text:'# Original README\n原作者内容保持不变。',truncated:true})};
    return{ok:true,json:async()=>({items:repos,page:1,hasMore:false,fetchedAt:'2026-11-09T00:00:00Z',source:'github'})};
  };
  w.eval(script);await flush();
  return{w,$:id=>w.document.getElementById(id),calls:()=>calls};
}
test('switching language preserves the current project, search draft and saved items without refetching',async t=>{
  const p=await page(t);assert.equal(p.w.document.documentElement.lang,'en-US');
  p.$('next-button').click();p.$('save-button').click();p.$('search').value='unsent search draft';
  const before=p.calls(),project=p.w.document.querySelector('.poster-title').textContent;
  p.$('language-toggle').click();
  assert.equal(p.w.document.documentElement.lang,'zh-CN');assert.equal(p.$('search').value,'unsent search draft');
  assert.equal(p.w.document.querySelector('.poster-title').textContent,project);assert.equal(p.$('saved-count').textContent,'1');assert.equal(p.calls(),before);
  assert.equal(p.w.localStorage.getItem('githok:language'),'zh');assert.match(p.$('toast').textContent,/收入收藏/);
  p.w.document.querySelector('[data-view="saved"]').click();assert.match(p.$('view-title').textContent,/灵感/);
  p.$('language-toggle').click();assert.equal(p.$('view-title').textContent,'Ideas worth saving.');assert.equal(p.w.document.querySelector('.poster-title').textContent,project);
});
test('stored language is reapplied on a new page and help text is localized',async t=>{
  const p=await page(t,{savedLanguage:'en',browserLanguages:['zh-TW']});
  assert.equal(p.$('language-label').textContent,'中文');assert.equal(p.$('search').getAttribute('aria-label'),'Search GitHub projects');
  p.$('help-button').click();assert.match(p.$('info-title').textContent,/swipe/);assert.match(p.$('info-content').textContent,/Save \/ unsave/);
});
test('backend errors and empty saved pages change language along with the rest of the interface',async t=>{
  const p=await page(t,{fail:true});assert.match(p.$('feed-host').textContent,/temporarily limiting requests/);
  p.$('language-toggle').click();assert.match(p.$('feed-host').textContent,/暂时限制/);
  p.w.document.querySelector('[data-view="saved"]').click();assert.match(p.$('feed-host').textContent,/先收藏/);
  p.$('language-toggle').click();assert.match(p.$('feed-host').textContent,/Save a little inspiration/);
});
test('README chrome is bilingual while the author’s content stays intact',async t=>{
  const p=await page(t);p.$('readme-button').click();await flush();
  assert.match(p.$('readme-content').textContent,/原作者内容保持不变/);assert.match(p.$('readme-content').textContent,/first 24,000 characters/);
  p.$('language-toggle').click();assert.match(p.$('readme-content').textContent,/前 24,000 字符/);assert.match(p.$('readme-content').textContent,/原作者内容保持不变/);
});
