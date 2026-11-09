import { GitHubService, ApiError, feedParams, MAX_STALE } from '../core/github.mjs';

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

export function createWorker({ assets = BUILT_ASSETS, seed = BUILT_SEED, github, now = () => Date.now() } = {}) {
  let service = github;
  const json = (status, data, head = false) => new Response(head ? null : JSON.stringify(data), { status, headers:{ ...SECURITY, 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' } });
  return {
    async fetch(request, env = {}) {
      const head = request.method === 'HEAD';
      try {
        if (!['GET','HEAD'].includes(request.method)) return new Response(null, { status:405, headers:{ ...SECURITY, Allow:'GET, HEAD' } });
        const url = new URL(request.url);
        if (url.pathname === '/api/health') return json(200, { app:'githok', version:'0.1.1', ready:true, runtime:'cloud' }, head);
        if (!service) service = new EdgeGitHubService({ token:env.GITHOK_GITHUB_TOKEN, edge:typeof caches === 'undefined' ? null : caches.default });
        if (url.pathname === '/api/feed') {
          const params = feedParams(url.searchParams);
          try { return json(200, await service.feed(params), head); }
          catch (e) {
            const at = Date.parse(seed?.fetchedAt);
            if (e instanceof ApiError && params.topic === 'all' && params.mode === 'popular' && params.page === 1 && !params.q && Number.isFinite(at) && at <= now() && now() - at < MAX_STALE && Array.isArray(seed.items)) {
              return json(200, { ...seed, source:'cache', stale:true, warning:e.message, retryAt:e.retryAt || null }, head);
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
        return new Response(head ? null : asset.body,{ headers:{ ...SECURITY,'Content-Type':asset.type,'Cache-Control':'no-cache' } });
      } catch (e) { return json(e instanceof ApiError ? e.status : 500,{error:e instanceof ApiError ? e.message : '服务暂时遇到问题，请重试。',retryAt:e.retryAt || null},head); }
    },
  };
}

export default createWorker();
