const paths = {
  compass:'<circle cx="12" cy="12" r="9"/><path d="m16 8-2.4 5.6L8 16l2.4-5.6Z"/>',
  bookmark:'<path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4Z"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sparkles:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4M18 4h4"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  keyboard:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/>',
  github:'<path d="M9 19c-4.5 1.4-4.5-2.5-6.5-3m13 6v-3.9a3.4 3.4 0 0 0-.9-2.7c3.1-.4 6.4-1.5 6.4-7a5.5 5.5 0 0 0-1.5-3.8A5.1 5.1 0 0 0 19.4 1S18.2.6 15.5 2.5a13 13 0 0 0-7 0C5.8.6 4.6 1 4.6 1a5.1 5.1 0 0 0-.1 3.6A5.5 5.5 0 0 0 3 8.4c0 5.5 3.3 6.6 6.4 7a3.4 3.4 0 0 0-.9 2.7V22"/>',
  'arrow-up-right':'<path d="M6 18 18 6M6 6h12v12"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  x:'<path d="m6 6 12 12M6 18 18 6"/>',
  'file-text':'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M8 13h8M8 17h6"/>',
  link:'<path d="m10 13 4-2M8 16H6a4 4 0 0 1 0-8h4m4 0h4a4 4 0 0 1 0 8h-4"/>',
  'chevron-up':'<path d="m6 14 6-6 6 6"/>',
  'chevron-down':'<path d="m6 10 6 6 6-6"/>',
  mouse:'<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 6v4"/>',
  star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9Z"/>',
  fork:'<circle cx="6" cy="4" r="2"/><circle cx="18" cy="4" r="2"/><circle cx="12" cy="20" r="2"/><path d="M6 6v3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V6M12 12v6"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  refresh:'<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M18 18A8 8 0 0 1 5 15"/>',
  layers:'<path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
};
function icon(name) { return `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24">${paths[name] || paths.compass}</svg>`; }
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const repoValid = r => r && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(r.owner) && /^[A-Za-z0-9_.-]{1,100}$/.test(r.name) && Number.isFinite(r.id) && Array.isArray(r.topics);
let storageWorks = true;
function loadLocal(key) { try { const value = JSON.parse(localStorage.getItem('githok:' + key) || '[]'); return Array.isArray(value) ? value.filter(repoValid).slice(0, 300) : []; } catch { storageWorks = false; return []; } }
function saveLocal(key, data) { try { localStorage.setItem('githok:' + key, JSON.stringify(data)); return true; } catch { storageWorks = false; return false; } }
const state = { view:'discover', topic:'all', mode:'popular', query:'', localQuery:'', feed:[], saved:loadLocal('saved'), history:loadLocal('history'), indexes:{discover:0,saved:0,history:0}, page:0, hasMore:false, loading:false, appending:false, error:null, meta:null, generation:0 };
let requestController, readmeController, toastTimer, wheelAt=0, lastRecorded=null;

function repoURL(r) { return `https://github.com/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`; }
function formatNumber(n) { return new Intl.NumberFormat('en', {notation:'compact', maximumFractionDigits:1}).format(Number(n) || 0); }
function when(date) { const n = new Date(date).getTime(); if (!Number.isFinite(n)) return '时间未知'; const days=Math.max(0,Math.floor((Date.now()-n)/86_400_000)); return days===0?'今天更新':days===1?'昨天更新':days<30?`${days} 天前更新`:days<365?`${Math.floor(days/30)} 个月前更新`:`${Math.floor(days/365)} 年前更新`; }
function currentItems() { if (state.view==='discover') return state.feed; const items=state[state.view]; const q=state.localQuery.toLocaleLowerCase(); return q?items.filter(r=>[r.name,r.owner,r.description,...r.topics].join(' ').toLocaleLowerCase().includes(q)):items; }
function current() { return currentItems()[state.indexes[state.view]]; }
function toast(message) { clearTimeout(toastTimer); $('toast').textContent=message; $('toast').hidden=false; toastTimer=setTimeout(()=>$('toast').hidden=true,3200); }
function saved(r) { return state.saved.some(x=>x.id===r.id); }
function recordHistory(r) { if (state.view==='history' || lastRecorded===r.id) return; lastRecorded=r.id; state.history=[r,...state.history.filter(x=>x.id!==r.id)].slice(0,200); saveLocal('history',state.history); }

