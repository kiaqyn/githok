const TOPICS = { all: '', ai: 'topic:artificial-intelligence', tools: 'topic:developer-tools', web: 'topic:web-development', design: 'topic:design', data: 'topic:data-science' };
const MODES = new Set(['popular', 'new', 'gems']);
const TTL = 15 * 60_000;
const FIRST_REPO_SECOND = Date.parse('2007-01-01T00:00:00Z') / 1000;
const PAGE_SIZE = 30;
const SEARCH_WINDOW = 990; // Stop below GitHub's 1,000-result ceiling.
export const MAX_STALE = 7 * 86_400_000;
export const MAX_ENTRIES = 80;

export class ApiError extends Error {
  constructor(message, status = 502, retryAt = null) { super(message); this.status = status; this.retryAt = retryAt; }
}

export function feedParams(search) {
  const topic = search.get('topic') || 'all';
  const mode = search.get('mode') || 'popular';
  const pageText = search.get('page') || '1';
  const q = (search.get('q') || '').trim();
  if (!Object.hasOwn(TOPICS, topic) || !MODES.has(mode) || !/^[1-9]\d?$/.test(pageText) || Number(pageText) > 10 || q.length > 120 || /[\x00-\x1f]/.test(q)) {
    throw new ApiError('筛选条件有误，请重新选择。', 400);
  }
  const stream = search.get('stream');
  const cursor = search.get('cursor') || '';
  if ((stream && stream !== '1') || (cursor && stream !== '1') || cursor.length > 4096) throw new ApiError('筛选条件有误，请重新选择。', 400);
  return { topic, mode, page: Number(pageText), q, ...(stream === '1' ? { stream:true, cursor } : {}) };
}

function streamState(params, now) {
  const scope = JSON.stringify([params.topic,params.mode,params.q]);
  if (params.cursor) {
    let c;
    try { c=JSON.parse(params.cursor); } catch { throw new ApiError('筛选条件有误，请重新选择。',400); }
    if(c?.v!==1 || c.scope!==scope || !Number.isSafeInteger(c.at) || c.at<FIRST_REPO_SECOND || c.at>Math.floor(now/1000)+60 || !Array.isArray(c.ranges) || c.ranges.length>64 || !c.ranges.length)throw new ApiError('筛选条件有误，请重新选择。',400);
    for(const r of c.ranges)if(!Array.isArray(r)||r.length!==3||!r.every(Number.isSafeInteger)||r[0]<FIRST_REPO_SECOND||r[0]>r[1]||r[1]>c.at||r[2]<1||r[2]>33)throw new ApiError('筛选条件有误，请重新选择。',400);
    return c;
  }
  // Share initial-window caches across visitors; freeze the stream to a 15-minute boundary.
  const at=Math.floor(now/900_000)*900, ranges=[];
  const floor=params.mode==='new'&&!params.q?Math.max(FIRST_REPO_SECOND,at-90*86400):FIRST_REPO_SECOND;
  let high=at;
  while(high>=floor){const year=new Date(high*1000).getUTCFullYear();const low=Math.max(floor,Date.UTC(year,0,1)/1000);ranges.push([low,high,1]);high=low-1;}
  return {v:1,scope,at,ranges};
}

function cleanRepo(r) {
  return {
    id: r.id, name: r.name, fullName: r.full_name,
    owner: r.owner.login, avatar: r.owner.avatar_url,
    description: r.description || '作者暂未填写项目介绍，可以打开 README 了解更多。',
    url: `https://github.com/${r.full_name}`,
    stars: r.stargazers_count, forks: r.forks_count,
    language: r.language || '未标注', topics: (r.topics || []).slice(0, 8),
    license: r.license?.spdx_id && r.license.spdx_id !== 'NOASSERTION' ? r.license.spdx_id : '未标注许可证',
    pushedAt: r.pushed_at, createdAt: r.created_at,
    homepage: /^https?:\/\//i.test(r.homepage || '') ? r.homepage : null,
    defaultBranch: r.default_branch,
  };
}

