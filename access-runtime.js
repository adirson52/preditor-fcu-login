(function(){
 function start(){
 const cfg=window.FCUAccessConfig;
 if(!cfg)return;
 const client=window.PreditorAuth?.client || (cfg.standalone && window.supabase?.createClient('https://rreagceersvnbmmvstzf.supabase.co','sb_publishable_RDHoY0_ixV4SxEvCUwwnhQ_bqyXjUPf',{auth:{storageKey:cfg.storageKey,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}}));
 if(!client)return;
 let syncing=false;
 async function sync(){
  if(syncing||navigator.onLine===false)return;syncing=true;
  try{
   const session=(await client.auth.getSession()).data.session;
   if(!session){await fetch('/api/access-session',{method:'DELETE'});location.assign('/acesso?next='+encodeURIComponent(location.pathname+location.search));return;}
   const r=await fetch('/api/access-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access_token:session.access_token})});
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
