import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { messages, chooseLanguage, translate, relativeUpdate, localizedError } from '../public/i18n.js';

test('both languages cover the same complete set of nonempty interface messages',()=>{
  assert.deepEqual(Object.keys(messages.zh).sort(),Object.keys(messages.en).sort());
  for(const dict of Object.values(messages))for(const [key,value] of Object.entries(dict)){assert.equal(typeof value,'string',key);assert.ok(value.trim(),key);}
});
test('static labels and literal runtime translation keys all have translations',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const keys=[...html.matchAll(/data-i18n(?:-html|-aria|-title)?="([^"]+)"/g),...app.matchAll(/\bt\('([^']+)'/g)].map(x=>x[1]);
  for(const key of keys)assert.ok(Object.hasOwn(messages.en,key),key);
});
test('a saved language takes priority over browser preferences and unknown values fall back safely',()=>{
  assert.equal(chooseLanguage('en',['zh-CN']),'en');assert.equal(chooseLanguage('zh',['en-US']),'zh');
  assert.equal(chooseLanguage(null,['fr-FR','zh-TW']),'zh');assert.equal(chooseLanguage('unsupported',['en-GB']),'en');
  assert.equal(chooseLanguage(null,['fr-FR']),'en');assert.equal(chooseLanguage(null,[]),'en');
});
test('dates, fallback errors and interpolated messages follow the selected language',()=>{
  const now=Date.parse('2026-11-09T12:00:00Z');
  assert.equal(relativeUpdate('2026-11-09T00:00:00Z','en',now),'Updated today');
  assert.equal(relativeUpdate('2026-11-08T00:00:00Z','zh',now),'昨天更新');
  assert.equal(relativeUpdate('invalid','en',now),'Update time unknown');
  assert.match(relativeUpdate('2026-10-08T00:00:00Z','en',now),/1 month ago/);
  assert.equal(translate('en','searchResults',{query:'vite'}),'Results for “vite”');
  assert.equal(localizedError('GitHub 请求额度暂时用完了，稍后会恢复。','en'),messages.en.rateLimited);
  assert.equal(localizedError('unexpected private implementation error','en'),messages.en.networkError);
});
