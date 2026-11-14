const KEY='githok:briefs:v1',MAX_ENTRIES=80,MAX_CHARS=750_000,MAX_AGE=30*86400_000;
export const briefKey=r=>JSON.stringify([r.owner,r.name,r.description,r.topics,r.language]);
export function validBrief(d,r,now=Date.now()){
  return d?.version===1&&typeof d.fullName==='string'&&d.fullName.toLowerCase()===(r.owner+'/'+r.name).toLowerCase()&&/^[a-f0-9]{64}$/.test(d.fingerprint)&&Number.isFinite(d.at)&&d.at<=now+300_000&&now-d.at<MAX_AGE&&typeof d.translation==='string'&&d.translation.length>0&&d.translation.length<=800&&/[\u3400-\u9fff]/u.test(d.translation)&&typeof d.summary==='string'&&d.summary.length>0&&d.summary.length<=160&&/[\u3400-\u9fff]/u.test(d.summary)&&(d.audience===null||(typeof d.audience==='string'&&d.audience.length<=80))&&typeof d.original==='string'&&d.original.length<=1800&&['description','readme-excerpt'].includes(d.evidenceSource);
}
export function createBriefController({fetchImpl,storage,getCurrent,getLanguage,onChange,isVisible=()=>true,setTimer=setTimeout,clearTimer=clearTimeout,now=()=>Date.now(),delay=650,requestTimeout=30_000}){
  const entries=new Map();let timer,cooldownTimer,activeAbort,waitingKey=null,activeKey=null,queuedManual=false,notConfigured=false,destroyed=false;
  const deadline=Number.isFinite(requestTimeout)?Math.max(1000,Math.min(60_000,requestTimeout)):30_000;
  try{
    const raw=storage.getItem(KEY);if(raw&&raw.length<=MAX_CHARS){const saved=JSON.parse(raw);if(saved.v===1&&Array.isArray(saved.entries))for(const pair of saved.entries.slice(-MAX_ENTRIES)){
      try{const [key,data]=pair,[owner,name,description,topics,language]=JSON.parse(key);if(validBrief(data,{owner,name,description,topics,language},now()))entries.set(key,{data,mode:'summary'});}catch{}
    }}
  }catch{/* Storage is optional. */}
  const currentKey=()=>{const r=getCurrent();return r?briefKey(r):null;};
  function persist(){try{const data={v:1,entries:[...entries].filter(([,v])=>v.data).map(([key,v])=>[key,v.data])};while(JSON.stringify(data).length>MAX_CHARS&&data.entries.length)data.entries.shift();storage.setItem(KEY,JSON.stringify(data));}catch{}}
  function trim(){while(entries.size>MAX_ENTRIES)entries.delete(entries.keys().next().value);}
  function notify(key){if(!destroyed&&currentKey()===key)onChange();}
  function pause(){clearTimer(timer);waitingKey=null;queuedManual=false;}
  function peek(r){
    const key=briefKey(r),entry=entries.get(key);
    if(entry?.data&&validBrief(entry.data,r,now()))return {...entry,state:'ready'};
    if(notConfigured)return {state:'disabled',error:'BRIEF_NOT_CONFIGURED'};
    if(key===activeKey||key===waitingKey)return {state:'pending'};
    if(entry?.error)return {...entry,state:'error'};
    return {state:notConfigured?'disabled':'idle'};
  }
  async function request(r,key){
    if(destroyed||activeKey||!isVisible()||currentKey()!==key||getLanguage()!=='zh')return;
    waitingKey=null;activeKey=key;entries.delete(key);notify(key);
    const abort=new AbortController();activeAbort=abort;let watchdog;
    try{
      // Race the complete read, including the JSON body. Some transports ignore
      // abort; a late resolution must never regain ownership of the request.
      const result=await Promise.race([
        (async()=>{const response=await fetchImpl('/api/brief/'+encodeURIComponent(r.owner)+'/'+encodeURIComponent(r.name),{signal:abort.signal});return {response,data:await response.json()};})(),
        new Promise((_,reject)=>{watchdog=setTimer(()=>{reject(Object.assign(new Error('Brief request timed out'),{code:'BRIEF_TIMEOUT'}));abort.abort();},deadline);}),
      ]);
      const {response,data}=result;
      if(destroyed)return;
      if(!response.ok)throw Object.assign(new Error('Brief request failed'),{code:data.code||'BRIEF_FAILED',retryAt:Number.isFinite(data.retryAt)?data.retryAt:null});
      if(!validBrief(data,r,now()))throw Object.assign(new Error('Invalid brief'),{code:'BRIEF_FAILED'});
      if(data.evidenceSource==='description'&&data.original!==(r.description||'').trim().slice(0,1200))throw Object.assign(new Error('Project description changed'),{code:'BRIEF_CHANGED'});
      entries.set(key,{data,mode:'summary'});trim();persist();
    }catch(error){
      if(destroyed)return;
      const code=error.code||'BRIEF_FAILED';if(code==='BRIEF_NOT_CONFIGURED')notConfigured=true;
      entries.set(key,{error:code,retryAt:error.retryAt||null});trim();
      if(error.retryAt>now()){clearTimer(cooldownTimer);cooldownTimer=setTimer(()=>notify(key),Math.min(error.retryAt-now()+10,3600_010));}
    }finally{
      clearTimer(watchdog);if(activeAbort===abort)activeAbort=null;
      activeKey=null;notify(key);
      if(!destroyed){const latest=getCurrent();if(latest&&briefKey(latest)!==key)select(latest,{manual:queuedManual&&waitingKey===briefKey(latest)});}
    }
  }
  function select(r,{manual=false}={}){
    if(destroyed)return;
    pause();if(!r)return;
    const key=briefKey(r),entry=peek(r);notify(key);
    if(getLanguage()!=='zh'||!isVisible()||entry.state==='ready'||entry.state==='disabled'||(!manual&&entry.state==='error')||entry.retryAt>now())return;
    if(activeKey){if(activeKey!==key){waitingKey=key;queuedManual=manual;notify(key);}return;}
    waitingKey=key;notify(key);timer=setTimer(()=>request(r,key),manual?0:delay);
  }
  function mode(r,value){if(!['summary','translation','original'].includes(value))return;const key=briefKey(r),entry=entries.get(key);if(entry?.data){entry.mode=value;notify(key);}}
  function destroy(){destroyed=true;pause();activeAbort?.abort();clearTimer(cooldownTimer);}
  return {select,peek,mode,pause,destroy};
}
