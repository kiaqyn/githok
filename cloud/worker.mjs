import { GitHubService, ApiError, feedParams, MAX_STALE } from '../core/github.mjs';
import { BriefService, BriefError } from '../core/briefs.mjs';

const BUILT_ASSETS = typeof __GITHOK_ASSETS__ === 'undefined' ? {} : __GITHOK_ASSETS__;
const BUILT_SEED = typeof __GITHOK_SEED__ === 'undefined' ? null : __GITHOK_SEED__;
const SECURITY = {
  'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://avatars.githubusercontent.com data:; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
};

export class EdgeGitHubService extends GitHubService {
  constructor(options = {}) { super(options); this.edge = options.edge || null; }
  async cached(key, work) {
    const cacheKey = new Request('https://githok-cache.internal/' + encodeURIComponent(key));
    if (this.edge && !this.cache.has(key)) {
      try {
        const response = await this.edge.match(cacheKey);
        if (response) {
          const entry = await response.json();
          if (Number.isFinite(entry.at) && entry.at <= this.now() && this.now() - entry.at < MAX_STALE && entry.data) this.cache.set(key, entry);
        }
      } catch { /* Edge cache availability must not stop a public GitHub read. */ }
    }
    const result = await super.cached(key, work);
    if (this.edge && result.source === 'github') {
      const entry = this.cache.get(key);
      try { await this.edge.put(cacheKey, new Response(JSON.stringify(entry), { headers: { 'Content-Type':'application/json', 'Cache-Control':'public, max-age=604800' } })); } catch { /* In-memory cache remains usable. */ }
    }
    return result;
  }
}

export function createWorker({ assets = BUILT_ASSETS, seed = BUILT_SEED, github, briefs, now = () => Date.now() } = {}) {
  let service = github;
  let summaries=briefs;
  const json = (status, data, head = false) => new Response(head ? null : JSON.stringify(data), { status, headers:{ ...SECURITY, 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' } });
  return {
    async fetch(request, env = {}) {
      const head = request.method === 'HEAD';
      try {
        if (!['GET','HEAD'].includes(request.method)) return new Response(null, { status:405, headers:{ ...SECURITY, Allow:'GET, HEAD' } });
        const url = new URL(request.url);
        // Account sessions need a durable, isolated store before enabling cloud writes.
        if(url.pathname==='/api/github/session')return json(200,{configured:false,authenticated:false},head);
        if (url.pathname === '/api/health') return json(200, { app:'githok', version:'0.1.1', ready:true, runtime:'cloud' }, head);
        if (!service) service = new EdgeGitHubService({ token:env.GITHOK_GITHUB_TOKEN, edge:typeof caches === 'undefined' ? null : caches.default });
        if(url.pathname==='/api/brief-status'||url.pathname.startsWith('/api/brief/')){
          if(!summaries)summaries=new BriefService({resolveProject:(owner,repo)=>service.project(owner,repo),readme:(owner,repo)=>service.readme(owner,repo),baseURL:env.GITHOK_AI_BASE_URL,apiKey:env.GITHOK_AI_KEY,model:env.GITHOK_AI_MODEL,maxCallsPerHour:env.GITHOK_BRIEFS_PER_HOUR,now});
          if(url.pathname==='/api/brief-status')return json(200,{enabled:summaries.enabled},head);
          const briefMatch=url.pathname.match(/^\/api\/brief\/([^/]+)\/([^/]+)$/);
          if(!briefMatch)return json(404,{error:'页面不存在。'},head);
          if(head)return json(summaries.enabled?200:503,null,true);
          let owner,repo;try{owner=decodeURIComponent(briefMatch[1]);repo=decodeURIComponent(briefMatch[2]);}catch{throw new BriefError('项目地址无效。',400,'INVALID_PROJECT');}
          return json(200,await summaries.get(owner,repo));
        }
        if (url.pathname === '/api/feed') {
          const params = feedParams(url.searchParams);
          try { return json(200, await service.feed(params), head); }
          catch (e) {
            const at = Date.parse(seed?.fetchedAt);
            if (e instanceof ApiError && params.topic === 'all' && params.mode === 'popular' && params.page === 1 && !params.q && Number.isFinite(at) && at <= now() && now() - at < MAX_STALE && Array.isArray(seed.items)) {
              return json(200, { ...seed, ...(params.stream?{hasMore:false,nextCursor:null,coverageLimited:true}:{}), source:'cache', stale:true, warning:e.message, retryAt:e.retryAt || null }, head);
            }
            throw e;
          }
        }
        const match = url.pathname.match(/^\/api\/readme\/([^/]+)\/([^/]+)$/);
        if (match) {
          let owner, repo;
          try { owner=decodeURIComponent(match[1]); repo=decodeURIComponent(match[2]); } catch { throw new ApiError('项目地址无效。',400); }
          return json(200, await service.readme(owner,repo), head);
        }
        const path = url.pathname === '/' ? '/index.html' : url.pathname;
        const asset = Object.hasOwn(assets,path) ? assets[path] : null;
        if (!asset) return json(404,{error:'页面不存在。'},head);
        const body=head?null:asset.encoding==='base64'?Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0)):asset.body;
        return new Response(body,{ headers:{ ...SECURITY,'Content-Type':asset.type,'Cache-Control':'no-cache' } });
      } catch (e) { const known=e instanceof ApiError||e instanceof BriefError;return json(known?e.status:500,{error:known?e.message:'服务暂时遇到问题，请重试。',...(e instanceof BriefError?{code:e.code}:{}),retryAt:e.retryAt||null},head); }
    },
  };
}

export default createWorker();
