(async function(){
'use strict';
const cfg=window.FCUAccessConfig,$=s=>document.querySelector(s),master='https://preditor-fcu-master.vercel.app/api/access';
document.title=cfg.title+' · Acesso';
const welcome=cfg.id==='laboratorio'?'Bem-vindo ao laboratório':'Bem-vindo ao '+cfg.title;
$('#product-title').textContent=welcome;
$('#enter-label').textContent=cfg.id==='laboratorio'?'Entrar no laboratório':'Entrar no produto';
document.querySelectorAll('[data-request-target]').forEach(el=>el.textContent=cfg.title);
const client=window.supabase.createClient('https://rreagceersvnbmmvstzf.supabase.co','sb_publishable_RDHoY0_ixV4SxEvCUwwnhQ_bqyXjUPf',{auth:{storageKey:cfg.storageKey,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
let products=[],session=null,busy=false;
function message(text,error=false){$('#message').textContent=text;$('#message').classList.toggle('error',error);}
function view(name){document.querySelectorAll('#views>form,#views>div').forEach(el=>el.hidden=el.id!==name+'-form');message('');$('#product-title').textContent=({login:welcome,account:cfg.title,request:'Solicitar acesso',recovery:'Recuperar minha senha',password:'Minha senha'})[name];$('#view-description').textContent=['login','account'].includes(name)?'Use a conta liberada pela equipe.':'';for(const tab of ['login','request'])$('#tab-'+tab).setAttribute('aria-selected',String(tab==='request'?name==='request':name!=='request'));}
function consent(){try{return JSON.parse(localStorage.getItem('fcu_privacy_v1')||'null')?.choice;}catch{return null;}}
$('#privacy').hidden=!!consent();$('#privacy-choice').onclick=()=>$('#privacy').hidden=false;
document.querySelectorAll('[data-consent]').forEach(b=>b.onclick=()=>{localStorage.setItem('fcu_privacy_v1',JSON.stringify({choice:b.dataset.consent,at:new Date().toISOString()}));$('#privacy').hidden=true;});
async function api(body){
 const r=await fetch(master,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.access_token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
 const data=await r.json();if(!r.ok)throw Error(data.error||'Não foi possível concluir.');return data;
}
function destination(){
 const raw=new URL(location.href).searchParams.get('next')||'/';
 try{const u=new URL(raw,location.origin);if(u.origin===location.origin&&!u.pathname.startsWith('/acesso'))return u.pathname+u.search+u.hash;}catch{}return '/';
}
async function enter(){
 session=(await client.auth.getSession()).data.session;
 if(!session)throw Error('Entre com sua conta para continuar.');
 const r=await fetch(cfg.sessionEndpoint||'/api/access-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access_token:session.access_token,analytics_consent:consent()==='analytics'})});
 const data=await r.json();if(!r.ok)throw Error(data.error||'Não foi possível confirmar sua permissão.');
 if(consent()==='analytics')api({action:'event',product_id:cfg.id,id:crypto.randomUUID(),session_id:crypto.randomUUID(),event_name:'product_open',path:destination(),analytics_consent:true,device_type:innerWidth<768?'mobile':'desktop'}).catch(()=>{});
 location.assign(destination());
}
async function run(form,fn){if(busy)return;busy=true;const buttons=form.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);try{await fn();}catch(e){message(e.message,true);}finally{busy=false;buttons.forEach(b=>b.disabled=false);}}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));
document.querySelector('[data-reveal]').onclick=e=>{const i=$('#login-form input[name=password]');i.type=i.type==='password'?'text':'password';e.target.textContent=i.type==='password'?'Mostrar':'Ocultar';e.target.setAttribute('aria-pressed',String(i.type!=='password'));};
document.querySelector('.tabs').onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const next=$('#tab-login').getAttribute('aria-selected')==='true'?'request':'login';view(next);$('#tab-'+next).focus();}};
$('#destination').onchange=()=>{const p=products.find(p=>p.id===$('#destination').value);if(!p)return;const u=new URL(p.url);if(u.protocol==='https:'&&/^[a-z0-9-]+\.vercel\.app$/.test(u.hostname))location.assign(p.public?u.href:u.origin+'/acesso');};
$('#login-form').onsubmit=e=>{e.preventDefault();run(e.target,async()=>{const f=new FormData(e.target);const r=await client.auth.signInWithPassword({email:String(f.get('email')).trim(),password:f.get('password')});if(r.error)throw Error(/Invalid login credentials/.test(r.error.message)?'E-mail ou senha incorretos.':r.error.message);session=r.data.session;if(session.user.user_metadata?.must_change_password){view('password');return;}await enter();});};
for(const kind of ['request','recovery'])$('#'+kind+'-form').onsubmit=e=>{e.preventDefault();run(e.target,async()=>{const f=Object.fromEntries(new FormData(e.target));const r=await api({...f,action:'request',kind:kind==='request'?'access':'recovery',product_id:cfg.id,terms_accepted:f.terms==='on'});e.target.reset();view('login');message(r.message);});};
$('#password-form').onsubmit=e=>{e.preventDefault();run(e.target,async()=>{const f=new FormData(e.target);if(f.get('password')!==f.get('confirmation'))throw Error('As senhas não coincidem.');session=(await client.auth.getSession()).data.session;await api({action:'change-password',password:f.get('password')});await client.auth.signOut({scope:'local'});await fetch(cfg.sessionEndpoint||'/api/access-session',{method:'DELETE'});session=null;e.target.reset();view('login');message('Senha alterada. Entre com sua nova senha.');});};
$('#continue').onclick=()=>run($('#account-form'),enter);
$('#logout').onclick=async()=>{await client.auth.signOut({scope:'local'});await fetch(cfg.sessionEndpoint||'/api/access-session',{method:'DELETE'});session=null;view('login');};
try{
 // The public catalogue contains no accounts. It also works on a staged product deployment.
 const catalog=await client.from('fcu_products').select('id,title,url,is_public').eq('active',true).eq('listed',true).order('display_order');
 if(catalog.error)throw Error('Não foi possível carregar os produtos. Tente novamente.');
 products=catalog.data.map(p=>({...p,public:p.is_public}));
 $('#destination').replaceChildren(...products.map(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.title;return o;}));$('#destination').value=cfg.id;
 const recovery=new URLSearchParams(location.hash.slice(1)).get('recovery');
 if(recovery){history.replaceState(null,'',location.pathname+location.search);const r=await client.auth.verifyOtp({type:'recovery',token_hash:recovery});if(r.error)throw Error('O link de redefinição expirou ou já foi usado. Solicite um novo link.');session=r.data.session;view('password');}
 else{session=(await client.auth.getSession()).data.session;if(session){$('#account-name').textContent='Conectado como '+session.user.email;view('account');}}
}catch(e){message(e.message,true);}
})();
