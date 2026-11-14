import { chooseLanguage, translate, relativeUpdate, localizedError, locales } from './i18n.js';
import { readResume, writeResume } from './session.js';
import { createBriefController } from './briefs.js';

const paths = {
  'arrow-up':'<path d="M12 20V4m-6 6 6-6 6 6"/>',
  'arrow-down':'<path d="M12 4v16m-6-6 6 6 6-6"/>',
  share:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/>',
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18"/>',
  compass:'<circle cx="12" cy="12" r="9"/><path d="m16 8-2.4 5.6L8 16l2.4-5.6Z"/>',
  bookmark:'<path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4Z"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sparkles:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4M18 4h4"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.6 8.5a2.5 2.5 0 0 1 4.9.7c0 1.8-2.5 2.1-2.5 4M12 17h.01"/>',
  keyboard:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/>',
  github:'<path d="M9 19c-4.5 1.4-4.5-2.5-6.5-3m13 6v-3.9a3.4 3.4 0 0 0-.9-2.7c3.1-.4 6.4-1.5 6.4-7a5.5 5.5 0 0 0-1.5-3.8A5.1 5.1 0 0 0 19.4 1S18.2.6 15.5 2.5a13 13 0 0 0-7 0C5.8.6 4.6 1 4.6 1a5.1 5.1 0 0 0-.1 3.6A5.5 5.5 0 0 0 3 8.4c0 5.5 3.3 6.6 6.4 7a3.4 3.4 0 0 0-.9 2.7V22"/>',
  'arrow-up-right':'<path d="M6 18 18 6M6 6h12v12"/>',
  'arrow-right':'<path d="M4 12h16m-6-6 6 6-6 6"/>',
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
function storedLanguage(){try{return localStorage.getItem('githok:language');}catch{return null;}}
let language=chooseLanguage(storedLanguage(),navigator.languages||[navigator.language]);
const t=(key,values)=>translate(language,key,values);
const errorText=message=>localizedError(message,language);
const description=r=>!r.description||r.description==='作者暂未填写项目介绍，可以打开 README 了解更多。'?t('noDescription'):r.description;
const projectLanguage=r=>!r.language||r.language==='未标注'?t('unspecified'):r.language;
const projectLicense=r=>!r.license||r.license==='未标注许可证'?t('noLicense'):r.license;
function clock(date){const value=new Date(date);return Number.isFinite(value.getTime())?value.toLocaleTimeString(locales[language],{hour:'2-digit',minute:'2-digit'}):t('unknownTime');}
function loadLocal(key) { try { const value = JSON.parse(localStorage.getItem('githok:' + key) || '[]'); return Array.isArray(value) ? value.filter(repoValid).slice(0, 300) : []; } catch { storageWorks = false; return []; } }
function saveLocal(key, data) { try { localStorage.setItem('githok:' + key, JSON.stringify(data)); return true; } catch { storageWorks = false; return false; } }
const state = { view:'discover', collectionLayout:'list', topic:'all', mode:'popular', query:'', localQuery:'', feed:[], saved:loadLocal('saved'), history:loadLocal('history'), indexes:{discover:0,saved:0,history:0}, page:0, hasMore:false, loading:false, appending:false, error:null, meta:null, generation:0 };
const briefController=createBriefController({fetchImpl:(...args)=>fetch(...args),storage:localStorage,getCurrent:()=>state.view!=='discover'&&state.collectionLayout==='list'?null:current(),getLanguage:()=>language,onChange:paintBrief,isVisible:()=>!document.hidden,setTimer:setTimeout,clearTimer:clearTimeout});
Object.assign(state,{cursor:null,feedOffset:0,seen:new Set(),appendBlocked:false,retryAt:0});
Object.assign(state,{resumedAt:null,restoredIds:new Set(),resumePrefetchHold:false,progressUnavailable:false,appendError:null});
let resumeTimer,retryTimer,appendTask,requestController, readmeController, toastTimer, toastState=null, detailState=null, infoKind=null, wheelAt=0, lastRecorded=null;
let githubSession=null,githubSessionTask=null,githubEpoch=0;
const githubStars=new Map();
const githubKey=r=>r.owner.toLowerCase()+'/'+r.name.toLowerCase();

async function githubRequest(path,method='GET'){
  const response=await fetch('/api/github/'+path,{method,credentials:'same-origin',headers:method==='GET'?{}:{'X-GitHok-CSRF':githubSession?.csrf||''},signal:AbortSignal.timeout(15000)});
  const data=await response.json();
  if(!response.ok)throw Object.assign(new Error(data.code||'GITHUB_UNAVAILABLE'),{code:data.code,status:response.status});
  return data;
}
async function loadGithubSession(){
  const epoch=githubEpoch;
  if(!githubSessionTask)githubSessionTask=githubRequest('session').then(data=>{
    if(epoch===githubEpoch){
      if(githubSession?.user?.login&&githubSession.user.login!==data.user?.login){githubEpoch++;githubStars.clear();}
      githubSession=data;
    }
    return data;
  }).finally(()=>{githubSessionTask=null;});
  return githubSessionTask;
}
function paintGithub(){
  const r=current(),entry=r?githubStars.get(githubKey(r)):null,busy=!!entry?.busy,starred=entry?.starred===true;
  const button=$('github-star-button');
  button.setAttribute('aria-pressed',String(starred));button.setAttribute('aria-busy',String(busy));
  button.setAttribute('aria-label',t(busy?'githubStarBusy':starred?'githubStarred':'githubStar'));
  button.title=t('githubDoubleTap');button.disabled=busy;
  $('github-star-label').textContent=busy?'…':starred?'Starred':'Star';
  if($('github-dialog').open){
    $('github-account-status').textContent=t(githubSession?.authenticated?'githubConnected':githubSession?.configured===false?'githubNotConfigured':'githubSignInFirst',{login:githubSession?.user?.login||''});
    $('github-login').hidden=!!githubSession?.authenticated||githubSession?.configured===false;
    $('github-logout').hidden=!githubSession?.authenticated;
    $('github-permission-note').hidden=!!githubSession?.authenticated||githubSession?.configured===false;
  }
}
async function checkGithubStar(r){
  if(!githubSession?.authenticated||githubStars.has(githubKey(r)))return;
  const key=githubKey(r),epoch=githubEpoch,entry={checking:true};githubStars.set(key,entry);
  try{const data=await githubRequest('star/'+encodeURIComponent(r.owner)+'/'+encodeURIComponent(r.name));
    if(epoch===githubEpoch&&githubStars.get(key)===entry)githubStars.set(key,{starred:data.starred===true});
  }catch{if(githubStars.get(key)===entry)githubStars.delete(key);}
  if(epoch===githubEpoch)paintGithub();
}
async function showGithub(){
  $('github-dialog').showModal();$('github-account-status').textContent=t('githubChecking');
  $('github-login').hidden=true;$('github-logout').hidden=true;
  try{await loadGithubSession();paintGithub();}
  catch{$('github-account-status').textContent=t('githubUnavailable');}
}
function starBurst(stage,x,y){
  if(!stage?.isConnected||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  const box=stage.getBoundingClientRect(),burst=document.createElement('span');burst.className='star-burst';burst.setAttribute('aria-hidden','true');
  burst.style.left=Math.max(40,Math.min(box.width-40,x-box.left))+'px';burst.style.top=Math.max(40,Math.min(box.height-40,y-box.top))+'px';
  burst.innerHTML=icon('star')+'<i></i><i></i><i></i><i></i>';stage.querySelectorAll('.star-burst').forEach(el=>el.remove());stage.append(burst);
  setTimeout(()=>burst.remove(),950);
}
async function starOnGithub(point){
  const r=current(),stage=document.querySelector('.project-stage');if(!r||!stage)return;
  const key=githubKey(r);if(githubStars.get(key)?.busy)return;
  const epoch=githubEpoch;
  try{
    if(!githubSession?.authenticated)await loadGithubSession();
    if(epoch!==githubEpoch)return;
    if(githubStars.get(key)?.busy)return;
    if(!githubSession?.authenticated){await showGithub();return;}
    if(githubStars.get(key)?.starred){if(point)starBurst(stage,point.x,point.y);return;}
    const previous=githubStars.get(key);githubStars.set(key,{busy:true});paintGithub();
    let data;
    try{data=await githubRequest('star/'+encodeURIComponent(r.owner)+'/'+encodeURIComponent(r.name),'PUT');}
    catch(error){if(epoch===githubEpoch)previous?githubStars.set(key,previous):githubStars.delete(key);throw error;}
    if(epoch!==githubEpoch)return;
    if(data.starred!==true)throw new Error('STAR_FAILED');
    githubStars.set(key,{starred:true});paintGithub();$('github-star-status').textContent=t('githubStarSuccess',{name:r.owner+'/'+r.name});
    if(current()?.id===r.id&&stage.isConnected){const box=stage.getBoundingClientRect();starBurst(stage,point?.x??box.left+box.width/2,point?.y??box.top+box.height/2);}
    else toast('githubStarSuccess',{name:r.owner+'/'+r.name});
  }catch(error){
    if(epoch!==githubEpoch)return;
    if(error.status===401){githubSession=null;githubStars.clear();await showGithub();}
    else toast(error.code==='GITHUB_FORBIDDEN'?'githubForbidden':'githubStarFailed');
    if(githubStars.get(key)?.busy)githubStars.delete(key);paintGithub();
  }
}

function persistProgress(){
  clearTimeout(resumeTimer);
  if(state.loading||!state.feed.length)return;
  try{state.progressUnavailable=!writeResume(localStorage,{topic:state.topic,mode:state.mode,query:state.query,feed:state.feed,index:state.indexes.discover,offset:state.feedOffset,seen:[...state.seen],hasMore:state.hasMore,cursor:state.hasMore?state.cursor:null});}
  catch{state.progressUnavailable=true;}
  if(state.view==='discover'&&current())renderFeedStatus();
}
function scheduleProgress(){clearTimeout(resumeTimer);resumeTimer=setTimeout(persistProgress,350);}
function restoreProgress(){
  let checkpoint;try{checkpoint=readResume(localStorage);}catch{return false;}
  if(!checkpoint)return false;
  Object.assign(state,{topic:checkpoint.topic,mode:checkpoint.mode,query:checkpoint.query,feed:checkpoint.feed,feedOffset:checkpoint.offset,seen:new Set(checkpoint.seen),cursor:checkpoint.cursor,hasMore:checkpoint.hasMore,resumedAt:checkpoint.at,restoredIds:new Set(checkpoint.feed.map(r=>r.id)),resumePrefetchHold:true,meta:{source:'cache',fetchedAt:new Date(checkpoint.at).toISOString(),ordering:'created-windows'}});
  state.indexes.discover=checkpoint.index;$('search').value=state.query;return true;
}
function refreshFeedback(){
  const offline=navigator.onLine===false;
  const deadline=state.error?.retryAt||state.retryAt||0,seconds=Math.max(0,Math.ceil((deadline-Date.now())/1000));
  const show=state.view==='discover'&&state.feed.length>0&&(offline||state.appendBlocked);
  $('connection-status').hidden=!show;
  if(show){
    $('connection-message').textContent=offline?t('offlineLoaded'):seconds?t('pausedUntil',{time:clock(deadline)}):state.appendError?errorText(state.appendError):t('findingMore');
    $('retry-feed').hidden=!state.hasMore;
    $('retry-feed').disabled=offline||seconds>0||state.appending;
    $('retry-feed').textContent=t(state.appending?'loadingNext':seconds?'retryIn':'retryLoad',{seconds});
  }
  const emptyAction=$('empty-action');
  if(state.view==='discover'&&emptyAction&&((state.error&&emptyAction.dataset.action==='reload')||emptyAction.dataset.action==='continue')){
    emptyAction.disabled=seconds>0||offline;
    emptyAction.textContent=t(seconds?'retryIn':emptyAction.dataset.action==='continue'&&!state.appendError?'continueDiscover':'tryAgain',{seconds});
  }
  $('restart-feed').disabled=state.loading;
  if(seconds&&!retryTimer)retryTimer=setInterval(refreshFeedback,1000);
  if(!seconds&&retryTimer){clearInterval(retryTimer);retryTimer=null;}
}

function repoURL(r) { return `https://github.com/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`; }
function formatNumber(n) { return new Intl.NumberFormat(locales[language], {notation:'compact', maximumFractionDigits:1}).format(Number(n) || 0); }
function when(date) { return relativeUpdate(date,language); }
function currentItems() { if (state.view==='discover') return state.feed; const items=state[state.view]; const q=state.localQuery.toLocaleLowerCase(); return q?items.filter(r=>[r.name,r.owner,r.description,...r.topics].join(' ').toLocaleLowerCase().includes(q)):items; }
function current() { return currentItems()[state.indexes[state.view]]; }
function syncSwipeMode() {
  const host=$('feed-host');
  host.classList.toggle('swipe-ready',!!host.querySelector('.project-stage')&&host.scrollHeight<=host.clientHeight+2);
}
function renderToast(){if(!toastState)return;const {key,values}=toastState;$('toast').textContent=key==='requestError'?errorText(values.message)+(values.retryAt?' '+t('retryLater',{time:clock(values.retryAt)}):''):t(key,values);}
function toast(key,values={}) { clearTimeout(toastTimer); toastState={key,values};renderToast();$('toast').hidden=false;toastTimer=setTimeout(()=>{$('toast').hidden=true;toastState=null;},3200); }
function saved(r) { return state.saved.some(x=>x.id===r.id); }
function avatarURL(r) { return /^https:\/\/avatars\.githubusercontent\.com\//.test(r.avatar||'')?r.avatar:'/favicon.svg'; }
function installAvatarFallbacks() { document.querySelectorAll('.owner-avatar').forEach(img=>img.addEventListener('error',e=>{ e.target.src='/favicon.svg'; },{once:true})); }
function recordHistory(r) { if (state.view==='history' || lastRecorded===r.id) return; lastRecorded=r.id; state.history=[r,...state.history.filter(x=>x.id!==r.id)].slice(0,200); saveLocal('history',state.history); }

function paintBrief(){
  const r=current(),intro=document.querySelector('.project-intro');if(!r||!intro)return;
  const entry=briefController.peek(r),ready=entry.state==='ready',zh=language==='zh',mode=ready?entry.mode:'original';
  const controls=intro.querySelector('.brief-controls'),status=intro.querySelector('.brief-status'),proof=intro.querySelector('.brief-proof'),retry=intro.querySelector('.brief-retry');
  controls.hidden=!zh||!ready;proof.hidden=!zh||!ready;
  intro.querySelector('.repo-description').textContent=zh&&ready?(mode==='summary'?entry.data.summary:mode==='translation'?entry.data.translation:description(r)):description(r);
  intro.querySelectorAll('[data-brief-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.briefMode===mode)));
  proof.textContent=ready?t(entry.data.evidenceSource==='readme-excerpt'?'briefFromReadme':'briefFromDescription')+(mode==='summary'&&entry.data.audience?' · '+t('briefAudience',{audience:entry.data.audience}):''):'';
  const errors={BRIEF_NOT_CONFIGURED:'briefDisabled',BRIEF_INSUFFICIENT:'briefInsufficient',BRIEF_LIMIT:'briefLimit',BRIEF_CHANGED:'briefChanged',BRIEF_BUSY:'briefBusy',BRIEF_COOLDOWN:'briefCooldown'};
  status.hidden=!zh||ready;status.textContent=entry.state==='pending'?t('briefPreparing'):t(errors[entry.error]||(entry.state==='disabled'?'briefDisabled':'briefFailed'));
  retry.hidden=!zh||ready||entry.state==='pending';retry.disabled=entry.retryAt>Date.now();
  document.querySelector('.project-stage')?.classList.toggle('has-brief',zh);
  requestAnimationFrame(syncSwipeMode);
}
function renderProject(r) {
  const nameLength=r.name.length>40?' very-long-title':r.name.length>24?' long-title':'';
  const tail=r.name.match(/^(.*[-_.])([^-_.]+[-_.][^-_.]+)$/);
  const title=tail&&tail[2].length<=10?esc(tail[1])+'<wbr><span class="title-tail">'+esc(tail[2])+'</span>':esc(r.name);
  $('feed-host').innerHTML=`<article class="project-stage">
    <div class="stage-composition"><div class="project-copy"><div class="project-owner"><img class="owner-avatar" src="${esc(avatarURL(r))}" alt="" width="48" height="48"><span>${esc(r.owner)}</span></div><h2 class="project-title${nameLength}">${title}</h2><div class="project-intro"><div class="brief-controls" role="group" aria-label="${esc(t('briefViews'))}" hidden><button data-brief-mode="summary" aria-pressed="true">${t('briefSummary')}</button><button data-brief-mode="translation" aria-pressed="false">${t('briefTranslation')}</button><button data-brief-mode="original" aria-pressed="false">${t('briefOriginal')}</button></div><p class="repo-description">${esc(description(r))}</p><p class="brief-proof" hidden></p><p class="brief-status" role="status" hidden></p><button class="brief-retry" hidden>${t('briefRetry')}</button></div><div class="repo-tags">${r.topics.slice(0,4).map(topic=>`<span>#${esc(topic)}</span>`).join('')}</div></div><div class="project-art" aria-hidden="true"><img src="/art/silver-sculpture-v1.png" alt="" width="1024" height="1024" fetchpriority="high" decoding="async"></div></div>
    <div class="repo-bottom"><div class="repo-stats"><span class="stat" title="${esc(t('starCount',{count:r.stars}))}">${icon('star')}${formatNumber(r.stars)}</span><span class="stat project-language">${esc(projectLanguage(r))}</span></div><a class="open-repo" href="${repoURL(r)}" target="_blank" rel="noopener noreferrer">${t('openRepo')} ${icon('arrow-right')}</a></div>
  </article>`;
  $('feed-host').scrollTop=0;
  installAvatarFallbacks();
  $('feed-host').querySelectorAll('[data-brief-mode]').forEach(button=>button.addEventListener('click',()=>briefController.mode(r,button.dataset.briefMode)));
  $('feed-host').querySelector('.brief-retry').addEventListener('click',()=>briefController.select(r,{manual:true}));
  briefController.select(r);
  updateActions(r); recordHistory(r);
  checkGithubStar(r);
  if(state.view==='discover')scheduleProgress();
  if(state.view==='discover'&&state.hasMore&&!state.appendBlocked&&!state.resumePrefetchHold&&state.feed.length-state.indexes.discover<=6)queueMicrotask(()=>appendFeed());
}
function renderLibrary(items) {
  briefController.select(null);
  $('feed-host').innerHTML=`<div class="library-list">${items.map((r,index)=>`<button class="library-row" data-project-index="${index}" aria-label="${esc(t('inspectProject',{name:r.owner+'/'+r.name}))}"><span class="library-number">${String(index+1).padStart(2,'0')}</span><span class="library-main"><span class="library-owner">${esc(r.owner)}</span><span class="library-name">${esc(r.name)}</span><span class="library-description">${esc(description(r))}</span></span><span class="library-language">${esc(projectLanguage(r))}</span><span class="library-stars">${icon('star')}${formatNumber(r.stars)}</span><span class="library-arrow">${icon('arrow-up-right')}</span></button>`).join('')}</div>`;
  $('feed-host').querySelectorAll('[data-project-index]').forEach(button=>button.addEventListener('click',()=>{
    state.indexes[state.view]=Number(button.dataset.projectIndex);state.collectionLayout='stage';render();
    $('list-button').focus({preventScroll:true});
  }));
  installAvatarFallbacks();
}
function updateActions(r) {
  paintGithub();
  const isSaved=saved(r);
  $('save-button').setAttribute('aria-pressed',String(isSaved));
  $('save-button').setAttribute('aria-label',t(isSaved?'unsaveProject':'saveProject'));
  $('save-label').textContent=t(isSaved?'savedState':'save');
  $('prev-button').disabled=state.indexes[state.view]===0;
  $('next-button').disabled=state.indexes[state.view]>=currentItems().length-1 && (state.appending || !(state.view==='discover'&&state.hasMore));
}
function empty(title,message,buttonLabel=t('reload'),action='reload',symbol='compass') {
  $('feed-host').innerHTML=`<div class="empty-state">${icon(symbol)}<h2>${esc(title)}</h2><p>${esc(message)}</p><button class="primary-button" id="empty-action" data-action="${action}">${esc(buttonLabel)}</button></div>`;
  $('empty-action').addEventListener('click',()=>{
    if(action==='discover')return switchView('discover');
    if(action==='continue'){appendFeed({manual:true});return;}
    if(action==='clearLocal'){state.localQuery='';$('search').value='';syncControls();render();return;}
    if(action==='clear'){state.query='';state.topic='all';state.mode='popular';$('search').value='';syncControls();}
    loadFeed();
  });
  refreshFeedback();
}
function render() {
  briefController.pause();
  refreshFeedback();
  requestAnimationFrame(syncSwipeMode);
  const isCollection=state.view!=='discover', list=isCollection&&state.collectionLayout==='list';
  $('collection-toolbar').hidden=!isCollection;
  const count=currentItems().length;
  $('collection-count').textContent=t(count===1?'singleProjectCount':'projectCount',{count});
  $('list-button').setAttribute('aria-pressed',String(state.collectionLayout==='list'));
  $('stage-button').setAttribute('aria-pressed',String(state.collectionLayout==='stage'));
  $('feed-layout').classList.toggle('library-layout',list);
  document.body.classList.toggle('view-library',list);
  document.body.dataset.currentView=state.view;
  $('feed-footer').hidden=list;
  $('feed-host').setAttribute('aria-busy',String(state.loading&&state.view==='discover'));
  $('feed-progress').value=0;
  $('saved-count').textContent=state.saved.length;
  $('saved-count').dataset.empty=String(state.saved.length===0);
  $('feed-art').hidden=true;
  $('action-rail').hidden=true; $('feed-position').textContent=''; $('feed-state').textContent=''; $('source-note').classList.remove('warning');
  if (state.loading && state.view==='discover') {
    $('feed-host').innerHTML=`<div class="loading-state"><div class="loading-line"></div><div class="loading-line short"></div><p>${t('loadingFeed')}</p></div>`;
    $('source-note').textContent=t('readingGithub'); return;
  }
  if (state.error && state.view==='discover') {
    const retry=state.error.retryAt?t('retryTime',{time:clock(state.error.retryAt)}):'';
    empty(t('connectionTitle'),errorText(state.error.message)+retry,t('tryAgain'),'reload','refresh');
    $('source-note').textContent=t('savedOffline'); return;
  }
  if(state.view==='discover'&&!state.feed.length&&state.appendError){
    empty(t('connectionTitle'),errorText(state.appendError),t('tryAgain'),'continue','refresh');
    $('source-note').textContent=t('savedOffline');return;
  }
  const items=currentItems();
  state.indexes[state.view]=Math.max(0,Math.min(state.indexes[state.view],items.length-1));
  if (!items.length) {
    if (state.view==='saved') empty(t(state.localQuery?'savedNoMatch':'savedEmpty'),t(state.localQuery?'localNoMatchBody':'savedEmptyBody'),t(state.localQuery?'clearSearch':'goDiscover'),state.localQuery?'clearLocal':'discover','bookmark');
    else if (state.view==='history') empty(t(state.localQuery?'historyNoMatch':'historyEmpty'),t(state.localQuery?'localNoMatchBody':'historyEmptyBody'),t(state.localQuery?'clearSearch':'goDiscover'),state.localQuery?'clearLocal':'discover','clock');
    else if(state.hasMore)empty(t('findingMore'),t('findingMoreBody'),t('continueDiscover'),'continue','search');
    else empty(t('noResults'),t('noResultsBody'),t('clearFilters'),'clear','search');
    $('source-note').textContent=''; return;
  }
  if(list){renderLibrary(items);$('source-note').textContent=t(state.view==='saved'?'savedNote':'historyNote');return;}
  const r=current(); renderProject(r); $('action-rail').hidden=false; $('feed-art').hidden=false;
  renderFeedStatus();
}
function renderFeedStatus(){
  const items=currentItems();
  $('feed-progress').max=items.length;$('feed-progress').value=state.indexes[state.view]+1;
  $('feed-position').textContent=state.view==='discover'?t('streamPosition',{position:state.feedOffset+state.indexes.discover+1,count:state.seen.size}):`${String(state.indexes[state.view]+1).padStart(2,'0')} / ${String(items.length).padStart(2,'0')}`;
  $('feed-state').textContent=state.view==='discover'?t(state.hasMore?'keepExploring':'caughtUp'):'';
  if(state.appending)$('feed-position').textContent+=t('loadingMore');
  if (state.view==='discover' && state.meta) {
    const rules=t(state.query?'searchRule':state.mode==='new'?'newRule':state.mode==='gems'?'gemsRule':'popularRule');
    const time=clock(state.meta.fetchedAt);
    const restored=state.restoredIds.has(current()?.id);
    $('data-origin').textContent=t(restored?'localProgress':'realData');
    $('source-note').textContent=restored?t('snapshotNote',{time:new Date(state.resumedAt).toLocaleString(locales[language])}):`${rules} · ${t(state.meta.ordering==='created-windows'?'windowSort':state.query?'relevanceSort':'starsSort')} · ${t(state.meta.stale?'historicCache':state.meta.source==='cache'?'cachedAt':'fetchedAt',{time})}${state.meta.incomplete||state.meta.coverageLimited?t('partialResults'):''}${state.meta.stale?' · '+errorText(state.meta.warning):''}`;
    if(state.progressUnavailable)$('source-note').textContent+=' · '+t('progressNotSaved');
    $('source-note').classList.toggle('warning',!!state.meta.stale||state.progressUnavailable);
  } else $('source-note').textContent=t(state.view==='saved'?'savedNote':'historyNote');
  refreshFeedback();
}
function syncControls() {
  document.querySelectorAll('[data-topic]').forEach(b=>{const active=b.dataset.topic===state.topic;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  document.querySelectorAll('[data-mode]').forEach(b=>{const active=b.dataset.mode===state.mode;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  $('clear-search').hidden=!$('search').value;
  $('mode-tabs').hidden=!!state.query;
  $('search-caption').hidden=!state.query;
  $('search-caption').textContent=t('searchResults',{query:state.query});
}
function updateViewCopy(){
  $('view-title').innerHTML=t(state.view+'Heading');
  $('view-description').textContent=t(state.view+'Description');
  const searchKey=state.view==='discover'?'searchGithub':state.view==='saved'?'searchSaved':'searchHistory';
  $('search').setAttribute('aria-label',t(searchKey));
  $('search').placeholder=t(state.view==='discover'?'searchPlaceholder':state.view==='saved'?'searchSavedPlaceholder':'searchHistoryPlaceholder');
}
function applyLanguage(){
  document.documentElement.lang=locales[language];document.title=t('pageTitle');
  document.querySelector('meta[name="description"]').content=t('metaDescription');
  document.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=t(el.dataset.i18n));
  document.querySelectorAll('[data-i18n-html]').forEach(el=>el.innerHTML=t(el.dataset.i18nHtml));
  document.querySelectorAll('[data-i18n-aria]').forEach(el=>el.setAttribute('aria-label',t(el.dataset.i18nAria)));
  document.querySelectorAll('[data-i18n-title]').forEach(el=>el.title=t(el.dataset.i18nTitle));
  $('language-label').textContent=language==='zh'?'EN':'中文';
  $('language-toggle').setAttribute('aria-label',t('switchLanguage'));$('language-toggle').title=t('switchLanguage');
  $('share-label').textContent=t('shareShort');
  $('share-button').setAttribute('aria-label',t(typeof navigator.share==='function'?'shareProject':'copyLink'));
  updateViewCopy();syncControls();render();renderToast();
  if($('detail-dialog').open&&detailState)renderDetail();
  if($('info-dialog').open&&infoKind)renderInfo();
    paintGithub();
}
function setLanguage(next){
  if(!Object.hasOwn(locales,next))return;
  language=next;try{localStorage.setItem('githok:language',next);}catch{}
  applyLanguage();
}
async function getFeed(cursor,signal) {
  const params=new URLSearchParams({topic:state.topic,mode:state.mode,q:state.query,stream:'1'});
  if(cursor)params.set('cursor',cursor);
  const response=await fetch('/api/feed?'+params,{signal});
  const data=await response.json();
  if(!response.ok) throw Object.assign(new Error(data.error||'数据暂时无法加载。'),{retryAt:data.retryAt});
  return data;
}
function acceptBatch(data){
  if(!Array.isArray(data.items) || (data.hasMore&&(!data.nextCursor||data.nextCursor===state.cursor)))throw new Error('数据暂时无法加载。');
  const fresh=data.items.filter(repoValid).filter(r=>{if(state.seen.has(r.id))return false;state.seen.add(r.id);return true;});
  state.feed.push(...fresh);state.cursor=data.nextCursor||null;state.hasMore=!!data.hasMore;state.meta=data;
  const drop=Math.min(Math.max(0,state.feed.length-300),state.indexes.discover);
  if(drop){state.feed.splice(0,drop);state.indexes.discover-=drop;state.feedOffset+=drop;}
  scheduleProgress();
  return fresh.length;
}
async function loadFeed() {
  requestController?.abort(); requestController=new AbortController(); const generation=++state.generation;
  state.feed=[];state.seen=new Set();state.feedOffset=0;state.cursor=null;state.hasMore=false;state.appendBlocked=false;state.retryAt=0;
  state.resumedAt=null;state.restoredIds=new Set();state.resumePrefetchHold=false;state.appendError=null;
  state.loading=true; state.error=null; state.appending=false; state.indexes.discover=0; render();
  try {
    for(let attempt=0;attempt<3;attempt++){
      const data=await getFeed(state.cursor,requestController.signal);
      if(generation!==state.generation)return;
      if(acceptBatch(data)||!state.hasMore)break;
    }
  } catch(e) {if(e.name!=='AbortError'&&generation===state.generation)state.error={message:e.message,retryAt:Number.isFinite(e.retryAt)?e.retryAt:0};}
  finally{if(generation===state.generation){state.loading=false;render();}}
}
async function appendFeed({manual=false}={}) {
  const generation=state.generation;
  if(appendTask?.generation===generation)return appendTask.promise;
  if(!state.hasMore||(!manual&&state.appendBlocked))return false;
  if(state.retryAt>Date.now()){if(manual)toast('retryLater',{time:clock(state.retryAt)});return false;}
  if(manual)state.resumePrefetchHold=false;
  state.appending=true;
  refreshFeedback();
  if(current())updateActions(current());
  const promise=(async()=>{
    try{
      for(let attempt=0;attempt<3;attempt++){
        const data=await getFeed(state.cursor,requestController?.signal);
        if(generation!==state.generation)return false;
        const added=acceptBatch(data);
        if(added||!state.hasMore){state.appendBlocked=false;state.appendError=null;state.retryAt=0;return !!added;}
      }
      state.appendBlocked=true;state.appendError=null;if(manual)toast('findingMore');return false;
    }catch(e){if(e.name!=='AbortError'&&generation===state.generation){state.appendBlocked=true;state.appendError=e.message;state.retryAt=Number.isFinite(e.retryAt)?e.retryAt:0;if(!state.feed.length)toast('requestError',{message:e.message,retryAt:state.retryAt});}return false;}
    finally{
      if(generation===state.generation){state.appending=false;appendTask=null;
        if(state.view==='discover'){if(current()){updateActions(current());renderFeedStatus();}else render();}
      }
    }
  })();
  appendTask={generation,promise};return promise;
}
async function move(delta) {
  if((state.loading&&state.view==='discover')||!current())return;
  const view=state.view;const generation=state.generation;
  if(view!=='discover'&&state.collectionLayout==='list')return;
  if(view==='discover')state.resumePrefetchHold=false;
  let next=state.indexes[view]+delta;
  if(next<0)return;
  if(next>=currentItems().length&&view==='discover'&&state.hasMore)await appendFeed({manual:true});
  if(view!==state.view||generation!==state.generation)return;
  if(delta>0)next=state.indexes[view]+delta;
  if(next<currentItems().length){state.indexes[view]=next;render();}
}
function switchView(view) {
  if(state.view===view)return;
  state.view=view;state.localQuery='';state.collectionLayout='list';
  document.querySelectorAll('[data-view]').forEach(b=>{const active=b.dataset.view===view;b.classList.toggle('active',active);active?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current');});
  $('discovery-controls').hidden=view!=='discover';$('search').value=view==='discover'?state.query:'';updateViewCopy();syncControls();render();
}
function toggleSave() {
  const r=current();if(!r)return;
  const had=saved(r);
  if(!had&&state.saved.length>=300){toast('savedLimit');return;}
  state.saved=had?state.saved.filter(x=>x.id!==r.id):[r,...state.saved];
  const persisted=saveLocal('saved',state.saved);render();toast(persisted?(had?'removed':'added'):had?'removedTemporary':'addedTemporary');
}
async function share() {
  const r=current();if(!r)return;
  if(typeof navigator.share==='function'){
    try{await navigator.share({title:r.owner+'/'+r.name,url:repoURL(r)});return;}
    catch(error){if(error.name==='AbortError')return;}
  }
  try{await navigator.clipboard.writeText(repoURL(r));toast('copied');}
  catch{showInfo('link',r);}
}

function appendInline(parent,text,base) {
  const re=/\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g;let last=0;let match;
  const entities={'&mdash;':'—','&ndash;':'–','&hellip;':'…','&nbsp;':' ','&quot;':'"','&#39;':"'",'&amp;':'&'};
  const plain=s=>s.replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/<[^>]*>/g,'').replace(/\*\*|__|`/g,'').replace(/&(mdash|ndash|hellip|nbsp|quot|#39|amp);/g,m=>entities[m]);
  while((match=re.exec(text))){parent.append(document.createTextNode(plain(text.slice(last,match.index))));
    try{const url=new URL(match[2],base);if(!['https:','http:'].includes(url.protocol))throw Error();const a=document.createElement('a');a.textContent=match[1];a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';parent.append(a);}catch{parent.append(document.createTextNode(match[1]));}last=re.lastIndex;
  }parent.append(document.createTextNode(plain(text.slice(last))));
}
function renderMarkdown(text,repo) {
  const target=$('readme-content');target.replaceChildren();const base=repoURL(repo)+'/blob/'+encodeURIComponent(repo.defaultBranch||'main')+'/';
  let code=null,paragraph=[],list=null,quote=null;
  function flush(){
    if(paragraph.length){const p=document.createElement('p');appendInline(p,paragraph.join('\n'),base);(quote||target).append(p);paragraph=[];}
    list=null;
  }
  function closeQuote(){flush();quote=null;}
  for(const line of text.replaceAll('\r','').split('\n')){
    if(/^\s*```/.test(line)){closeQuote();if(code){const pre=document.createElement('pre');pre.textContent=code.join('\n');target.append(pre);code=null;}else code=[];continue;}
    if(code){code.push(line);continue;}
    if(/^\s*</.test(line)||/^\s*!\[.*\]\(/.test(line)||/^\s*\[!\[/.test(line))continue;
    const qm=line.match(/^\s*>\s?(.*)$/);
    if(qm){
      list=null;
      if(!quote){flush();quote=document.createElement('blockquote');target.append(quote);}
      const inner=qm[1];
      if(!inner.trim()){flush();continue;}
      if(!/^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i.test(inner.trim()))paragraph.push(inner);
      continue;
    }
    if(quote)closeQuote();
    if(!line.trim()){flush();continue;}
    const heading=line.match(/^(#{1,4})\s+(.+)$/);if(heading){flush();const h=document.createElement('h'+Math.min(heading[1].length,3));appendInline(h,heading[2],base);target.append(h);continue;}
    const li=line.match(/^\s*(?:[-*+] |\d+\. )(.+)$/);if(li){if(paragraph.length)flush();if(!list){list=document.createElement('ul');target.append(list);}const item=document.createElement('li');appendInline(item,li[1],base);list.append(item);continue;}
    paragraph.push(line);
  }closeQuote();if(code){const pre=document.createElement('pre');pre.textContent=code.join('\n');target.append(pre);}
  const note=document.createElement('p');note.className='readme-note';note.textContent=t('textPreview');target.append(note);
}
async function openDetail() {
  const r=current();if(!r)return;
  readmeController?.abort();readmeController=new AbortController();
  const detail={repo:r,loading:true,data:null,error:null};detailState=detail;renderDetail();
  $('detail-dialog').showModal();$('detail-dialog').scrollTop=0;
  try{
    const response=await fetch(`/api/readme/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`,{signal:readmeController.signal});const data=await response.json();
    if(!response.ok)throw new Error(data.error||'README 暂时无法读取。');detail.data=data;
  }catch(e){if(e.name==='AbortError')return;detail.error=e.message;}
  if(detailState===detail){detail.loading=false;renderDetail();}
}
function renderDetail(){
  const {repo:r,data,loading,error}=detailState;
  $('detail-title').textContent=r.owner+' / '+r.name;
  $('detail-meta').innerHTML=`<p class="detail-description">${esc(description(r))}</p><div class="detail-stats"><span>★ ${Number(r.stars).toLocaleString(locales[language])} ${t('stars')}</span><span>${esc(projectLanguage(r))}</span><span>${esc(projectLicense(r))}</span><span>${when(r.pushedAt)}</span></div><div class="detail-links"><a class="primary-button" href="${repoURL(r)}" target="_blank" rel="noopener noreferrer">${t('openGithub')} ${icon('arrow-up-right')}</a>${r.homepage&&/^https?:\/\//i.test(r.homepage)?`<a class="secondary-button" href="${esc(r.homepage)}" target="_blank" rel="noopener noreferrer">${t('projectWebsite')}</a>`:''}</div>`;
  $('original-readme').href=repoURL(r)+'#readme';
  if(loading){$('readme-content').innerHTML=`<p class="dialog-loading">${t('readmeLoading')}</p>`;return;}
  if(error){$('readme-content').textContent=errorText(error)+' '+t('openOriginalAnyway');return;}
  if(!data)return;
  renderMarkdown(data.text,r);
  if(data.truncated){const note=document.createElement('p');note.className='readme-note';note.textContent=t('readmeTruncated');$('readme-content').append(note);}
  if(data.stale){const note=document.createElement('p');note.className='readme-note';note.textContent=t('readmeCache',{time:new Date(data.fetchedAt).toLocaleString(locales[language])});$('readme-content').prepend(note);}
}
function showInfo(type,repo=null){infoKind={type,repo};renderInfo();$('info-dialog').showModal();}
function renderInfo(){
  const {type,repo}=infoKind;
  if(type==='link'){
    $('info-title').textContent=t('linkTitle');$('info-content').innerHTML=`<p>${t('linkInstructions')}</p><p><a href="${repoURL(repo)}" target="_blank" rel="noopener noreferrer">${esc(repoURL(repo))}</a></p>`;return;
  }
  if(type==='help'){
    const rows=[['next','<kbd>↓</kbd> <kbd>J</kbd> <kbd>'+t('spaceKey')+'</kbd>'],['previous','<kbd>↑</kbd> <kbd>K</kbd>'],['toggleSave','<kbd>B</kbd>'],['readReadme','<kbd>R</kbd>'],['search','<kbd>/</kbd>']];
    $('info-title').textContent=t('helpTitle');$('info-content').innerHTML=`<p>${t('helpIntro')}</p>${rows.map(([key,keys])=>`<div class="shortcut-row"><span>${t(key)}</span><span>${keys}</span></div>`).join('')}<p>${t('helpFooter')}</p>`;return;
  }
  $('info-title').textContent=t('aboutTitle');$('info-content').innerHTML=`<p>${t('aboutIntro')}</p><h3>${t('aboutRecommendations')}</h3><p>${t('aboutRules')}</p><h3>${t('aboutYourData')}</h3><p>${t('aboutStorage')}</p><p>${t('aboutCache')}</p><p><a href="https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api" target="_blank" rel="noopener noreferrer">${t('apiDocs')}</a></p>`;
}
function showHelp(){showInfo('help');}

document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
document.querySelectorAll('[data-topic]').forEach(b=>b.addEventListener('click',()=>{if(state.topic===b.dataset.topic)return;state.topic=b.dataset.topic;syncControls();loadFeed();}));
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{if(state.mode===b.dataset.mode)return;state.mode=b.dataset.mode;syncControls();loadFeed();}));
$('search-form').addEventListener('submit',e=>{e.preventDefault();if(state.view==='discover'){state.query=$('search').value.trim();loadFeed();}else{state.localQuery=$('search').value.trim();state.indexes[state.view]=0;render();}syncControls();});
$('search').addEventListener('input',()=>$('clear-search').hidden=!$('search').value);
$('clear-search').addEventListener('click',()=>{$('search').value='';$('search-form').requestSubmit();$('search').focus();});
$('save-button').addEventListener('click',toggleSave);$('share-button').addEventListener('click',share);$('readme-button').addEventListener('click',openDetail);
$('github-star-button').addEventListener('click',()=>starOnGithub());
$('github-account-button').addEventListener('click',showGithub);
$('github-login').addEventListener('click',async()=>{
  const button=$('github-login');button.disabled=true;
  try{const data=await githubRequest('login','POST');const url=new URL(data.url);if(url.origin!=='https://github.com'||url.pathname!=='/login/oauth/authorize')throw Error('Invalid login URL');persistProgress();location.assign(url.href);}
  catch{toast('githubLoginFailed');}finally{button.disabled=false;}
});
$('github-logout').addEventListener('click',async()=>{
  try{await githubRequest('logout','POST');githubEpoch++;githubSession=null;githubStars.clear();paintGithub();$('github-dialog').close();toast('githubLoggedOut');}
  catch{toast('githubUnavailable');}
});
// Pointer events cover mouse, pen and phone taps without synthetic-click duplication.
let starPointer=null,lastStarTap=null;
const ignoredStarTarget=target=>target.closest('button,a,input,textarea,select,[contenteditable],dialog');
$('feed-host').addEventListener('pointerdown',e=>{
  const stage=e.target.closest('.project-stage');
  if(!e.isPrimary||e.button!==0||!stage||ignoredStarTarget(e.target)||document.querySelector('dialog[open]')||window.getSelection()?.isCollapsed===false){starPointer=null;lastStarTap=null;return;}
  // Native double-click selects the nearest word even in blank space. Suppress
  // only the second eligible tap; ordinary selection and dragging still work.
  if(lastStarTap?.stage===stage&&Date.now()-lastStarTap.at<=320&&Math.hypot(e.clientX-lastStarTap.x,e.clientY-lastStarTap.y)<40)e.preventDefault();
  starPointer={id:e.pointerId,x:e.clientX,y:e.clientY,at:Date.now(),stage,scroll:$('feed-host').scrollTop};
});
$('feed-host').addEventListener('pointermove',e=>{if(starPointer&&starPointer.id===e.pointerId&&Math.hypot(e.clientX-starPointer.x,e.clientY-starPointer.y)>12){starPointer=null;lastStarTap=null;}});
$('feed-host').addEventListener('pointercancel',()=>{starPointer=null;lastStarTap=null;});
$('feed-host').addEventListener('pointerup',e=>{
  const p=starPointer;starPointer=null;
  if(!p||p.id!==e.pointerId||!p.stage.isConnected||ignoredStarTarget(e.target)||Date.now()-p.at>300||Math.abs($('feed-host').scrollTop-p.scroll)>2||Math.hypot(e.clientX-p.x,e.clientY-p.y)>12||!window.getSelection()?.isCollapsed){lastStarTap=null;return;}
  const tap={stage:p.stage,x:e.clientX,y:e.clientY,at:Date.now()};
  if(lastStarTap&&lastStarTap.stage===p.stage&&tap.at-lastStarTap.at<=320&&Math.hypot(tap.x-lastStarTap.x,tap.y-lastStarTap.y)<40){lastStarTap=null;e.preventDefault();starOnGithub(tap);}
  else lastStarTap=tap;
});
$('prev-button').addEventListener('click',()=>move(-1));$('next-button').addEventListener('click',()=>move(1));
$('help-button').addEventListener('click',showHelp);
$('about-button').addEventListener('click',()=>showInfo('about'));
$('language-toggle').addEventListener('click',()=>setLanguage(language==='zh'?'en':'zh'));
$('restart-feed').addEventListener('click',()=>{if(!state.loading)loadFeed();});
$('retry-feed').addEventListener('click',()=>appendFeed({manual:true}));
window.addEventListener('online',refreshFeedback);window.addEventListener('offline',refreshFeedback);
window.addEventListener('pagehide',persistProgress);
document.addEventListener('visibilitychange',()=>{if(document.hidden)persistProgress();});
for(const layout of ['list','stage'])$(layout+'-button').addEventListener('click',()=>{state.collectionLayout=layout;render();});
document.querySelectorAll('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
$('detail-dialog').addEventListener('close',()=>readmeController?.abort());
document.addEventListener('keydown',e=>{
  if(document.querySelector('dialog[open]')||e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,textarea,select,[contenteditable=true]'))return;
  const key=e.key.toLowerCase();
  if(state.view!=='discover'&&state.collectionLayout==='list'&&['arrowdown','j',' ','arrowup','k','b','r'].includes(key))return;
  if(key===' '&&e.target.closest('button,a'))return;
  if(['arrowdown','j',' '].includes(key)){e.preventDefault();if(!e.repeat)move(1);}
  else if(['arrowup','k'].includes(key)){e.preventDefault();if(!e.repeat)move(-1);}
  else if(key==='b'){e.preventDefault();if(!e.repeat)toggleSave();}
  else if(key==='r'){e.preventDefault();openDetail();}
  else if(key==='/'){e.preventDefault();$('search').focus();}
});
$('feed-layout').addEventListener('wheel',e=>{
  if(state.view!=='discover'&&state.collectionLayout==='list')return;
  if($('feed-host').scrollHeight>$('feed-host').clientHeight+2)return;
  if(document.querySelector('dialog[open]')||e.ctrlKey||Math.abs(e.deltaY)<15||Math.abs(e.deltaX)>Math.abs(e.deltaY))return;
  e.preventDefault();if(Date.now()-wheelAt<650)return;wheelAt=Date.now();move(e.deltaY>0?1:-1);
},{passive:false});
let touchStart=null;
$('feed-host').addEventListener('touchstart',e=>{touchStart=null;if(e.touches.length===1&&!e.target.closest('button,a')&&!(state.view!=='discover'&&state.collectionLayout==='list')&&$('feed-host').scrollHeight<=$('feed-host').clientHeight+2)touchStart={x:e.touches[0].clientX,y:e.touches[0].clientY};},{passive:true});
$('feed-host').addEventListener('touchcancel',()=>{touchStart=null;},{passive:true});
$('feed-host').addEventListener('touchend',e=>{if(!touchStart)return;const dx=e.changedTouches[0].clientX-touchStart.x,dy=e.changedTouches[0].clientY-touchStart.y;touchStart=null;if(Math.abs(dy)>65&&Math.abs(dy)>Math.abs(dx)*1.5)move(dy<0?1:-1);},{passive:true});
if('ResizeObserver' in window)new ResizeObserver(syncSwipeMode).observe($('feed-host'));
document.fonts?.ready.then(syncSwipeMode);
document.addEventListener('visibilitychange',()=>{if(document.hidden)briefController.pause();else if(document.querySelector('.project-stage'))briefController.select(current());});
const resumed=restoreProgress();
applyLanguage();if(resumed)toast('resumed',{position:state.feedOffset+state.indexes.discover+1});else loadFeed();
if(!storageWorks)toast('storageUnavailable');
const githubResult=new URLSearchParams(location.search).get('github');
if(githubResult){
  history.replaceState(null,'',location.pathname+location.hash);
  if(githubResult==='connected')loadGithubSession().then(()=>{paintGithub();if(current())checkGithubStar(current());toast('githubConnected',{login:githubSession?.user?.login||''});}).catch(()=>toast('githubUnavailable'));
  else toast('githubDenied');
}
