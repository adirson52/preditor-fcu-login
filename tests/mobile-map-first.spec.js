const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');

const owner = '00000000-0000-4000-8000-000000000091';
const row = {
  id:'00000000-0000-4000-8000-000000000092',user_id:owner,title:'Área simulada para conferir ferramentas',status:'submitted',
  created_at:'2026-09-19T12:00:00Z',updated_at:'2026-09-19T12:00:00Z',target_kind:'polygon',action_type:'free',
  perceived_class:'atencao',perception_types:['atencao'],
  geometry:{type:'Polygon',coordinates:[[[-48.50,-1.45],[-48.49,-1.45],[-48.49,-1.44],[-48.50,-1.44],[-48.50,-1.45]]]}
};

async function ready(page) {
  const diagnostics={errors:[],database:[]};
  page.on('pageerror', e=>diagnostics.errors.push(e.message));
  await page.route('**/api/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
  await page.route('**/*.supabase.co/**',r=>{diagnostics.database.push(r.request().method());return r.abort();});
  await page.route('**/auth.js*',r=>r.fulfill({contentType:'text/javascript',body:`
    window.__mobileMapWrites=[];
    window.PreditorAuth={user:{id:${JSON.stringify(owner)},email:'map-fixture@example.test',user_metadata:{}},verifyAccount:async()=>true,track:async()=>{},trackEvent:async()=>{},
      client:{auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from(table){
        const q={filters:[],first:0,last:9999,single:false,write:false};
        const b={select(){return b;},eq(k,v){q.filters.push([k,v]);return b;},order(){return b;},range(a,z){q.first=a;q.last=z;return b;},maybeSingle(){q.single=true;return b;},
          insert(){q.write=true;return b;},update(){q.write=true;return b;},then(resolve,reject){return Promise.resolve().then(()=>{
            if(q.write){window.__mobileMapWrites.push(table);return {data:null,error:{code:'READ_ONLY_FIXTURE'}};}
            const rows=(table==='fcu_perceptions'?[${JSON.stringify(row)}]:[]).filter(row=>q.filters.every(([k,v])=>row[k]===v));
            return {data:q.single?rows[0]||null:rows.slice(q.first,q.last+1),error:null};
          }).then(resolve,reject);}};return b;
      }}
    };
  `}));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.PreditorMobile&&window.PreditorPerception?.getSyncStatus().lastLoadedAt,null,{timeout:60000});
  return diagnostics;
}
async function settle(page) {
  await expect.poll(()=>page.locator('#fcu-perception-panel').evaluate(p=>{
    const style=getComputedStyle(p),matrix=style.transform==='none'?0:new DOMMatrix(style.transform).m42;
    return Math.max(Math.abs(p.getBoundingClientRect().height-parseFloat(p.style.getPropertyValue('--fcu-sheet-height'))),Math.abs(matrix));
  })).toBeLessThan(1);
}
async function screenshot(page,info,label) {
  const path=info.outputPath(label+'.png');await page.screenshot({path,fullPage:false});await info.attach(label,{path,contentType:'image/png'});
}
async function clean(page,diagnostics) {
  expect(diagnostics).toEqual({errors:[],database:[]});
  expect(await page.evaluate(()=>window.__mobileMapWrites)).toEqual([]);
}
async function touchMove(page,element) {
  const b=await element.boundingBox(),cdp=await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:1}]});
    for(const dy of [-20,-45,-80]) {
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2+dy,id:1}]});
      await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  } finally {await cdp.detach();}
}

