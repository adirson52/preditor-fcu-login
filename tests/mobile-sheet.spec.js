const { test, expect } = require('@playwright/test');

// Authentication and perceptions are wholly in memory. These gestures never
// create accounts, telemetry or drawings in Supabase/production.
const OWNER = '00000000-0000-4000-8000-000000000081';
const seeds = Array.from({ length: 14 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 101).padStart(12, '0')}`,
  user_id: OWNER, title: `Percepção simulada ${index + 1} — teste de rolagem`, status: 'submitted',
  created_at: '2026-09-19T12:00:00Z', updated_at: '2026-09-19T12:00:00Z',
  target_kind: 'polygon', action_type: 'free', perceived_class: 'atencao', perception_types: ['atencao'],
  geometry: { type: 'Polygon', coordinates: [[[-48.50, -1.45], [-48.49, -1.45], [-48.49, -1.44], [-48.50, -1.44], [-48.50, -1.45]]] }
}));

async function ready(page) {
  const diagnostics = { errors: [], unexpectedDatabase: [] };
  page.on('pageerror', error => diagnostics.errors.push(error.message));
  page.on('requestfailed', request => {
    if (/\.(css|js)(\?|$)/.test(request.url())) console.log('Resource failed:', request.url(), request.failure()?.errorText);
  });
  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/*.supabase.co/**', route => { diagnostics.unexpectedDatabase.push(route.request().method()); return route.abort(); });
  await page.route('**/auth.js*', route => route.fulfill({ contentType: 'text/javascript', body: `
    window.__sheetFixtureRows = ${JSON.stringify(seeds)};
    window.__sheetFixtureWrites = [];
    window.PreditorAuth = {
      user: { id:${JSON.stringify(OWNER)}, email:'sheet-fixture@example.test', user_metadata:{ full_name:'Teste de painel', institution:'Fixture local' } },
      verifyAccount:async()=>true, track:async()=>{}, trackEvent:async()=>{},
      client:{
        auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
        from(table){
          const q={filters:[],first:0,last:99999,single:false,operation:'select'};
          const builder={
            select(){return builder;},eq(k,v){q.filters.push([k,v]);return builder;},order(){return builder;},
            range(first,last){q.first=first;q.last=last;return builder;},maybeSingle(){q.single=true;return builder;},
            insert(value){q.operation='insert';return builder;},update(value){q.operation='update';return builder;},
            then(resolve,reject){return Promise.resolve().then(()=>{
              if(q.operation!=='select'){window.__sheetFixtureWrites.push({table,operation:q.operation});return {data:null,error:{code:'FIXTURE_READ_ONLY'}};}
              const data=table==='fcu_perceptions'?window.__sheetFixtureRows:[];
              const rows=data.filter(row=>q.filters.every(([key,value])=>row[key]===value));
              return {data:q.single?rows[0]||null:rows.slice(q.first,q.last+1),error:null};
            }).then(resolve,reject);}
          };return builder;
        }
      }
    };
  ` }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.PreditorMobile && window.PreditorPerception?.getSyncStatus().lastLoadedAt, null, { timeout: 60000 });
  await expect(page.locator('body')).toHaveClass(/fcu-mobile-simple/);
  await expect(page.locator('.fcu-mobile-topbar')).toHaveCSS('position', 'fixed');
  await page.evaluate(() => {
    window.__sheetEvents=[];
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture']) document.addEventListener(type,event=>{
      if(event.target.closest?.('.fcu-sheet-handle')) window.__sheetEvents.push({type,at:performance.now(),button:event.button,primary:event.isPrimary,pointer:event.pointerId,x:event.clientX,y:event.clientY});
    },true);
    for(const type of ['resize','scroll']) window.visualViewport?.addEventListener(type,()=>window.__sheetEvents.push({type:'viewport-'+type,at:performance.now(),height:visualViewport.height,top:visualViewport.offsetTop}));
    for(const type of ['resize','orientationchange']) window.addEventListener(type,()=>window.__sheetEvents.push({type:'window-'+type,at:performance.now()}));
  });
  await page.locator('[data-fcu-screen="perception"]').tap();
  await expect(page.locator('#fcu-perception-panel')).toHaveClass(/is-open/);
  await expect(page.locator('#fcu-perception-panel')).toHaveAttribute('data-mobile-sheet', 'peek');
  await expect(page.locator('#fcu-perception-list article')).toHaveCount(seeds.length);
  await settleSheet(page);
  // The new default is the 60px map-first dock. Exercise its optional
  // intermediate snap explicitly; tapping Lista now opens the full list.
  await touchGesture(page, await handleStart(page), [-40, -120]);
  await expect(page.locator('#fcu-perception-panel')).toHaveAttribute('data-mobile-sheet', 'half');
  await settleSheet(page);
  return diagnostics;
}

// State changes precede the CSS snap transition. Start the next independent
// gesture only after that transition reaches its advertised height.
async function settleSheet(page) {
  await expect.poll(() => page.locator('#fcu-perception-panel').evaluate(panel => {
    const target = Number.parseFloat(panel.style.getPropertyValue('--fcu-sheet-height'));
    const transform = getComputedStyle(panel).transform;
    const offset = transform === 'none' ? 0 : new DOMMatrix(transform).m42;
    return Math.max(Math.abs(panel.getBoundingClientRect().height-target),Math.abs(offset));
  })).toBeLessThan(1);
}

async function metrics(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('#fcu-perception-panel');
    const box = panel.getBoundingClientRect();
    const handle = panel.querySelector('.fcu-sheet-handle').getBoundingClientRect();
    const map = window.PreditorApp.map;
    return { height:box.height, top:box.top, bottom:box.bottom, state:panel.dataset.mobileSheet,
      scrollTop:panel.scrollTop, clientHeight:panel.clientHeight, scrollHeight:panel.scrollHeight,
      dragging:panel.classList.contains('is-dragging'), inlineHeight:panel.style.getPropertyValue('--fcu-sheet-height'),
      handle:{x:handle.x,y:handle.y,width:handle.width,height:handle.height},
      center:{lat:map.getCenter().lat,lng:map.getCenter().lng},zoom:map.getZoom() };
  });
}

async function frame(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function mapUnmoved(page, before) {
  expect(await page.evaluate(({ center, zoom }) => {
    const map = window.PreditorApp.map;
    return { pixels:map.project(center).distanceTo(map.project(map.getCenter())),sameZoom:map.getZoom()===zoom };
  }, before)).toEqual({ pixels:0,sameZoom:true });
}

async function touchGesture(page, start, deltas, endType = 'touchEnd', checkpoint) {
  const session = await page.context().newCDPSession(page);
  const samples = [];
  try {
    await session.send('Input.dispatchTouchEvent', { type:'touchStart',touchPoints:[{x:start.x,y:start.y,id:1}] });
    for (const delta of deltas) {
      await session.send('Input.dispatchTouchEvent', { type:'touchMove',touchPoints:[{x:start.x,y:start.y+delta,id:1}] });
      await frame(page);
      const sample = await metrics(page);
      samples.push(sample);
      if (checkpoint) await checkpoint(sample, samples.length - 1);
    }
    await session.send('Input.dispatchTouchEvent', { type:endType,touchPoints:[] });
  } finally {
    const events=await page.evaluate(()=>window.__sheetEvents);
    await test.info().attach('touch-samples', { body:JSON.stringify({start,deltas,endType,samples},null,2),contentType:'application/json' });
    if(checkpoint && samples.some(sample=>sample.dragging===false)) console.log('Touch diagnostics:',JSON.stringify({start,deltas,endType,samples,events}));
    await session.detach();
  }
  return samples;
}

async function handleStart(page) {
  const handle = page.locator('.fcu-sheet-handle');
  // Rounded panel borders clip half a CSS pixel; the actual touch center must
  // nevertheless hit the handle, including after the list has been scrolled.
  await expect(handle).toBeInViewport({ ratio:0.99 });
  const box = await handle.boundingBox();
  const start = { x:box.x+Math.min(box.width/2,120),y:box.y+box.height/2 };
  expect(await page.evaluate(({x,y}) => !!document.elementFromPoint(x,y)?.closest('.fcu-sheet-handle'),start)).toBe(true);
  return start;
}

async function evidence(page, testInfo, label, detail) {
  await testInfo.attach(label + '-metrics', { body:JSON.stringify(detail,null,2),contentType:'application/json' });
  const file = testInfo.outputPath(label + '.png');
  await page.screenshot({ path:file,fullPage:false });
  await testInfo.attach(label + '-screenshot', { path:file,contentType:'image/png' });
}

async function cleanFixture(page, diagnostics) {
  expect(diagnostics).toEqual({ errors:[],unexpectedDatabase:[] });
  expect(await page.evaluate(() => window.__sheetFixtureWrites)).toEqual([]);
}

test.afterEach(async ({page},testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && await page.locator('.fcu-sheet-handle').count()) {
    await evidence(page,testInfo,'falha-painel',await metrics(page));
  }
});

for (const viewport of [{width:390,height:844},{width:768,height:1024}]) {
  test.describe(`painel móvel ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport,hasTouch:true,isMobile:true });

    test('compacto mantém mapa visível e alvos de toque de pelo menos 44px', async ({ page }, testInfo) => {
      const diagnostics = await ready(page);
      const compactLimit = Math.min(viewport.height*.34,300)+2;
      await expect.poll(async () => (await metrics(page)).height).toBeLessThanOrEqual(compactLimit);
      const initial = await metrics(page);
      const targets = await page.locator('#fcu-perception-panel').evaluate(panel => [...panel.querySelectorAll('.fcu-sheet-handle,.fcu-sheet-close,#fcu-start-drawing,.fcu-perception-tabs button,.fcu-filter-box summary,.fcu-perception-item-actions button')]
        .map(node => ({label:node.textContent.trim(),height:node.getBoundingClientRect().height,width:node.getBoundingClientRect().width})));
      for (const target of targets) {
        expect(target.height, target.label).toBeGreaterThanOrEqual(44);
        expect(target.width, target.label).toBeGreaterThanOrEqual(44);
      }
      const map = await page.locator('#map').boundingBox();
      expect(initial.top-map.y).toBeGreaterThan(viewport.height*.35);
      await evidence(page,testInfo,'compacto',{initial,targets});
      await cleanFixture(page,diagnostics);
    });

    test('arraste muda altura durante o movimento, permite cancelar, recolher e reabrir por toque', async ({ page }, testInfo) => {
      const diagnostics = await ready(page);
      const initial = await metrics(page);
      const start = await handleStart(page);
      const samples = await touchGesture(page,start,[-25,-65,-110],'touchCancel',async (sample,index) => {
        expect(sample.dragging).toBe(true);
        expect(sample.height).toBeGreaterThan(initial.height+10+index*20);
        expect(sample.state).toBe('half');
        await mapUnmoved(page,initial);
        if(index===0) {
          // Closing the study-area sidebar dispatches this synthetic event on
          // a delay. It must not cancel an unrelated, already active touch.
          await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
          await frame(page);
          expect((await metrics(page)).dragging).toBe(true);
        }
      });
      await expect(page.locator('#fcu-perception-panel')).toHaveAttribute('data-mobile-sheet','half');
      await expect(page.locator('#fcu-perception-panel')).not.toHaveClass(/is-dragging/);
      await expect.poll(async () => Math.abs((await metrics(page)).height-initial.height)).toBeLessThan(2);
      await page.locator('.fcu-sheet-handle').tap();
      await expect(page.locator('#fcu-perception-panel')).toHaveAttribute('data-mobile-sheet','expanded');
      await settleSheet(page);
      const expanded = await metrics(page);
      const downward = Math.max(140,expanded.height-35);
      await touchGesture(page,await handleStart(page),[40,downward*.55,downward]);
      await expect(page.locator('#fcu-perception-panel')).toHaveAttribute('data-mobile-sheet','peek');
      await expect.poll(async () => (await metrics(page)).height).toBeLessThanOrEqual(70);
      await handleStart(page);
      await page.locator('.fcu-sheet-handle').tap();
      await expect(page.locator('#fcu-perception-panel')).toHaveAttribute('data-mobile-sheet','expanded');
      await settleSheet(page);
      await mapUnmoved(page,initial);
      await evidence(page,testInfo,'gesto-cancelado-reaberto',{initial,samples,final:await metrics(page)});
      await cleanFixture(page,diagnostics);
    });

    test('rolagem da lista não arrasta painel e cabeçalho continua alcançável após recolher', async ({ page }, testInfo) => {
      const diagnostics = await ready(page);
      await page.locator('.fcu-sheet-handle').tap();
      await expect(page.locator('#fcu-perception-panel')).toHaveAttribute('data-mobile-sheet','expanded');
      await settleSheet(page);
      const before = await metrics(page);
      const box = await page.locator('#fcu-perception-panel').boundingBox();
      const start = {x:box.x+box.width-26,y:box.y+box.height-35};
      const scrollSamples = await touchGesture(page,start,[-35,-80,-140,-190]);
      await expect.poll(async () => (await metrics(page)).scrollTop).toBeGreaterThan(20);
      for (const sample of scrollSamples) {
        expect(sample.dragging).toBe(false);
        expect(sample.state).toBe('expanded');
        expect(Math.abs(sample.height-before.height)).toBeLessThan(2);
      }
      await mapUnmoved(page,before);
      const scrolled = await metrics(page);
      await handleStart(page);
      await touchGesture(page,await handleStart(page),[40,Math.max(150,scrolled.height-30)]);
      await expect(page.locator('#fcu-perception-panel')).toHaveAttribute('data-mobile-sheet','peek');
      await expect.poll(async () => (await metrics(page)).scrollTop).toBe(0);
      await handleStart(page);
      await page.locator('.fcu-sheet-handle').tap();
      await expect(page.locator('#fcu-perception-panel')).toHaveAttribute('data-mobile-sheet','expanded');
      await settleSheet(page);
      await evidence(page,testInfo,'lista-rolada-recolhida',{before,scrollSamples,scrolled,final:await metrics(page)});
      await cleanFixture(page,diagnostics);
    });
  });
}