function renderCard(r) {
  const palette=['green','purple','blue','peach'][Math.abs(r.id)%4];
  const language=String(r.language||'').toLowerCase();
  const mark=language==='python'?'Py':language==='typescript'?'TS':language==='javascript'?'JS':language==='rust'?'{}':language==='go'?'Go':'〈/〉';
  const topics=r.topics.slice(0,4);
  const avatar=/^https:\/\/avatars\.githubusercontent\.com\//.test(r.avatar||'')?r.avatar:'/favicon.svg';
  const nameLength=r.name.length>24?' long-title':'';
  const label=state.view==='saved'?'我的收藏':state.view==='history'?'浏览足迹':state.query?'搜索发现':state.mode==='new'?'新鲜出炉':state.mode==='gems'?'小众宝藏':'开源精选';
  $('feed-host').innerHTML=`<article class="project-card palette-${palette}">
    <div class="project-poster"><div class="poster-grid"></div><div class="poster-stamp">OPEN SOURCE / ${String(state.indexes[state.view]+1).padStart(2,'0')}</div>
      <div class="poster-copy"><div class="poster-kicker">${esc(r.owner)}</div><h2 class="poster-title${nameLength}">${esc(r.name)}</h2><div class="poster-topics">${esc(topics.slice(0,3).map(t=>'#'+t).join('  ')) || 'Ideas worth exploring.'}</div></div>
      <div class="poster-art" aria-hidden="true"><div class="art-back"></div><div class="art-mid"></div><div class="art-front">${esc(mark)}</div><div class="art-dot">${icon('sparkles')}</div></div><div class="poster-mark">A LITTLE DISCOVERY. A LOT OF POSSIBILITY.</div>
    </div>
    <div class="card-content"><div class="repo-identity"><img class="owner-avatar" src="${esc(avatar)}" alt="" width="29" height="29"><span class="repo-owner">${esc(r.owner)} <span>/</span> <strong>${esc(r.name)}</strong></span><span class="repo-label">${label}</span></div>
    <p class="repo-description" title="${esc(r.description)}">${esc(r.description)}</p><div class="repo-tags">${topics.map(t=>`<span>${esc(t)}</span>`).join('')}</div>
    <div class="repo-bottom"><div class="repo-stats"><span class="stat star-stat" title="${esc(r.stars)} 个 GitHub 星标">${icon('star')}${formatNumber(r.stars)}</span><span class="stat fork-stat" title="${esc(r.forks)} 个 Fork">${icon('fork')}${formatNumber(r.forks)}</span><span class="stat"><i class="lang-dot ${['python','javascript','typescript','rust','go'].includes(language)?'lang-'+language:''}"></i>${esc(r.language)}</span></div><a class="open-repo" href="${repoURL(r)}" target="_blank" rel="noopener noreferrer">去 GitHub 看看 ${icon('arrow-up-right')}</a></div>
    <div class="repo-meta"><span>${esc(r.license)}</span><span class="separator"></span><span>${when(r.pushedAt)}</span><span class="separator"></span><span>作者原始介绍</span></div></div>
  </article>`;
  $('feed-host').querySelector('.owner-avatar').addEventListener('error',e=>{ e.target.src='/favicon.svg'; },{once:true});
  updateActions(r); recordHistory(r);
}
function updateActions(r) {
  const isSaved=saved(r);
  $('save-button').setAttribute('aria-pressed',String(isSaved));
  $('save-button').setAttribute('aria-label',isSaved?'取消收藏项目':'收藏项目');
  $('save-label').textContent=isSaved?'已收藏':'收藏';
  $('prev-button').disabled=state.indexes[state.view]===0;
  $('next-button').disabled=state.appending || (state.indexes[state.view]>=currentItems().length-1 && !(state.view==='discover'&&state.hasMore));
}
function empty(title,message,buttonLabel='重新加载',action='reload',symbol='compass') {
  $('feed-host').innerHTML=`<div class="empty-card">${icon(symbol)}<h2>${esc(title)}</h2><p>${esc(message)}</p><button class="primary-button" id="empty-action">${esc(buttonLabel)}</button></div>`;
  $('empty-action').addEventListener('click',()=>{
    if(action==='discover')return switchView('discover');
    if(action==='clear'){state.query='';state.topic='all';state.mode='popular';$('search').value='';syncControls();}
    loadFeed();
  });
}
function render() {
  $('saved-count').textContent=state.saved.length;
  $('action-rail').hidden=true; $('feed-position').textContent=''; $('source-note').classList.remove('warning');
  if (state.loading && state.view==='discover') {
    $('feed-host').innerHTML='<div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div><p>正在开源世界里捞好东西…</p></div>';
    $('source-note').textContent='正在读取 GitHub 公开项目…'; return;
  }
  if (state.error && state.view==='discover') {
    const retry=state.error.retryAt?` 可重试时间：${new Date(state.error.retryAt).toLocaleTimeString('zh-CN')}`:'';
    empty('这次没连上开源世界',state.error.message+retry,'再试一次','reload','refresh');
    $('source-note').textContent='你也可以先去「我的收藏」继续探索。'; return;
  }
  const items=currentItems();
  state.indexes[state.view]=Math.max(0,Math.min(state.indexes[state.view],items.length-1));
  if (!items.length) {
    if (state.view==='saved') empty(state.localQuery?'收藏里暂时没找到':'先收藏一点好东西','发现喜欢的项目时，点一下右侧书签。你的灵感仓库就从这里开始。','去发现项目','discover','bookmark');
    else if (state.view==='history') empty(state.localQuery?'足迹里暂时没找到':'还没有留下足迹','看过的项目会出现在这里，下次想起来，还找得到。','去发现项目','discover','clock');
    else empty('换个方向，也许有惊喜','当前条件没有找到项目。试试更短的关键词或其他分类。','清空筛选','clear','search');
    $('source-note').textContent=''; return;
  }
  const r=current(); renderCard(r); $('action-rail').hidden=false;
  $('feed-position').textContent=`${String(state.indexes[state.view]+1).padStart(2,'0')} / ${String(items.length).padStart(2,'0')}${state.view==='discover'&&state.hasMore?' +':''}${state.appending?' · 正在加载…':''}`;
  if (state.view==='discover' && state.meta) {
    const rules=state.query?'关键词匹配 · 不限星标':state.mode==='new'?'近 90 天创建 · 星标 >10':state.mode==='gems'?'50–5,000 星标 · 近半年活跃':'星标 >1,000 · 近半年活跃';
    const time=new Date(state.meta.fetchedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
    $('source-note').textContent=`${rules} · ${state.query?'按 GitHub 相关度排序':'按星标数排序'} · ${time} ${state.meta.stale?'的历史缓存':state.meta.source==='cache'?'缓存数据':'获取自 GitHub'}${state.meta.incomplete?' · GitHub 返回部分搜索结果':''}${state.meta.stale?' · '+state.meta.warning:''}`;
    $('source-note').classList.toggle('warning',!!state.meta.stale);
  } else $('source-note').textContent=state.view==='saved'?'收藏仅保存在此浏览器，不会修改你的 GitHub 星标。':'最近 200 个浏览项目，保存在此浏览器。';
}
function syncControls() {
  document.querySelectorAll('[data-topic]').forEach(b=>{const active=b.dataset.topic===state.topic;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  document.querySelectorAll('[data-mode]').forEach(b=>{const active=b.dataset.mode===state.mode;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  $('clear-search').hidden=!$('search').value;
  $('mode-tabs').hidden=!!state.query;
  $('search-caption').hidden=!state.query;
  $('search-caption').textContent=`“${state.query}” 的搜索结果`;
}
async function getFeed(page,signal) {
  const params=new URLSearchParams({topic:state.topic,mode:state.mode,q:state.query,page:String(page)});
  const response=await fetch('/api/feed?'+params,{signal});
  const data=await response.json();
  if(!response.ok) throw Object.assign(new Error(data.error||'数据暂时无法加载。'),{retryAt:data.retryAt});
  return data;
}
async function loadFeed() {
  requestController?.abort(); requestController=new AbortController(); const generation=++state.generation;
  state.loading=true; state.error=null; state.appending=false; state.indexes.discover=0; render();
  try {
    const data=await getFeed(1,requestController.signal);
    if(generation!==state.generation)return;
    state.feed=data.items.filter(repoValid);state.meta=data;state.page=1;state.hasMore=data.hasMore;
  } catch(e) {if(e.name!=='AbortError'&&generation===state.generation)state.error={message:e.message,retryAt:e.retryAt};}
  finally{if(generation===state.generation){state.loading=false;render();}}
}
async function appendFeed() {
  if(state.appending||!state.hasMore)return false;
  const generation=state.generation;state.appending=true;updateActions(current());
  try {
    const data=await getFeed(state.page+1,requestController?.signal);
    if(generation!==state.generation)return false;
    const ids=new Set(state.feed.map(r=>r.id));
    state.feed.push(...data.items.filter(repoValid).filter(r=>!ids.has(r.id)));
    state.page=data.page;state.hasMore=data.hasMore;state.meta=data;return true;
  }catch(e){if(e.name!=='AbortError')toast(e.message+(e.retryAt?` ${new Date(e.retryAt).toLocaleTimeString('zh-CN')} 后再试。`:''));return false;}
  finally{if(generation===state.generation){state.appending=false;render();}}
}
async function move(delta) {
  if((state.loading&&state.view==='discover')||state.appending||!current())return;
  const view=state.view;const generation=state.generation;
  let next=state.indexes[view]+delta;
  if(next<0)return;
  if(next>=currentItems().length&&view==='discover'&&state.hasMore)await appendFeed();
  if(view!==state.view||generation!==state.generation)return;
  if(next<currentItems().length){state.indexes[view]=next;render();}
}
function switchView(view) {
  if(state.view===view)return;
  state.view=view;state.localQuery='';
  document.querySelectorAll('[data-view]').forEach(b=>{const active=b.dataset.view===view;b.classList.toggle('active',active);active?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current');});
  const copy={discover:['为你发现','好项目，<span>划着看。</span>','少一点大海捞针，多一点不期而遇。'],saved:['我的收藏','灵感，<span>先存起来。</span>','每一个收藏，都是一个「我想试试」。'],history:['浏览足迹','那些项目，<span>还在这里。</span>','不小心划走的灵感，也能回头找到。']}[view];
  $('breadcrumb-view').textContent=copy[0];$('view-title').innerHTML=copy[1];$('view-description').textContent=copy[2];
  $('discovery-controls').hidden=view!=='discover';$('search').value=view==='discover'?state.query:'';$('search').placeholder=view==='discover'?'搜点感兴趣的…':'搜索'+copy[0]+'…';$('search').setAttribute('aria-label',view==='discover'?'搜索 GitHub 项目':'搜索'+copy[0]);syncControls();render();
}
function toggleSave() {
  const r=current();if(!r)return;
  const had=saved(r);
  if(!had&&state.saved.length>=300){toast('已经收藏了 300 个项目，请先整理一些收藏。');return;}
  state.saved=had?state.saved.filter(x=>x.id!==r.id):[r,...state.saved];
  const persisted=saveLocal('saved',state.saved);render();toast(persisted?(had?'已取消收藏':'灵感 +1，已收入收藏'):had?'本次已取消收藏；浏览器无法保存更改。':'已临时收藏；浏览器存储不可用，关闭后可能丢失。');
}
async function share() {
  const r=current();if(!r)return;
  try{await navigator.clipboard.writeText(repoURL(r));toast('项目链接已复制，分享这份发现。');}
  catch{showInfo('项目链接',`<p>长按或选中下方链接即可复制：</p><p><a href="${repoURL(r)}" target="_blank" rel="noopener noreferrer">${esc(repoURL(r))}</a></p>`);}
}

function appendInline(parent,text,base) {
  const re=/\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g;let last=0;let match;
  const plain=s=>s.replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/<[^>]*>/g,'').replace(/\*\*|__|`/g,'');
  while((match=re.exec(text))){parent.append(document.createTextNode(plain(text.slice(last,match.index))));
    try{const url=new URL(match[2],base);if(!['https:','http:'].includes(url.protocol))throw Error();const a=document.createElement('a');a.textContent=match[1];a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';parent.append(a);}catch{parent.append(document.createTextNode(match[1]));}last=re.lastIndex;
  }parent.append(document.createTextNode(plain(text.slice(last))));
}
function renderMarkdown(text,repo) {
  const target=$('readme-content');target.replaceChildren();const base=repoURL(repo)+'/blob/'+encodeURIComponent(repo.defaultBranch||'main')+'/';
  let code=null,paragraph=[],list=null;
  function flush(){if(paragraph.length){const p=document.createElement('p');appendInline(p,paragraph.join('\n'),base);target.append(p);paragraph=[];}list=null;}
  for(const line of text.replaceAll('\r','').split('\n')){
    if(/^\s*```/.test(line)){flush();if(code){const pre=document.createElement('pre');pre.textContent=code.join('\n');target.append(pre);code=null;}else code=[];continue;}
    if(code){code.push(line);continue;}
    if(/^\s*</.test(line)||/^\s*!\[.*\]\(/.test(line)||/^\s*\[!\[/.test(line))continue;
    if(!line.trim()){flush();continue;}
    const heading=line.match(/^(#{1,4})\s+(.+)$/);if(heading){flush();const h=document.createElement('h'+Math.min(heading[1].length,3));appendInline(h,heading[2],base);target.append(h);continue;}
    const li=line.match(/^\s*(?:[-*+] |\d+\. )(.+)$/);if(li){if(paragraph.length)flush();if(!list){list=document.createElement('ul');target.append(list);}const item=document.createElement('li');appendInline(item,li[1],base);list.append(item);continue;}
    paragraph.push(line);
  }flush();if(code){const pre=document.createElement('pre');pre.textContent=code.join('\n');target.append(pre);}
  const note=document.createElement('p');note.className='readme-note';note.textContent='文字预览 · 图片与完整排版请查看 GitHub 原文。';target.append(note);
}
async function openDetail() {
  const r=current();if(!r)return;
  readmeController?.abort();readmeController=new AbortController();
  $('detail-title').textContent=r.owner+' / '+r.name;
  $('detail-meta').innerHTML=`<p class="detail-description">${esc(r.description)}</p><div class="detail-stats"><span>★ ${Number(r.stars).toLocaleString()} 星标</span><span>${esc(r.language)}</span><span>${esc(r.license)}</span><span>${when(r.pushedAt)}</span></div><div class="detail-links"><a class="primary-button" href="${repoURL(r)}" target="_blank" rel="noopener noreferrer">打开 GitHub ${icon('arrow-up-right')}</a>${r.homepage&&/^https?:\/\//i.test(r.homepage)?`<a class="secondary-button" href="${esc(r.homepage)}" target="_blank" rel="noopener noreferrer">项目网站 ↗</a>`:''}</div>`;
  $('original-readme').href=repoURL(r)+'#readme';$('readme-content').innerHTML='<p class="dialog-loading">正在读取原作者 README…</p>';
  $('detail-dialog').showModal();$('detail-dialog').scrollTop=0;
  try{
    const response=await fetch(`/api/readme/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`,{signal:readmeController.signal});const data=await response.json();
    if(!response.ok)throw new Error(data.error||'README 暂时无法读取。');renderMarkdown(data.text,r);
    if(data.truncated){const note=document.createElement('p');note.className='readme-note';note.textContent='README 较长，此处展示前 24,000 字符。';$('readme-content').append(note);}
    if(data.stale){const note=document.createElement('p');note.className='readme-note';note.textContent='当前为历史缓存：'+new Date(data.fetchedAt).toLocaleString('zh-CN');$('readme-content').prepend(note);}
  }catch(e){if(e.name!=='AbortError')$('readme-content').textContent=e.message+' 你仍然可以打开 GitHub 原文。';}
}
function showInfo(title,html){$('info-title').textContent=title;$('info-content').innerHTML=html;$('info-dialog').showModal();}
function showHelp(){showInfo('划起来，就这么简单。','<p>一次认识一个开源项目。看到喜欢的，收藏起来；想深入了解，打开 README 或原仓库。</p><div class="shortcut-row"><span>下一个项目</span><span><kbd>↓</kbd> <kbd>J</kbd> <kbd>空格</kbd></span></div><div class="shortcut-row"><span>上一个项目</span><span><kbd>↑</kbd> <kbd>K</kbd></span></div><div class="shortcut-row"><span>收藏 / 取消收藏</span><kbd>B</kbd></div><div class="shortcut-row"><span>查看 README</span><kbd>R</kbd></div><div class="shortcut-row"><span>搜索</span><kbd>/</kbd></div><p>也支持鼠标滚轮和手机上下滑动。所有收藏和足迹都保存在当前浏览器。</p>');}

document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
document.querySelectorAll('[data-topic]').forEach(b=>b.addEventListener('click',()=>{if(state.topic===b.dataset.topic)return;state.topic=b.dataset.topic;syncControls();loadFeed();}));
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{if(state.mode===b.dataset.mode)return;state.mode=b.dataset.mode;syncControls();loadFeed();}));
$('search-form').addEventListener('submit',e=>{e.preventDefault();if(state.view==='discover'){state.query=$('search').value.trim();loadFeed();}else{state.localQuery=$('search').value.trim();state.indexes[state.view]=0;render();}syncControls();});
$('search').addEventListener('input',()=>$('clear-search').hidden=!$('search').value);
$('clear-search').addEventListener('click',()=>{$('search').value='';$('search-form').requestSubmit();$('search').focus();});
$('save-button').addEventListener('click',toggleSave);$('share-button').addEventListener('click',share);$('readme-button').addEventListener('click',openDetail);
$('prev-button').addEventListener('click',()=>move(-1));$('next-button').addEventListener('click',()=>move(1));
$('help-button').addEventListener('click',showHelp);
$('about-button').addEventListener('click',()=>showInfo('GitHok · 让发现更轻松','<p>一个把 GitHub 变成灵感信息流的小应用。项目介绍、星标、语言、许可证和 README 均来自 GitHub 公开接口。</p><h3>推荐从哪里来？</h3><p>热门精选：近半年有更新、超过 1,000 星标；最近上新：近 90 天创建、超过 10 星标；小众宝藏：近半年有更新、50–5,000 星标。均按总星标数排序，不代表每日涨幅。兴趣分类匹配作者填写的 topic。</p><h3>你的数据</h3><p>收藏与浏览足迹保存在此浏览器，不会替你登录 GitHub 或添加星标。无 AI 翻译或自动生成的项目评测。</p><p>数据缓存 15 分钟；GitHub 暂时不可用时，会标明历史缓存时间。</p><p><a href="https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api" target="_blank" rel="noopener noreferrer">GitHub 数据与额度说明 ↗</a></p>'));
document.querySelectorAll('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
$('detail-dialog').addEventListener('close',()=>readmeController?.abort());
document.addEventListener('keydown',e=>{
  if(document.querySelector('dialog[open]')||e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,textarea,select,[contenteditable=true]'))return;
  const key=e.key.toLowerCase();
  if(['arrowdown','j',' '].includes(key)){e.preventDefault();if(!e.repeat)move(1);}
  else if(['arrowup','k'].includes(key)){e.preventDefault();if(!e.repeat)move(-1);}
  else if(key==='b'){e.preventDefault();if(!e.repeat)toggleSave();}
  else if(key==='r'){e.preventDefault();openDetail();}
  else if(key==='/'){e.preventDefault();$('search').focus();}
});
$('feed-layout').addEventListener('wheel',e=>{
  if(document.querySelector('dialog[open]')||e.ctrlKey||Math.abs(e.deltaY)<15||Math.abs(e.deltaX)>Math.abs(e.deltaY))return;
  e.preventDefault();if(Date.now()-wheelAt<650)return;wheelAt=Date.now();move(e.deltaY>0?1:-1);
},{passive:false});
let touchStart=null;
$('feed-host').addEventListener('touchstart',e=>{if(e.touches.length===1&&!e.target.closest('button,a'))touchStart={x:e.touches[0].clientX,y:e.touches[0].clientY};},{passive:true});
$('feed-host').addEventListener('touchend',e=>{if(!touchStart)return;const dx=e.changedTouches[0].clientX-touchStart.x,dy=e.changedTouches[0].clientY-touchStart.y;touchStart=null;if(Math.abs(dy)>65&&Math.abs(dy)>Math.abs(dx)*1.5)move(dy<0?1:-1);},{passive:true});
syncControls();loadFeed();
if(!storageWorks)toast('浏览器存储暂不可用，收藏可能只在本次打开期间保留。');
