import { randomBytes, createHash } from 'node:crypto';

const COOKIE = 'githok_github_session';
const TTL = 8 * 60 * 60 * 1000;
const nonce = () => randomBytes(32).toString('base64url');
const validRepo = (owner, repo) => /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner) && /^[A-Za-z0-9_.-]{1,100}$/.test(repo) && !['.', '..'].includes(repo);
class AccountError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

// Local, single-process sessions. Tokens never enter frontend storage or disk.
export class GitHubAccount {
  constructor({ clientId = '', clientSecret = '', origin = 'http://127.0.0.1:4317', fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.clientId = clientId.trim(); this.secret = clientSecret.trim();
    this.origin = new URL(origin).origin; this.fetch = fetchImpl; this.now = now; this.sessions = new Map();
    const url = new URL(this.origin);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('GitHub sign-in requires HTTPS outside localhost.');
    this.enabled = !!this.clientId && !!this.secret;
  }
  session(req) {
    for (const [id, session] of this.sessions) if (session.expires <= this.now()) this.sessions.delete(id);
    const id = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
    return this.sessions.get(id);
  }
  create(res) {
    if (this.sessions.size >= 1000) throw new AccountError('ACCOUNT_BUSY', 503);
    const session = { id: nonce(), csrf: nonce(), expires: this.now() + TTL, stars: new Map(), writes: new Map() };
    this.sessions.set(session.id, session);
    res.setHeader('Set-Cookie', `${COOKIE}=${session.id}; Path=/api/github; HttpOnly; SameSite=Lax; Max-Age=28800${this.origin.startsWith('https:') ? '; Secure' : ''}`);
    return session;
  }
  async upstream(path, options = {}) {
    try { return await this.fetch(path, { ...options, redirect: 'error', signal: AbortSignal.timeout(12000) }); }
    catch { throw new AccountError('GITHUB_UNAVAILABLE', 502); }
  }
  async api(session, path, method = 'GET') {
    if (!session?.token || session.tokenUntil <= this.now()) throw new AccountError('LOGIN_REQUIRED', 401);
    const response = await this.upstream('https://api.github.com' + path, { method, headers: {
      Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + session.token,
      'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'GitHok', ...(method === 'PUT' ? { 'Content-Length': '0' } : {}),
    } });
    if (response.status === 401) { delete session.token; delete session.user; session.stars.clear(); throw new AccountError('LOGIN_REQUIRED', 401); }
    if (response.status === 403 || response.status === 429) throw new AccountError('GITHUB_FORBIDDEN', response.status);
    return response;
  }
  async handle(req, res, security) {
    const url = new URL(req.url, this.origin);
    const json = (status, data) => { res.writeHead(status, { ...security, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      if (req.headers.host !== new URL(this.origin).host) throw new AccountError('ORIGIN_MISMATCH', 403);
      let session = this.session(req);
      if (req.method === 'GET' && url.pathname === '/api/github/session') {
        if (this.enabled && !session) session = this.create(res);
        const authenticated = !!session?.token && session.tokenUntil > this.now();
        return json(200, { configured: this.enabled, authenticated, ...(session ? { csrf: session.csrf } : {}), ...(authenticated ? { user: session.user } : {}) });
      }
      if (!this.enabled) throw new AccountError('LOGIN_NOT_CONFIGURED', 503);
      if (req.method === 'GET' && url.pathname === '/api/github/callback') {
        const pending = session?.oauth;
        if (!pending || pending.until < this.now() || !url.searchParams.get('state') || url.searchParams.get('state') !== pending.state) throw new AccountError('OAUTH_STATE_INVALID', 403);
        delete session.oauth; // A callback can only be exchanged once.
        if (url.searchParams.has('error')) { res.writeHead(303, { ...security, Location: '/?github=denied', 'Cache-Control': 'no-store' }); return res.end(); }
        const code = url.searchParams.get('code');
        if (!code || code.length > 512) throw new AccountError('OAUTH_CODE_INVALID');
        const response = await this.upstream('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: this.clientId, client_secret: this.secret, code, code_verifier: pending.verifier, redirect_uri: this.origin + '/api/github/callback' }) });
        const data = await response.json();
        if (!response.ok || !data.access_token || data.error) throw new AccountError('LOGIN_FAILED', 502);
        const temporary = { token: data.access_token, tokenUntil: this.now() + Math.min(TTL, Number(data.expires_in || TTL / 1000) * 1000), stars: new Map() };
        const identity = await this.api(temporary, '/user');
        if (!identity.ok) throw new AccountError('LOGIN_FAILED', 502);
        const user = await identity.json();
        if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(user.login)) throw new AccountError('LOGIN_FAILED', 502);
        if (!this.sessions.has(session.id)) throw new AccountError('LOGIN_REQUIRED', 401);
        // Rotate the session after authentication; never bind a new account to old star state.
        this.sessions.delete(session.id); session = this.create(res);
        Object.assign(session, { token: temporary.token, tokenUntil: temporary.tokenUntil, user: { login: user.login } });
        res.writeHead(303, { ...security, Location: '/?github=connected', 'Cache-Control': 'no-store' }); return res.end();
      }
      if (['POST', 'PUT'].includes(req.method)) {
        if (req.headers.origin !== this.origin || !session || req.headers['x-githok-csrf'] !== session.csrf) throw new AccountError('CSRF_INVALID', 403);
      }
      if (req.method === 'POST' && url.pathname === '/api/github/login') {
        if (session.loginAt && this.now() - session.loginAt < 10000) throw new AccountError('LOGIN_BUSY', 429);
        session.loginAt = this.now();
        const verifier = nonce(), state = nonce();
        session.oauth = { state, verifier, until: this.now() + 10 * 60 * 1000 };
        const target = new URL('https://github.com/login/oauth/authorize');
        target.search = new URLSearchParams({ client_id: this.clientId, redirect_uri: this.origin + '/api/github/callback', scope: 'public_repo', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
        return json(200, { url: target.href });
      }
      if (req.method === 'POST' && url.pathname === '/api/github/logout') {
        this.sessions.delete(session.id);
        res.setHeader('Set-Cookie', `${COOKIE}=; Path=/api/github; HttpOnly; SameSite=Lax; Max-Age=0${this.origin.startsWith('https:') ? '; Secure' : ''}`);
        return json(200, { authenticated: false });
      }
      const match = url.pathname.match(/^\/api\/github\/star\/([^/]+)\/([^/]+)$/);
      if (match && ['GET', 'PUT'].includes(req.method)) {
        if (!validRepo(match[1], match[2])) throw new AccountError('INVALID_PROJECT');
        const path = '/user/starred/' + match[1] + '/' + match[2], key = path.toLowerCase();
        if (req.method === 'GET') {
          const response = await this.api(session, path);
          if (![204, 404].includes(response.status)) throw new AccountError('STAR_FAILED', 502);
          return json(200, { starred: response.status === 204 });
        }
        if (!session?.token || session.tokenUntil <= this.now()) throw new AccountError('LOGIN_REQUIRED', 401);
        if (!session.writes.has(key)) {
          if (session.writes.size >= 5) throw new AccountError('STAR_BUSY', 429);
          const task = (async () => {
            const repo = await this.api(session, '/repos/' + match[1] + '/' + match[2]);
            if (!repo.ok || (await repo.json()).private !== false) throw new AccountError('PUBLIC_PROJECT_REQUIRED', 400);
            const response = await this.api(session, path, 'PUT');
            if (response.status !== 204) throw new AccountError('STAR_FAILED', 502);
            return { starred: true };
          })();
          session.writes.set(key, task);
        }
        try { return json(200, await session.writes.get(key)); } finally { session.writes.delete(key); }
      }
      throw new AccountError('NOT_FOUND', 404);
    } catch (error) { json(error instanceof AccountError ? error.status : 502, { code: error instanceof AccountError ? error.code : 'GITHUB_UNAVAILABLE' }); }
  }
}
