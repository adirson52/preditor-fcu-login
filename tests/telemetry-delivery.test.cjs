const test=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const context={module:{exports:{}},Map,Date,JSON,AbortSignal,setTimeout};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../telemetry-delivery.js'),'utf8'),context);
const create=context.module.exports;
function storage(){const m=new Map();return {get length(){return m.size},key:i=>[...m.keys()][i],getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),m};}
function fixture(store=storage()){
 const f={time:Date.now(),session:null,allowed:true,enabled:true,online:true,sends:[],response:()=>new Response('{"accepted":true}',{status:200})};
 const client={auth:{getSession:async()=>({data:{session:f.session}}),onAuthStateChange(){}},rpc:async()=>({data:{user_id:f.session?.user.id,session_valid:true,account_status:'active',products:[{id:'login',allowed:f.allowed}]}})};
 f.queue=create({storage:store,endpoint:'https://master.invalid/api/collect',now:()=>f.time,enabled:()=>f.enabled,online:()=>f.online,getClient:()=>client,fetch:async(url,opts)=>{f.sends.push({event:JSON.parse(opts.body),token:opts.headers.Authorization});return f.response();}});
 f.store=store;
 f.login=async id=>{f.time+=50000;f.session={user:{id},access_token:'secret-'+id};await f.queue.check();};
 f.event=(id='event_1234567890123456')=>({event_id:id,session_id:'session_1234567890123456',visitor_id:'visitor_1234567890123456',event_name:'cell_open',user_id:f.queue.userId(),occurred_at:new Date(f.time).toISOString(),properties:{}});
 f.settle=async()=>{await new Promise(setImmediate);await f.queue.flush();};
 return f;
}
test('anonymous startup and unapproved product never queue activity',async()=>{
 const f=fixture();await f.queue.check();assert.equal(f.queue.enqueue(f.event()),false);assert.equal(f.sends.length,0);
 f.allowed=false;await f.login('one');assert.equal(f.queue.userId(),'');assert.equal(f.queue.enqueue(f.event()),false);
});
test('network retry retains stable event id and timestamp across reload, never persists a token',async()=>{
 const f=fixture();await f.login('one');f.online=false;const event=f.event();
 assert.equal(f.queue.enqueue(event),true);assert.equal(f.queue.pending(),1);
 assert.doesNotMatch([...f.store.m.values()].join(''),/secret-one|access_token/);
 const g=fixture(f.store);await g.login('one');await g.queue.flush();
 assert.equal(g.sends.length,1);assert.deepEqual(g.sends[0].event,event);assert.equal(g.queue.pending(),0);
});
test('account switch cannot send another account queue; it remains available to original account',async()=>{
 const f=fixture();await f.login('one');f.online=false;f.queue.enqueue(f.event());
 await f.login('two');f.online=true;await f.queue.flush();assert.equal(f.sends.length,0);
 await f.login('one');await f.queue.flush();assert.equal(f.sends[0].event.user_id,'one');assert.equal(f.sends[0].token,'Bearer secret-one');
});
test('unacknowledged response retries, revoked identity pauses, privacy revocation clears only analytics',async()=>{
 const f=fixture();f.store.setItem('perceptions','keep');await f.login('one');
 f.response=()=>new Response('{}',{status:503});f.queue.enqueue(f.event());await f.settle();assert.equal(f.queue.pending(),1);
 const original=f.sends[0].event;f.time+=120000;f.response=()=>new Response('{"accepted":true,"duplicate":true}');await f.queue.flush();assert.deepEqual(f.sends.at(-1).event,original);assert.equal(f.queue.pending(),0);
 f.online=false;f.queue.enqueue(f.event('event_2234567890123456'));f.enabled=false;await f.queue.flush();assert.equal(f.queue.pending(),0);assert.equal(f.store.getItem('perceptions'),'keep');
});
test('queue is bounded, expires old records, and survives unavailable storage',async()=>{
 const f=fixture();await f.login('one');f.online=false;
 for(let i=0;i<510;i++)f.queue.enqueue(f.event('event_'+String(i).padStart(20,'0')));
 assert.equal(f.queue.pending(),500);f.time+=8*86400000;assert.equal(f.queue.pending(),0);
 const g=fixture({get length(){throw Error('disabled')},setItem(){throw Error('disabled')}});await g.login('one');g.online=false;g.queue.enqueue(g.event());assert.equal(g.queue.pending(),1);g.online=true;await g.queue.flush();assert.equal(g.queue.pending(),0);
});