for(const viewport of [{width:320,height:568},{width:390,height:844},{width:768,height:1024}]) {
  test.describe(`map-first ${viewport.width}`,()=>{
    test.use({viewport,hasTouch:true,isMobile:true});
    test('dock preserva mapa; lista explícita fecha popup e recolhe sem trocar contexto',async({page},info)=>{
      const diagnostics=await ready(page);
      await page.locator('[data-fcu-screen="perception"]').tap();
      await expect(page.locator('#fcu-perception-panel')).toHaveAttribute('data-mobile-sheet','peek');
      await settle(page);
      const map=await page.locator('#map').boundingBox(),panel=await page.locator('#fcu-perception-panel').boundingBox();
      expect(panel.height).toBeLessThanOrEqual(61);
      expect((panel.y-map.y)/map.height).toBeGreaterThan(.70);
      for(const selector of ['.fcu-sheet-handle','.fcu-sheet-draw','.fcu-sheet-close']) {
        const box=await page.locator(selector).boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);expect(box.width).toBeGreaterThanOrEqual(44);
        await expect(page.locator(selector)).toBeInViewport({ratio:.99});
      }
      await screenshot(page,info,'after-dock');
      const center=await page.evaluate(()=>{const map=window.PreditorApp.map;L.popup().setLatLng(map.getCenter()).setContent('Célula simulada').openOn(map);return map.getCenter();});
      await page.locator('.fcu-sheet-handle').tap();
      await expect(page.locator('#fcu-perception-panel')).toHaveAttribute('data-mobile-sheet','expanded');
      await expect(page.locator('.leaflet-popup')).toHaveCount(0);
      await settle(page);
      await expect(page.locator('#fcu-perception-list [data-shape]')).toBeVisible();
      await page.locator('.fcu-sheet-handle').tap();
      await expect(page.locator('#fcu-perception-panel')).toHaveAttribute('data-mobile-sheet','peek');
      await settle(page);
      expect(await page.evaluate(center=>window.PreditorApp.map.project(center).distanceTo(window.PreditorApp.map.project(window.PreditorApp.map.getCenter())),center)).toBeLessThan(2);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await clean(page,diagnostics);
    });

    test('desenho usa linha de 56px, Mais revela opções e alça continua arrastável',async({page},info)=>{
      const diagnostics=await ready(page);
      await page.locator('[data-fcu-screen="perception"]').tap();await settle(page);
      await page.locator('.fcu-sheet-draw').tap();
      const bar=page.locator('#fcu-perception-drawnote');
      await expect(bar).toHaveAttribute('data-mobile-tools','collapsed');
      const before=await bar.boundingBox();expect(before.height).toBeLessThanOrEqual(60);
      for(const selector of ['.fcu-gis-head','.fcu-mobile-tools-toggle','#fcu-cancel','#fcu-finish']) {
        const box=await bar.locator(selector).boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);expect(box.width).toBeGreaterThanOrEqual(44);
        await expect(bar.locator(selector)).toBeInViewport({ratio:.99});
      }
      await expect(page.locator('#fcu-mode-freehand')).not.toBeVisible();
      await screenshot(page,info,'after-toolbar');
      const center=await page.evaluate(()=>window.PreditorApp.map.getCenter());
      await touchMove(page,bar.locator('.fcu-gis-head'));
      expect((await bar.boundingBox()).y).toBeLessThan(before.y-40);
      expect(await page.evaluate(center=>window.PreditorApp.map.project(center).distanceTo(window.PreditorApp.map.project(window.PreditorApp.map.getCenter())),center)).toBeLessThan(2);
      await bar.locator('.fcu-mobile-tools-toggle').tap();
      await expect(page.locator('#fcu-mode-freehand')).toBeVisible();await expect(page.locator('#fcu-undo')).toBeVisible();await expect(page.locator('#fcu-clear')).toBeVisible();
      await screenshot(page,info,'after-more');
      await page.locator('#fcu-mode-freehand').tap();
      await expect(bar).toHaveAttribute('data-mobile-tools','collapsed');
      await expect(page.locator('#fcu-mode-freehand')).toHaveClass(/is-active/);
      await page.locator('#fcu-cancel').tap();
      await expect(bar).toHaveCount(0);await expect(page.locator('#fcu-perception-panel')).toHaveAttribute('data-mobile-sheet','peek');
      await clean(page,diagnostics);
    });

    test('editor mantém OK e cancelar, com adicionar remover e excluir sob Mais',async({page},info)=>{
      const diagnostics=await ready(page);
      await page.evaluate(()=>window.PreditorApp.map.setView([-1.445,-48.495],15,{animate:false}));
      await page.locator('[data-fcu-screen="perception"]').tap();await settle(page);await page.locator('.fcu-sheet-handle').tap();await settle(page);
      await page.locator('#fcu-perception-list [data-shape]').tap();
      const bar=page.locator('#fcu-geometry-toolbar');await expect(bar).toHaveAttribute('data-mobile-tools','collapsed');
      expect((await bar.boundingBox()).height).toBeLessThanOrEqual(60);
      await expect(page.locator('#fcu-editor-ok')).toBeVisible();await expect(page.locator('#fcu-editor-cancel')).toBeVisible();
      await expect(page.locator('#fcu-add-vertex')).not.toBeVisible();await expect(page.locator('#fcu-editor-delete')).not.toBeVisible();
      await screenshot(page,info,'after-editor');
      await bar.locator('.fcu-mobile-tools-toggle').tap();
      await expect(page.locator('#fcu-add-vertex')).toBeVisible();await expect(page.locator('#fcu-remove-vertex')).toBeVisible();await expect(page.locator('#fcu-editor-delete')).toBeVisible();
      await bar.locator('.fcu-mobile-tools-toggle').tap();await page.locator('#fcu-editor-cancel').tap();
      await expect(bar).toHaveCount(0);await clean(page,diagnostics);
    });

    test('Concluir abre formulário por intenção; recolher e continuar preservam rascunho',async({page},info)=>{
      const diagnostics=await ready(page);
      await page.locator('[data-fcu-screen="perception"]').tap();await settle(page);await page.locator('.fcu-sheet-draw').tap();
      const box=await page.locator('#map').boundingBox();
      for(const [index,[x,y]] of [[box.x+70,box.y+135],[box.x+box.width-70,box.y+140],[box.x+box.width/2,box.y+235]].entries()) {
        await page.touchscreen.tap(x,y);
        await expect(page.locator('#fcu-point-count')).toHaveText(`${index+1} ${index ? 'pontos' : 'ponto'}`);
        // The drawing engine reserves rapid double-taps for finish. These
        // independent vertex taps deliberately stay outside that gesture.
        await page.waitForTimeout(320);
      }
      await page.locator('#fcu-finish').tap();
      await expect(page.locator('#fcu-perception-form')).toBeVisible();
      await expect(page.locator('#fcu-perception-panel')).toHaveAttribute('data-mobile-sheet','expanded');await settle(page);
      await expect(page.locator('.fcu-sheet-draw')).not.toBeVisible();
      await page.locator('.fcu-sheet-handle').tap();
      await expect(page.locator('#fcu-perception-panel')).toHaveAttribute('data-mobile-sheet','peek');await settle(page);
      await expect(page.locator('.fcu-sheet-handle')).toHaveAccessibleName('Continuar percepção');
      expect(await page.locator('#fcu-perception-form').evaluate(form=>form.inert)).toBe(true);
      await screenshot(page,info,'form-recolhido');
      await page.locator('.fcu-sheet-handle').tap();await settle(page);
      await expect(page.locator('#fcu-perception-form')).toBeVisible();
      expect(await page.locator('#fcu-perception-form').evaluate(form=>form.inert)).toBe(false);
      await clean(page,diagnostics);
    });

    test('baseline visual anterior preservado como comparação',async({page},info)=>{
      test.skip(!process.env.PREDITOR_MOBILE_BASELINE_REF,'Comparação visual opcional exige um commit anterior disponível localmente.');
      for(const [file,type] of [['mobile.js','text/javascript'],['mobile.css','text/css']]) {
        const body=execFileSync('git',['show',process.env.PREDITOR_MOBILE_BASELINE_REF+':'+file],{cwd:process.cwd(),encoding:'utf8'});
        await page.route('**/'+file+'*',r=>r.fulfill({contentType:type,body}));
      }
      const diagnostics=await ready(page);
      await page.locator('[data-fcu-screen="perception"]').tap();await settle(page);await screenshot(page,info,'before-panel');
      await page.locator('#fcu-start-drawing').tap();await screenshot(page,info,'before-toolbar');await page.locator('#fcu-cancel').tap();
      await clean(page,diagnostics);
    });
  });
}
