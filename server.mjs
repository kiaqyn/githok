import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

import { GitHubService as MemoryGitHubService, ApiError, feedParams, MAX_STALE, MAX_ENTRIES } from './core/github.mjs';
export { ApiError, feedParams };

const ROOT = dirname(fileURLToPath(import.meta.url));

export class GitHubService extends MemoryGitHubService {
  constructor(options = {}) {
    super(options);
    this.cacheFile = options.cacheFile === undefined ? resolve(ROOT, '.cache/cache.json') : options.cacheFile;
    this.token = options.token === undefined ? process.env.GITHOK_GITHUB_TOKEN : options.token;
    this.writeQueue = Promise.resolve();
    this.ready = this.loadCache();
  }
  async loadCache() {
    if (!this.cacheFile) return;
    try {
      const raw = await readFile(this.cacheFile, 'utf8');
      if (raw.length > 8_000_000) return;
      const data = JSON.parse(raw);
      for (const [key, entry] of data.slice(-MAX_ENTRIES)) {
        if (entry && Number.isFinite(entry.at) && entry.at <= this.now() && this.now() - entry.at < MAX_STALE) this.cache.set(key, entry);
      }
    } catch { /* An absent or damaged cache must not block live requests. */ }
  }
  persist() {
    if (!this.cacheFile) return;
    const data = JSON.stringify([...this.cache].slice(-MAX_ENTRIES));
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      await mkdir(dirname(this.cacheFile), { recursive: true });
      await writeFile(this.cacheFile + '.tmp', data, { mode: 0o600 });
      await rename(this.cacheFile + '.tmp', this.cacheFile);
    }).catch(() => {});
  }
  feedKey(path) { return createHash('sha256').update(path).digest('hex'); }
}

const SECURITY = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://avatars.githubusercontent.com data:; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
};

export function createServer({ github = new GitHubService() } = {}) {
  return http.createServer(async (req, res) => {
    const json = (status, data) => { res.writeHead(status, { ...SECURITY, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return json(405, { error: '只支持读取请求。' }); }
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/api/health') return json(200, { app: 'githok', version: '0.1.0', ready: true });
      if (url.pathname === '/api/feed') return json(200, await github.feed(feedParams(url.searchParams)));
      const match = url.pathname.match(/^\/api\/readme\/([^/]+)\/([^/]+)$/);
      if (match) return json(200, await github.readme(decodeURIComponent(match[1]), decodeURIComponent(match[2])));
      const assets = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/favicon.svg': 'favicon.svg', '/manifest.webmanifest': 'manifest.webmanifest' };
      if (!assets[url.pathname]) return json(404, { error: '页面不存在。' });
      const file = resolve(ROOT, 'public', assets[url.pathname]);
      const body = await readFile(file);
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
      res.writeHead(200, { ...SECURITY, 'Content-Type': types[extname(file)], 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (e) { json(e instanceof ApiError ? e.status : 500, { error: e instanceof ApiError ? e.message : '服务暂时遇到问题，请重试。', retryAt: e.retryAt || null }); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be between 1024 and 65535');
  const server = createServer();
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`GitHok is ready: ${url}\nPress Ctrl+C to stop.`);
    if (process.argv.includes('--open')) spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' }).unref();
  });
  server.on('error', (error) => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Open http://127.0.0.1:${port}, or set PORT to another number.` : error.message); process.exitCode = 1; });
}
