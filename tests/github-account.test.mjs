import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../server.mjs';
import { GitHubAccount } from '../core/github-account.mjs';

async function fixture(t,{starStatus=204,delayStar=false}={}){
  const calls=[];let release;const gate=new Promise(resolve=>{release=resolve;});
  const account=new GitHubAccount({clientId:'synthetic-client',clientSecret:'synthetic-secret',fetchImpl:async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/access_token'))return Response.json({access_token:'synthetic-user-token'});
    if(url.endsWith('/user'))return Response.json({login:'synthetic-user'});
    if(url.includes('/repos/'))return Response.json({private:false});
    if(options.method==='PUT'&&delayStar)await gate;
    return new Response(null,{status:options.method==='PUT'?starStatus:404});
  }});
  const server=createServer({githubAccount:account});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const origin='http://127.0.0.1:'+server.address().port;account.origin=origin;
  let cookie='',csrf='';
  const request=async(path,method='GET',headers={})=>{
    const response=await fetch(origin+'/api/github/'+path,{method,redirect:'manual',headers:{Cookie:cookie,...(method==='GET'?{}:{Origin:origin,'X-GitHok-CSRF':csrf}),...headers}});
    const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return response;
  };
  async function session(){const response=await request('session');const data=await response.json();csrf=data.csrf;return{response,data};}
  async function login(){await session();const result=await(await request('login','POST')).json();const url=new URL(result.url);const callback=await request('callback?code=synthetic-code&state='+url.searchParams.get('state'));assert.equal(callback.status,303);await session();return url;}
  return{account,request,session,login,calls,release,getCookie:()=>cookie,getCsrf:()=>csrf,origin};
}

test('OAuth uses state and PKCE, validates identity, rotates cookies and exposes no credentials',async t=>{
  const f=await fixture(t);const {response,data}=await f.session();const oldCookie=f.getCookie();
  assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);assert.equal(data.authenticated,false);
  const url=await f.login();assert.equal(url.origin,'https://github.com');assert.equal(url.searchParams.get('scope'),'public_repo');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('code_challenge').length,43);
  assert.notEqual(oldCookie,f.getCookie());
  const logged=await f.session();assert.equal(logged.data.user.login,'synthetic-user');assert.equal(logged.data.authenticated,true);
  assert.doesNotMatch(JSON.stringify(logged.data),/synthetic-user-token|synthetic-secret/);
  const exchange=f.calls.find(c=>c.url.endsWith('/access_token'));assert.equal(exchange.options.body.get('redirect_uri'),f.origin+'/api/github/callback');assert.ok(exchange.options.body.get('code_verifier'));
  assert.equal((await f.request('callback?code=replay&state='+url.searchParams.get('state'))).status,403);
});
test('CSRF, foreign origins, wrong callbacks and anonymous star writes are rejected without upstream writes',async t=>{
  const f=await fixture(t);await f.session();
  assert.equal((await f.request('login','POST',{'X-GitHok-CSRF':'wrong'})).status,403);
  assert.equal((await f.request('star/author/project','PUT',{Origin:'https://attacker.invalid'})).status,403);
  assert.equal((await f.request('callback?code=x&state=wrong')).status,403);
  assert.equal((await f.request('star/author/project','PUT')).status,401);
  assert.equal(f.calls.length,0);
});
test('Star PUT requires a public repository and confirmed 204, and merges concurrent writes',async t=>{
  const f=await fixture(t,{delayStar:true});await f.login();
  const one=f.request('star/author/project','PUT'),two=f.request('star/author/project','PUT');
  for(let i=0;i<100&&!f.calls.some(c=>c.options.method==='PUT');i++)await new Promise(r=>setTimeout(r,5));
  f.release();const results=await Promise.all([one,two]);
  for(const result of results){assert.equal(result.status,200);assert.deepEqual(await result.json(),{starred:true});}
  assert.equal(f.calls.filter(c=>c.options.method==='PUT').length,1);
  const write=f.calls.find(c=>c.options.method==='PUT');assert.match(write.options.headers.Authorization,/synthetic-user-token/);assert.equal(write.options.headers['Content-Length'],'0');
  assert.equal((await(await f.request('star/author/project')).json()).starred,false);
  await f.request('logout','POST');assert.equal((await f.request('star/author/project','PUT')).status,403);
});
test('upstream failures never claim success and logout forgets the token',async t=>{
  const f=await fixture(t,{starStatus:403});await f.login();
  const failed=await f.request('star/author/project','PUT');assert.equal(failed.status,403);assert.equal((await failed.json()).code,'GITHUB_FORBIDDEN');
  await f.request('logout','POST');const state=await f.session();assert.equal(state.data.authenticated,false);
  assert.ok([...f.account.sessions.values()].every(s=>!s.token));
});
test('unconfigured login has a truthful status and secure origins are required outside localhost',async t=>{
  const f=await fixture(t);f.account.enabled=false;
  const session=await f.session();assert.equal(session.data.configured,false);assert.equal((await f.request('login','POST')).status,503);
  assert.throws(()=>new GitHubAccount({origin:'http://public.example'}),/HTTPS/);
});