test.describe('painel em orientação e modo completo', () => {
  test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});

  test('redimensionar depois do gesto mantém controles alcançáveis em paisagem e retrato pequeno', async ({page},testInfo) => {
    const diagnostics = await ready(page);
    await touchGesture(page,await handleStart(page),[-40,-220]);
    await expect(page.locator('#fcu-perception-panel')).toHaveAttribute('data-mobile-sheet','expanded');
    await settleSheet(page);
    const dimensions = [];
    for (const viewport of [{width:844,height:390},{width:320,height:568}]) {
      await page.setViewportSize(viewport);
      await settleSheet(page);
      await handleStart(page);
      await expect(page.locator('.fcu-sheet-close')).toBeInViewport({ratio:1});
      await expect(page.locator('#fcu-perception-panel')).toHaveAttribute('data-mobile-sheet','expanded');
      await expect.poll(async () => (await metrics(page)).bottom).toBeLessThanOrEqual(viewport.height);
      const expanded = await metrics(page);
      expect(expanded.top).toBeGreaterThanOrEqual(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.locator('.fcu-sheet-handle').tap();
      await expect(page.locator('#fcu-perception-panel')).toHaveAttribute('data-mobile-sheet','peek');
      await settleSheet(page);
      if (viewport.height>viewport.width) await expect.poll(async () => (await metrics(page)).height).toBeLessThanOrEqual(Math.min(viewport.height*.34,300)+2);
      dimensions.push({viewport,expanded,compact:await metrics(page)});
      await evidence(page,testInfo,`resize-${viewport.width}x${viewport.height}`,dimensions.at(-1));
      await page.locator('.fcu-sheet-handle').tap();
      await expect(page.locator('#fcu-perception-panel')).toHaveAttribute('data-mobile-sheet','expanded');
      await settleSheet(page);
    }
    await cleanFixture(page,diagnostics);
  });

  test('modo Completo continua independente das dimensões e controles do painel simplificado', async ({page},testInfo) => {
    const diagnostics = await ready(page);
    await touchGesture(page,await handleStart(page),[-40,-220]);
    await expect(page.locator('#fcu-perception-panel')).toHaveAttribute('data-mobile-sheet','expanded');
    await page.locator('.fcu-mobile-topbar [data-fcu-mode="complete"]').tap();
    await expect(page.locator('body')).not.toHaveClass(/fcu-mobile-simple/);
    await expect(page.locator('.fcu-sheet-controls')).not.toBeVisible();
    await expect(page.locator('#fcu-perception-panel .fcu-perception-head')).toBeVisible();
    await expect(page.locator('#fcu-perception-panel')).not.toHaveClass(/is-dragging/);
    expect(await page.evaluate(() => localStorage.getItem('preditor_fcu_view_mode_v1'))).toBe('complete');
    await page.locator('.fcu-perception-head .fcu-perception-close').tap();
    await expect(page.locator('#fcu-perception-panel')).not.toHaveClass(/is-open/);
    await page.locator('.fcu-mobile-quick-mode').tap();
    await expect(page.locator('body')).toHaveClass(/fcu-mobile-simple/);
    await page.locator('[data-fcu-screen="perception"]').tap();
    await expect(page.locator('#fcu-perception-panel')).toHaveAttribute('data-mobile-sheet','peek');
    await evidence(page,testInfo,'volta-do-modo-completo',await metrics(page));
    await cleanFixture(page,diagnostics);
  });
});