export class GitHubService {
  constructor({ fetchImpl = (...args) => fetch(...args), token, now = () => Date.now() } = {}) {
    this.fetchImpl = fetchImpl; this.token = token; this.now = now;
    this.cache = new Map(); this.pending = new Map(); this.cooldown = new Map();
    this.ready = Promise.resolve();
  }
  persist() {}
  feedKey(path) { return 'feed:' + path; }
  async request(path, { raw = false } = {}) {
    const bucket = path.startsWith('/search/') ? 'search' : 'core';
    const until = this.cooldown.get(bucket) || 0;
    if (until > this.now()) throw new ApiError('GitHub 暂时限制了请求频率，请稍后再试。', 429, until);
    let response;
    try {
      response = await this.fetchImpl('https://api.github.com' + path, {
        headers: { 'User-Agent': 'GitHok/0.1 (local discovery)', Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      console.warn('GitHok GitHub transport failed:', error?.name || 'Error', error?.message || 'unknown');
      throw new ApiError('暂时连不上 GitHub，请检查网络后重试。');
    }
    if (response.status === 403 || response.status === 429) {
      const retry = Number(response.headers.get('retry-after'));
      const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
      const retryAt = retry > 0 ? this.now() + retry * 1000 : reset > this.now() ? reset : this.now() + 60_000;
      this.cooldown.set(bucket, retryAt);
      throw new ApiError('GitHub 请求额度暂时用完了，稍后会恢复。', 429, retryAt);
    }
    if (response.status === 404) throw new ApiError('这个项目还没有可读取的 README。', 404);
    if (!response.ok) throw new ApiError('GitHub 暂时无法返回内容，请稍后再试。');
    return raw ? response.text() : response.json();
  }
  async cached(key, work) {
    await this.ready;
    const old = this.cache.get(key);
    if (old && this.now() - old.at < TTL) return { ...old.data, fetchedAt: new Date(old.at).toISOString(), source: 'cache', stale: false };
    if (this.pending.has(key)) return this.pending.get(key);
    const task = (async () => {
      try {
        const data = await work();
        const entry = { at: this.now(), data };
        this.cache.delete(key); this.cache.set(key, entry);
        while (this.cache.size > MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value);
        this.persist();
        return { ...data, fetchedAt: new Date(entry.at).toISOString(), source: 'github', stale: false };
      } catch (e) {
        if (old && this.now() - old.at < MAX_STALE) return { ...old.data, fetchedAt: new Date(old.at).toISOString(), source: 'cache', stale: true, warning: e.message, retryAt: e.retryAt || null };
        throw e;
      } finally { this.pending.delete(key); }
    })();
    this.pending.set(key, task);
    return task;
  }
  async project(owner,repo){
    if(!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner)||!/^[A-Za-z0-9_.-]{1,100}$/.test(repo)||repo==='.'||repo==='..')throw new ApiError('项目地址无效。',400);
    await this.ready;
    const name=(owner+'/'+repo).toLowerCase();
    // Reuse evidence already read for the recommendation; do not reread every repo.
    for(const entry of [...this.cache.values()].reverse()){
      if(entry.at>this.now()||this.now()-entry.at>=TTL)continue;
      const match=entry.data?.items?.find(r=>(r.owner+'/'+r.name).toLowerCase()===name);
      if(match)return match;
    }
    return this.cached('public-project:'+name,async()=>{
      const data=await this.request('/repos/'+encodeURIComponent(owner)+'/'+encodeURIComponent(repo));
      if(data.private!==false)throw new ApiError('只支持公开项目。',404);
      return cleanRepo(data);
    });
  }
  feed(params) {
    if(params.stream)return this.stream(params);
    const { topic, mode, page, q } = params;
    const date = new Date(this.now() - (mode === 'new' ? 90 : 180) * 86_400_000).toISOString().slice(0, 10);
    // Quotes turn free text into a search phrase, preventing user-supplied qualifiers from changing scope.
    const words = q ? `"${q.replaceAll('"', ' ').replaceAll('\\', ' ')}" in:name,description,topics` : '';
    const criteria = q ? '' : mode === 'new' ? `created:>=${date} stars:>10` : mode === 'gems' ? `stars:50..5000 pushed:>=${date}` : `stars:>1000 pushed:>=${date}`;
    const query = [words, 'is:public fork:false archived:false', TOPICS[topic], criteria].filter(Boolean).join(' ');
    const search = new URLSearchParams({ q: query, per_page: '30', page: String(page) });
    if (!q) { search.set('sort', 'stars'); search.set('order', 'desc'); }
    const path = '/search/repositories?' + search;
    const key = this.feedKey(path);
    return this.cached(key, async () => {
      const response = await this.request(path);
      return { items: response.items.map(cleanRepo), total: Math.min(response.total_count, 300), page, hasMore: page < 10 && page * 30 < Math.min(response.total_count, 300), incomplete: !!response.incomplete_results, query, mode, topic };
    });
  }
  async stream(params) {
    const state=streamState(params,this.now());
    // A bounded number of upstream reads per HTTP request; no unbounded scanning.
    for(let attempt=0;attempt<4 && state.ranges.length;attempt++) {
      const [low,high,page]=state.ranges[0];
      const date=new Date((state.at-180*86400)*1000).toISOString().slice(0,10);
      const words=params.q?`"${params.q.replaceAll('"',' ').replaceAll('\\',' ')}" in:name,description,topics`:'';
      const criteria=params.q?'':params.mode==='new'?'stars:>10':params.mode==='gems'?`stars:50..5000 pushed:>=${date}`:`stars:>1000 pushed:>=${date}`;
      const stamp=value=>new Date(value*1000).toISOString().replace('.000Z','Z');
      const query=[words,'is:public fork:false archived:false',TOPICS[params.topic],criteria,`created:${stamp(low)}..${stamp(high)}`].filter(Boolean).join(' ');
      const search=new URLSearchParams({q:query,per_page:String(PAGE_SIZE),page:String(page)});
      if(!params.q){search.set('sort','stars');search.set('order','desc');}
      const path='/search/repositories?'+search;
      const result=await this.cached(this.feedKey('stream-v1:'+path),async()=>{
        const response=await this.request(path);
        return {items:response.items.map(cleanRepo),total:response.total_count,incomplete:!!response.incomplete_results};
      });
      if((result.total>SEARCH_WINDOW||result.incomplete)&&low<high){
        const mid=Math.floor((low+high)/2);
        state.ranges.splice(0,1,[mid+1,high,1],[low,mid,1]);continue;
      }
      if(page*PAGE_SIZE<Math.min(result.total,SEARCH_WINDOW)&&result.items.length)state.ranges[0][2]++;
      else state.ranges.shift();
      const nextCursor=state.ranges.length?JSON.stringify(state):null;
      if(result.items.length || !nextCursor)return {...result,page,hasMore:!!nextCursor,nextCursor,ordering:'created-windows',coverageLimited:result.total>SEARCH_WINDOW||result.incomplete};
    }
    return {items:[],hasMore:!!state.ranges.length,nextCursor:state.ranges.length?JSON.stringify(state):null,scanning:!!state.ranges.length,ordering:'created-windows',source:'github',stale:false,fetchedAt:new Date(this.now()).toISOString()};
  }
  readme(owner, repo) {
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo) || repo === '.' || repo === '..') throw new ApiError('项目地址无效。', 400);
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`;
    return this.cached('readme:' + owner + '/' + repo, async () => {
      try {
        const text = await this.request(path, { raw: true });
        return { text: text.slice(0, 24_000), truncated: text.length > 24_000, contentSource:'github-api' };
      } catch (error) {
        if (!(error instanceof ApiError) || ![429,502].includes(error.status)) throw error;
        // One conventional public README fallback; never forward API credentials to a different host.
        const url = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/HEAD/README.md`;
        let response;
        try { response = await this.fetchImpl(url, { headers:{ Accept:'text/plain' }, signal:AbortSignal.timeout(15_000) }); } catch { throw error; }
        if (!response.ok || !response.body) throw error;
        const reader=response.body.getReader(), decoder=new TextDecoder();
        let text='', truncated=false;
        try {
          while (true) {
            const part=await reader.read();
            if (part.done) { text+=decoder.decode();break; }
            text+=decoder.decode(part.value,{stream:true});
            if (text.length>24_000) { truncated=true;await reader.cancel();break; }
          }
        } finally { reader.releaseLock(); }
        return { text:text.slice(0,24_000), truncated:truncated||text.length>24_000, contentSource:'github-raw' };
      }
    });
  }
}
