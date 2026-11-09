import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const hosting=JSON.parse(await readFile(resolve(root,'.openai/hosting.json'),'utf8'));
if(!hosting.project_id || hosting.static)throw new Error('Worker hosting requires a project_id and no static directory.');
const files={ 'index.html':'text/html; charset=utf-8','app.js':'text/javascript; charset=utf-8','i18n.js':'text/javascript; charset=utf-8','style.css':'text/css; charset=utf-8','favicon.svg':'image/svg+xml','manifest.webmanifest':'application/manifest+json' };
const assets={};
for(const [name,type] of Object.entries(files))assets['/'+name]={type,body:await readFile(resolve(root,'public',name),'utf8')};
let seed=null;
try { seed=JSON.parse(await readFile(resolve(root,'cloud/public-feed-snapshot.json'),'utf8')); } catch {}
await mkdir(resolve(root,'dist/server'),{recursive:true});
await mkdir(resolve(root,'dist/.openai'),{recursive:true});
await build({ entryPoints:[resolve(root,'cloud/worker.mjs')], outfile:resolve(root,'dist/server/index.js'), bundle:true, format:'esm', platform:'browser', target:'es2022', define:{ __GITHOK_ASSETS__:JSON.stringify(assets), __GITHOK_SEED__:JSON.stringify(seed) }, minify:true });
await writeFile(resolve(root,'dist/.openai/hosting.json'),JSON.stringify(hosting,null,2)+'\n');
const module=await import('file:///'+resolve(root,'dist/server/index.js').replaceAll('\\','/'));
if(typeof module.default?.fetch!=='function')throw new Error('Worker has no default fetch handler.');
const response=await module.default.fetch(new Request('https://test.invalid/'));
if(response.status!==200 || !(await response.text()).includes('GitHok'))throw new Error('Built Worker cannot serve the application.');
console.log('Built and checked dist/server/index.js with all frontend assets embedded.');
