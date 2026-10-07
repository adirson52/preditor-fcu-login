// No administrative key: validation runs as the participant, with database RLS.
export const AUTH_URL='https://rreagceersvnbmmvstzf.supabase.co';
export const PUBLIC_KEY='sb_publishable_RDHoY0_ixV4SxEvCUwwnhQ_bqyXjUPf';
export const COOKIE='__Host-fcu_access';
export function cookieToken(request){
 const raw=request.headers.get('cookie')||'';
 return raw.split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';
}
export function validToken(token){return typeof token==='string'&&/^[A-Za-z0-9_.-]{20,8192}$/.test(token);}
export async function permissions(token,transport=fetch){
 if(!validToken(token))return {status:401};
 try{
  const r=await transport(AUTH_URL+'/rest/v1/rpc/fcu_my_products',{method:'POST',cache:'no-store',headers:{apikey:PUBLIC_KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(7000)});
  if(!r.ok)return {status:r.status>=500?503:401};
  const me=await r.json();
  return me.session_valid===true?{status:200,me}:{status:401};
 }catch{return {status:503};}
}
export function allows(me,product){
 // These fields come from the trusted database RPC, never editable user_metadata.
 // Missing lifecycle fields remain compatible during the coordinated rollout.
 if(!me||me.session_valid===false||me.access_ready===false||me.password_change_required===true||me.password_expired===true)return false;
 if(me.account_status&&me.account_status!=='active')return false;
 return me.products?.some(p=>p.id===product&&p.allowed===true)===true;
}
export function safeReturn(value){
 try{const u=new URL(value,'https://return.invalid');return u.origin==='https://return.invalid'&&!u.pathname.startsWith('/acesso')?u.pathname+u.search+u.hash:'/';}catch{return '/';}
}
export function sessionHandler(product){
 return async function(req,res){
  res.setHeader('Cache-Control','no-store');
  const origin=req.headers.origin,host=req.headers.host;
  if(origin!=='https://'+host && origin!=='http://'+host){res.statusCode=403;return res.end(JSON.stringify({error:'Origem não autorizada.'}));}
  if(req.method==='DELETE'){res.setHeader('Set-Cookie',COOKIE+'=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');res.statusCode=200;return res.end('{}');}
  if(req.method!=='POST'){res.statusCode=405;return res.end('{}');}
  let body=req.body;
  if(typeof body==='string'){try{body=JSON.parse(body);}catch{body={};}}
  const result=await permissions(body?.access_token);
  if(result.status!==200||!allows(result.me,product)){
   res.setHeader('Set-Cookie',COOKIE+'=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
   res.statusCode=result.status===200?403:result.status;
   const code=result.me?.password_change_required?'PASSWORD_CHANGE_REQUIRED':result.me?.account_status==='pending'?'ACCOUNT_PENDING':res.statusCode===403?'PRODUCT_ACCESS_REQUIRED':'SESSION_INVALID';
   return res.end(JSON.stringify({code,error:code==='PASSWORD_CHANGE_REQUIRED'?'Atualize sua senha para continuar.':code==='ACCOUNT_PENDING'?'Sua solicitação está aguardando análise da equipe.':res.statusCode===403?'Sua conta ainda não tem acesso a este produto. Solicite a liberação.':'Não foi possível validar a sessão.'}));
  }
  // The JWT itself is checked by Supabase. Expiry is never trusted for authorization.
  let exp=0;try{exp=JSON.parse(Buffer.from(body.access_token.split('.')[1],'base64url')).exp;}catch{}
  const age=Math.max(1,Math.min(3600,exp-Math.floor(Date.now()/1000)));
  res.setHeader('Set-Cookie',COOKIE+'='+body.access_token+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+age);
  res.setHeader('Content-Type','application/json');res.statusCode=200;res.end(JSON.stringify({ok:true,user_id:result.me.user_id}));
 };
}
export function protect(product,next,{transport=fetch,now=Date.now}={}){
 // Short, per-token cache bounds revocation latency without a database call per map tile.
 const verified=new Map();
 return async function(request){
  const url=new URL(request.url);
  const open=['/acesso','/acesso.html','/access.js','/access.css','/access-config.js','/api/access-session','/termos','/termos.html','/privacidade','/privacidade.html','/favicon.ico','/robots.txt'];
  if(open.includes(url.pathname)||url.pathname.startsWith('/_vercel/'))return next();
  const api=url.pathname.startsWith('/api/');
  const isPage=!api&&(request.headers.get('sec-fetch-dest')==='document'||request.headers.get('accept')?.includes('text/html')||!url.pathname.split('/').at(-1).includes('.'));
  const sensitive=api||isPage||!['GET','HEAD'].includes(request.method);
  const token=cookieToken(request),cached=verified.get(token);
  const hit=!sensitive&&cached?.until>now();
  const result=hit?cached.result:await permissions(token,transport);
  // Fixed TTL from the real verification: requests never extend cached authorization.
  if(!hit){
   verified.delete(token);
   if(result.status===200){if(verified.size>=100)verified.clear();verified.set(token,{until:now()+15000,result});}
  }
  if(result.status===200&&allows(result.me,product))return next();
  if(result.status===503)return new Response('Não foi possível verificar o acesso. Tente novamente.',{status:503,headers:{'Cache-Control':'no-store','Retry-After':'10'}});
  if(isPage){const dest=new URL('/acesso',url);dest.searchParams.set('next',safeReturn(url.pathname+url.search));return new Response(null,{status:303,headers:{Location:dest.href,'Cache-Control':'private, no-store'}});}
  return new Response('Acesso restrito',{status:result.status===200?403:401,headers:{'Cache-Control':'no-store'}});
 };
}
