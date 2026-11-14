// A bounded local checkpoint. It never changes saved projects or browsing history.
export const RESUME_KEY='githok:resume:v1';
export const MAX_RESUME_CHARS=1_000_000;
const MAX_AGE=24*60*60_000;
const TOPICS=new Set(['all','ai','tools','web','design','data']);
const MODES=new Set(['popular','new','gems']);
const integer=n=>Number.isSafeInteger(n)&&n>=0;

function project(value){
  if(!value || !integer(value.id) || typeof value.owner!=='string' || typeof value.name!=='string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(value.owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(value.name) || value.name==='.' || value.name==='..' || !Array.isArray(value.topics))return null;
  const text=(key,max)=>typeof value[key]==='string'?value[key].slice(0,max):undefined;
  return {id:value.id,owner:value.owner,name:value.name,topics:value.topics.filter(t=>typeof t==='string').slice(0,8).map(t=>t.slice(0,100)),description:text('description',6000),avatar:text('avatar',500),language:text('language',100),license:text('license',150),homepage:text('homepage',1500),defaultBranch:text('defaultBranch',200),pushedAt:text('pushedAt',40),createdAt:text('createdAt',40),stars:integer(value.stars)?value.stars:0,forks:integer(value.forks)?value.forks:0};
}

function valid(data,now){
  if(data?.v!==1 || !Number.isFinite(data.at) || data.at>now+60_000 || now-data.at>MAX_AGE || !TOPICS.has(data.topic) || !MODES.has(data.mode) || typeof data.query!=='string' || data.query.length>120 || /[\x00-\x1f]/.test(data.query))return null;
  // The normal 300-record window may temporarily retain one prefetched batch when going back.
  if(!Array.isArray(data.feed) || !data.feed.length || data.feed.length>330 || !integer(data.index) || data.index>=data.feed.length || !integer(data.offset) || !Array.isArray(data.seen) || !data.seen.every(integer))return null;
  const feed=data.feed.map(project);if(feed.some(p=>!p) || new Set(feed.map(p=>p.id)).size!==feed.length)return null;
  const seen=new Set(data.seen);
  if(seen.size!==data.seen.length || seen.size!==data.offset+feed.length || feed.some(p=>!seen.has(p.id)))return null;
  if(typeof data.hasMore!=='boolean' || (data.hasMore && (typeof data.cursor!=='string'||!data.cursor||data.cursor.length>4096)) || (!data.hasMore&&data.cursor!==null))return null;
  return {v:1,at:data.at,topic:data.topic,mode:data.mode,query:data.query,feed,index:data.index,offset:data.offset,seen:[...seen],hasMore:data.hasMore,cursor:data.cursor};
}

export function readResume(storage,now=Date.now()){
  try{const raw=storage.getItem(RESUME_KEY);if(!raw||raw.length>MAX_RESUME_CHARS)return null;return valid(JSON.parse(raw),now);}catch{return null;}
}

export function writeResume(storage,data,now=Date.now()){
  try{
    const checkpoint=valid({...data,v:1,at:now},now);if(!checkpoint)throw Error('Invalid checkpoint');
    const raw=JSON.stringify(checkpoint);if(raw.length>MAX_RESUME_CHARS)throw Error('Checkpoint too large');
    storage.setItem(RESUME_KEY,raw);return true;
  }catch{
    // Never leave an older checkpoint looking like the most recently saved position.
    try{storage.removeItem(RESUME_KEY);}catch{}
    return false;
  }
}
