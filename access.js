(async function(){
'use strict';
const cfg=window.FCUAccessConfig,$=s=>document.querySelector(s),master='https://preditor-fcu-master.vercel.app/api/access';
const client=window.supabase.createClient('https://rreagceersvnbmmvstzf.supabase.co','sb_publishable_RDHoY0_ixV4SxEvCUwwnhQ_bqyXjUPf',{auth:{storageKey:cfg.storageKey,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
let products=[],session=null,busy=false,currentView='login',productTitle=cfg.title,accountState=null,recoverySession=false;
const requestedView=new URL(location.href).searchParams.get('view');
function message(text,error=false){$('#message').textContent=text;$('#message').classList.toggle('error',error);}
function clearPasswords(form){form.querySelectorAll('input[type=password],.password-field input').forEach(input=>{input.value='';input.type='password';});form.querySelectorAll('[data-reveal]').forEach(b=>{b.textContent='Mostrar';b.setAttribute('aria-pressed','false');});}
function confirmation(title,text){$('#confirmation-title').textContent=title;$('#confirmation-text').textContent=text;$('#confirmation').showModal();}
$('#confirmation-close').onclick=()=>$('#confirmation').close();
function view(name){
 if(accountState?.password_change_required&&!['password','recovery','blocked','pending'].includes(name))name='password';
 currentView=name;
 document.querySelectorAll('#views>form,#views>div').forEach(el=>el.hidden=el.id!==name+'-form');message('');
 $('#product-title').textContent=({login:productTitle,account:productTitle,request:'Solicitar acesso',recovery:'Recuperar minha senha',password:'Minha senha',denied:'Acesso não liberado',pending:'Solicitação em análise',blocked:'Acesso indisponível'})[name];
 $('#view-description').textContent=['login','account'].includes(name)?'Use a conta liberada pela equipe.':'';
 $('#access-action').value=['request','recovery'].includes(name)?name:'login';
 $('.action-picker').hidden=['password','pending','blocked','account','denied'].includes(name);
 $('#public-help').hidden=!['login','request','recovery'].includes(name);
 const request=$('#request-form'),signedIn=!!session;
 $('#request-passwords').hidden=signedIn;$('#request-passwords').disabled=signedIn;$('#request-account-note').hidden=!signedIn;
 request.elements.email.readOnly=signedIn;
 if(signedIn){
  const meta=session.user.user_metadata||{};
  request.elements.email.value=session.user.email||'';
  if(!request.elements.full_name.value)request.elements.full_name.value=meta.full_name||meta.name||'';
  if(!request.elements.institution.value)request.elements.institution.value=meta.institution||'';
  clearPasswords(request);
 }
 if(name==='recovery'&&session)$('#recovery-form').elements.email.value=session.user.email||'';
 const forced=accountState?.password_change_required===true||recoverySession;
 $('#current-password-field').hidden=forced;$('#password-form').elements.current_password.disabled=forced;
 const termsRequired=accountState?.terms_required===true;$('#password-terms').hidden=!termsRequired;$('#password-form').elements.terms.disabled=!termsRequired;
 $('#password-description').textContent=forced?'Antes de continuar, escolha sua senha pessoal. A equipe não poderá vê-la.':'Para sua segurança, informe sua senha atual e escolha a nova. A equipe não poderá vê-la.';
}
function setTitle(title){productTitle=title;document.title=title+' · Acesso';document.querySelectorAll('[data-request-target]').forEach(el=>el.textContent=title);$('#enter-label').textContent='Entrar';view(currentView);}
setTitle(cfg.title);
function consent(){try{return JSON.parse(localStorage.getItem('fcu_privacy_v1')||'null')?.choice;}catch{return null;}}
$('#privacy').hidden=!!consent();$('#privacy-choice').onclick=()=>$('#privacy').hidden=false;
document.querySelectorAll('[data-consent]').forEach(b=>b.onclick=()=>{try{localStorage.setItem('fcu_privacy_v1',JSON.stringify({choice:b.dataset.consent,at:new Date().toISOString()}));$('#privacy').hidden=true;}catch{message('Não foi possível guardar sua preferência neste navegador.',true);}});
async function api(body){
 const r=await fetch(master,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.access_token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});
 const data=await r.json();if(!r.ok){const error=Error(data.error||'Não foi possível concluir.');error.code=data.code;throw error;}return data;
}
function destination(){const raw=new URL(location.href).searchParams.get('next')||'/';try{const u=new URL(raw,location.origin);if(u.origin===location.origin&&!/^\/(acesso|entrar|login)(\/|\.|$)/.test(u.pathname))return u.pathname+u.search+u.hash;}catch{}return '/';}
async function refreshSession(){const result=await client.auth.getSession();if(result.error)throw Error('Não foi possível confirmar sua sessão. Tente entrar novamente.');session=result.data.session;if(!session){accountState=null;recoverySession=false;}return session;}
async function hasAccess(){
 // Only trusted server state decides this UI; protected routes independently enforce it.
 const result=await client.rpc('fcu_my_products').abortSignal(AbortSignal.timeout(15000));
 if(result.error)throw Error('Não foi possível verificar seu acesso agora. Tente novamente.');
 accountState=result.data;
 if(['suspended','deleted'].includes(accountState?.account_status)){view('blocked');$('#blocked-description').textContent=accountState.account_status==='deleted'?'Esta conta foi desativada.':'O acesso desta conta está suspenso.';return false;}
 if(accountState?.account_status==='pending'){view('pending');return false;}
 if(accountState?.password_expired){view('blocked');$('#blocked-description').textContent='Sua senha temporária expirou. Peça uma nova recuperação à equipe.';return false;}
 if(accountState?.session_valid!==true)throw Error('Sua sessão não está válida. Entre novamente ou peça ajuda à equipe.');
 if(accountState?.password_change_required){view('password');return false;}
 const product=accountState.products?.find(p=>p.id===cfg.id);
 if((product?.allowed===true||product?.public===true)&&accountState.access_ready!==false)return true;
 view('denied');return false;
}
async function enter(){
 if(!await refreshSession())throw Error('Entre com sua conta para continuar.');
 if(!await hasAccess())return;
 const r=await fetch(cfg.sessionEndpoint||'/api/access-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access_token:session.access_token,analytics_consent:consent()==='analytics'}),signal:AbortSignal.timeout(20000)});
 const data=await r.json();
 if(r.status===403){if(await hasAccess())view('denied');return;}
 if(!r.ok)throw Error(data.error||'Não foi possível confirmar sua permissão.');
 if(consent()==='analytics'&&!cfg.usageTracking)api({action:'event',product_id:cfg.id,id:crypto.randomUUID(),session_id:crypto.randomUUID(),event_name:'product_open',path:destination(),analytics_consent:true,device_type:innerWidth<768?'mobile':'desktop'}).catch(()=>{});
 location.assign(destination());
}
async function run(form,fn){
 if(busy)return;busy=true;
 const controls=[...form.querySelectorAll('button'),$('#destination'),$('#access-action'),...document.querySelectorAll('[data-view]')];controls.forEach(b=>b.disabled=true);form.setAttribute('aria-busy','true');
 try{await fn();}catch(e){message(e.name==='TimeoutError'?'A conexão demorou mais que o esperado. Confira sua internet e tente novamente.':e.message,true);}finally{busy=false;controls.forEach(b=>b.disabled=false);form.removeAttribute('aria-busy');}
}
async function logout(){
 const r=await fetch(cfg.sessionEndpoint||'/api/access-session',{method:'DELETE',signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('Não foi possível encerrar a sessão. Tente novamente.');
 const result=await client.auth.signOut({scope:'local'});if(result.error)throw Error('Não foi possível sair. Tente novamente.');
 session=null;accountState=null;recoverySession=false;document.querySelectorAll('#views form').forEach(f=>{f.reset();clearPasswords(f);});view('login');
}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{if(!busy)view(b.dataset.view);});
document.querySelectorAll('[data-logout]').forEach(b=>b.onclick=()=>run(b.closest('#views>div,#views>form'),logout));
document.querySelectorAll('[data-reveal]').forEach(b=>b.onclick=()=>{const input=b.closest('.password-field').querySelector('input');input.type=input.type==='password'?'text':'password';b.textContent=input.type==='password'?'Mostrar':'Ocultar';b.setAttribute('aria-pressed',String(input.type!=='password'));});
$('#access-action').onchange=()=>view($('#access-action').value);
$('#destination').onchange=()=>{const p=products.find(p=>p.id===$('#destination').value);if(!p)return;const u=new URL(p.url);if(u.protocol==='https:'&&/^[a-z0-9-]+\.vercel\.app$/.test(u.hostname)&&!u.username&&!u.password)location.assign(p.public?u.href:u.origin+'/acesso');};
$('#login-form').onsubmit=e=>{e.preventDefault();run(e.target,async()=>{try{const f=new FormData(e.target);const r=await client.auth.signInWithPassword({email:String(f.get('email')).trim(),password:f.get('password')});if(r.error)throw Error(/Invalid login credentials/.test(r.error.message)?'E-mail ou senha incorretos.':/Email not confirmed/.test(r.error.message)?'O cadastro ainda aguarda liberação da equipe.':r.error.message);session=r.data.session;if(requestedView==='password'){await hasAccess();if(!['blocked','pending'].includes(currentView))view('password');}else await enter();}finally{clearPasswords(e.target);}});};
for(const kind of ['request','recovery'])$('#'+kind+'-form').onsubmit=e=>{
 e.preventDefault();run(e.target,async()=>{
  const f=Object.fromEntries(new FormData(e.target)),email=f.email;
  try{
   await refreshSession();
   if(kind==='request'&&!session&&f.password!==f.password_confirmation)throw Error('As senhas não coincidem.');
   if(session){delete f.password;delete f.password_confirmation;}
   const r=await api({...f,action:'request',kind:kind==='request'?'access':'recovery',product_id:cfg.id,terms_accepted:f.terms==='on'});
   e.target.reset();view(session?'account':'login');$('#login-form').elements.email.value=email||'';message(r.message||'Solicitação recebida pela equipe.');
   confirmation(kind==='request'?'Solicitação enviada':'Pedido de recuperação enviado',kind==='request'?'A equipe do CEFAVELA avaliará sua solicitação e entrará em contato por e-mail. O acesso ainda não está liberado.':'A equipe conferirá sua identidade e entrará em contato para orientar a recuperação.');
  }catch(error){if(error.code==='existing_account'){view('login');$('#login-form').elements.email.value=email||'';}throw error;}finally{clearPasswords(e.target);delete f.password;delete f.password_confirmation;}
 });
};
$('#password-form').onsubmit=e=>{
 e.preventDefault();run(e.target,async()=>{
  const f=Object.fromEntries(new FormData(e.target));
  try{if(f.password!==f.password_confirmation)throw Error('As senhas não coincidem.');await refreshSession();if(!session)throw Error('Entre com sua conta para trocar a senha.');await api({action:'change-password',...f,terms_accepted:f.terms==='on'});await logout();message('Senha alterada. Entre com sua nova senha.');confirmation('Senha alterada','Sua senha pessoal foi atualizada. A equipe não consegue vê-la. Entre novamente com a nova senha.');}finally{clearPasswords(e.target);delete f.password;delete f.password_confirmation;delete f.current_password;}
 });
};
$('#continue').onclick=()=>run($('#account-form'),enter);$('#check-approval').onclick=()=>run($('#pending-form'),enter);
async function loadCatalog(){
 const catalog=await client.from('fcu_products').select('id,title,url,is_public').eq('active',true).eq('listed',true).order('display_order');
 if(catalog.error)throw Error('Não foi possível carregar os produtos. Tente novamente.');
 products=catalog.data.map(p=>({...p,public:p.is_public}));
 $('#destination').replaceChildren(...products.map(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.title;return o;}));
 const current=products.find(p=>p.id===cfg.id);
 if(current){$('#destination').value=cfg.id;setTitle(current.title);}else{const o=document.createElement('option');o.value='';o.textContent='Escolher outro produto';o.disabled=true;$('#destination').prepend(o);$('#destination').value='';}
}
await loadCatalog().catch(e=>{const o=document.createElement('option');o.textContent=cfg.title;$('#destination').replaceChildren(o);message(e.message,true);});
try{
 const recovery=new URLSearchParams(location.hash.slice(1)).get('recovery');
 if(recovery){history.replaceState(null,'',location.pathname+location.search);const r=await client.auth.verifyOtp({type:'recovery',token_hash:recovery});if(r.error)throw Error('O link de redefinição expirou ou já foi usado. Solicite um novo link.');session=r.data.session;recoverySession=true;await hasAccess();if(!['blocked','pending'].includes(currentView))view('password');}
 else if(await refreshSession()){
  $('#account-name').textContent='Conectado como '+session.user.email;view('account');await hasAccess();
  if(!['blocked','pending','password'].includes(currentView)&&['request','recovery','password'].includes(requestedView))view(requestedView);
 }else if(['request','recovery'].includes(requestedView))view(requestedView);
}catch(e){message(e.message,true);}
})();
