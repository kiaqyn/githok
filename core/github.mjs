const TOPICS = { all: '', ai: 'topic:artificial-intelligence', tools: 'topic:developer-tools', web: 'topic:web-development', design: 'topic:design', data: 'topic:data-science' };
const MODES = new Set(['popular', 'new', 'gems']);
const TTL = 15 * 60_000;
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
  return { topic, mode, page: Number(pageText), q };
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
  constructor({ fetchImpl = fetch, token, now = () => Date.now() } = {}) {
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
    } catch { throw new ApiError('暂时连不上 GitHub，请检查网络后重试。'); }
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
  feed(params) {
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
  readme(owner, repo) {
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo) || repo === '.' || repo === '..') throw new ApiError('项目地址无效。', 400);
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`;
    return this.cached('readme:' + owner + '/' + repo, async () => {
      const text = await this.request(path, { raw: true });
      return { text: text.slice(0, 24_000), truncated: text.length > 24_000 };
    });
  }
}
