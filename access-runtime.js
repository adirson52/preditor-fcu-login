(function(){
 function start(){
 const cfg=window.FCUAccessConfig;
 if(!cfg)return;
 const client=window.PreditorAuth?.client || (cfg.standalone && window.supabase?.createClient('https://rreagceersvnbmmvstzf.supabase.co','sb_publishable_RDHoY0_ixV4SxEvCUwwnhQ_bqyXjUPf',{auth:{storageKey:cfg.storageKey,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}}));
 if(!client)return;
 window.FCUAccessClient=client;
 if(cfg.standalone&&!document.querySelector('a[href="/acesso"]')){
  const link=document.createElement('a');link.href='/acesso';link.textContent='Minha conta · Trocar produto';
  link.style.cssText='position:fixed;bottom:8px;right:12px;z-index:999;background:white;border:1px solid #ccd9df;border-radius:8px;padding:8px 12px;color:#10465b;font:13px sans-serif';
  document.body.append(link);
 }
 let syncing=false;
 async function sync(){
  if(syncing||navigator.onLine===false)return;syncing=true;
  try{
   const session=(await client.auth.getSession()).data.session;
   if(!session){await fetch(cfg.sessionEndpoint||'/api/access-session',{method:'DELETE'});location.assign('/acesso?next='+encodeURIComponent(location.pathname+location.search));return;}
   const r=await fetch(cfg.sessionEndpoint||'/api/access-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access_token:session.access_token})});
   if(r.status===401||r.status===403)location.assign('/acesso?next='+encodeURIComponent(location.pathname+location.search));
  }catch{}finally{syncing=false;}
 }
 client.auth.onAuthStateChange(()=>setTimeout(sync,0));
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});
 window.addEventListener('online',sync);setInterval(sync,60000);sync();
 // Keep the existing account/perception UI. Anonymous entry and registration use the standard page.
 document.addEventListener('click',e=>{const b=e.target.closest('[data-auth-view]');if(b&&['login','register','reset'].includes(b.dataset.authView)){e.preventDefault();e.stopImmediatePropagation();location.assign('/acesso');}},true);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
