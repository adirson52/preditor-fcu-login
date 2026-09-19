const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'perception.js'), 'utf8');
const helper = source.slice(source.indexOf('  function makeElementDraggable('), source.indexOf('  // The database owns authorization'));
const styles = ['perception.css', 'mobile.css'].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');

async function fixture(page, mobile = true, geometry = false) {
  await page.route('**/*', route => route.abort());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}${styles}</style>
    <body class="${mobile ? 'fcu-mobile-simple' : ''}">
      ${mobile ? '<header class="fcu-mobile-topbar">Área e visualização</header><footer class="fcu-mobile-bottom"><div class="fcu-mobile-sync">Salvo no aparelho · Sincronizar</div><nav class="fcu-mobile-nav"><button>Mapa</button><button>Percepções</button><button>Conta</button></nav></footer>' : ''}
      <div class="${geometry ? 'fcu-geometry-toolbar' : 'fcu-perception-drawnote'}" id="toolbar">
        <div class="fcu-gis-head"><strong>Arraste o menu</strong><button id="header-action">Ajuda</button></div>
        <div class="fcu-gis-toolbar"><div class="fcu-gis-group"><button class="fcu-gis-btn" id="regular-button">＋ Ponto</button><button class="fcu-gis-btn">Desfazer</button><button class="fcu-gis-btn">Limpar</button><button class="fcu-gis-btn">Cancelar</button><button class="fcu-gis-btn">✓ OK</button></div></div>
      </div>
    </body>`);
  await page.addScriptTag({ content: helper + `
    window.__toolbarInstall = (...args) => {
      window.__trackToolbarInstall = true;
      try { return makeElementDraggable(...args); }
      finally { window.__trackToolbarInstall = false; }
    };
    window.__trackedToolbarListeners = new Set();
    window.__globalDragListeners = [];
    const originalAdd = window.addEventListener.bind(window), originalRemove = window.removeEventListener.bind(window);
    window.addEventListener = function(type,fn,options) {
      if(type==='resize') window.__trackedToolbarListeners.add(fn);
      if(window.__trackToolbarInstall && ['mousemove','touchmove','pointermove','mouseup','touchend'].includes(type)) window.__globalDragListeners.push(type);
      return originalAdd(type,fn,options);
    };
    window.removeEventListener = function(type,fn,options) {
      if(type==='resize') window.__trackedToolbarListeners.delete(fn);
      return originalRemove(type,fn,options);
    };
    window.__toolbarClicks = 0;
    document.querySelectorAll('button').forEach(button => button.onclick=()=>window.__toolbarClicks++);
    window.__toolbarInstall(document.querySelector('#toolbar'),document.querySelector('.fcu-gis-head'));
  ` });
  return errors;
}

async function touchDrag(page, from, to, cancel = false) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x:from.x,y:from.y,id:1}]});
    for(let step=1;step<=4;step++) await cdp.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*step/4,y:from.y+(to.y-from.y)*step/4,id:1}]});
    await cdp.send('Input.dispatchTouchEvent', {type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
  } finally { await cdp.detach(); }
}

async function safeBounds(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('#toolbar').getBoundingClientRect();
    const top = document.querySelector('.fcu-mobile-topbar')?.getBoundingClientRect().bottom || 0;
    const bottom = document.querySelector('.fcu-mobile-bottom')?.getBoundingClientRect().top || innerHeight;
    return {left:bar.left,right:bar.right,top:bar.top,bottom:bar.bottom,viewport:innerWidth,allowedTop:top+8,allowedBottom:bottom-8};
  });
}

for(const viewport of [{width:390,height:844},{width:768,height:1024}]) {
  test.describe(`toolbar touch ${viewport.width}`, () => {
    test.use({viewport,hasTouch:true,isMobile:true});
    for(const geometry of [false,true]) test(`${geometry?'edição':'desenho'} arrasta pelo toque e mantém navegação livre`, async ({page}) => {
      const errors = await fixture(page,true,geometry);
      const bar = page.locator('#toolbar'), head = page.locator('.fcu-gis-head');
      const before = await bar.boundingBox(), handle = await head.boundingBox();
      await touchDrag(page,{x:handle.x+35,y:handle.y+20},{x:handle.x+35,y:handle.y-130});
      await expect(bar).toHaveAttribute('data-mobile-floating','true');
      expect((await bar.boundingBox()).y).toBeLessThan(before.y-80);
      await expect(head).toHaveCSS('touch-action','none');
      const moved = await bar.boundingBox(), newHandle = await head.boundingBox();
      await touchDrag(page,{x:newHandle.x+30,y:newHandle.y+20},{x:viewport.width-1,y:viewport.height-1},true);
      await expect(head).toHaveCSS('cursor','grab');
      const bounds = await safeBounds(page);
      expect(bounds.left).toBeGreaterThanOrEqual(7);
      expect(bounds.right).toBeLessThanOrEqual(bounds.viewport-7);
      expect(bounds.top).toBeGreaterThanOrEqual(bounds.allowedTop-1);
      expect(bounds.bottom).toBeLessThanOrEqual(bounds.allowedBottom+1);
      expect((await bar.boundingBox()).y).not.toBe(moved.y);
      const current = await head.boundingBox();
      await touchDrag(page,{x:current.x+30,y:current.y+20},{x:1,y:1});
      const upper = await safeBounds(page);
      expect(upper.top).toBeGreaterThanOrEqual(upper.allowedTop-1);
      expect(errors).toEqual([]);
    });

    test('botões não arrastam; resize e remoção preservam limites sem listeners acumulados', async ({page}) => {
      const errors = await fixture(page);
      await page.locator('#header-action').tap();
      await page.locator('#regular-button').tap();
      expect(await page.evaluate(() => window.__toolbarClicks)).toBe(2);
      await expect(page.locator('#toolbar')).not.toHaveAttribute('data-mobile-floating','true');
      const handle = await page.locator('.fcu-gis-head').boundingBox();
      await touchDrag(page,{x:handle.x+30,y:handle.y+20},{x:handle.x+30,y:handle.y-100});
      await page.setViewportSize({width:330,height:620});
      await expect.poll(async () => (await safeBounds(page)).right).toBeLessThanOrEqual(323);
      const bounds = await safeBounds(page);
      expect(bounds.bottom).toBeLessThanOrEqual(bounds.allowedBottom+1);
      await page.evaluate(async () => {
        for(let count=0;count<6;count++) {
          const previous=document.querySelector('#toolbar'), next=previous.cloneNode(true);
          previous.remove();await Promise.resolve();document.body.appendChild(next);
          window.__toolbarInstall(next,next.querySelector('.fcu-gis-head'));
        }
      });
      expect(await page.evaluate(() => window.__trackedToolbarListeners.size)).toBe(1);
      expect(await page.evaluate(() => window.__globalDragListeners)).toEqual([]);
      await page.evaluate(() => document.querySelector('#toolbar').remove());
      await expect.poll(() => page.evaluate(() => window.__trackedToolbarListeners.size)).toBe(0);
      expect(errors).toEqual([]);
    });
  });
}

test('desktop continua arrastável pelo mouse e limitado ao viewport', async ({page}) => {
  const errors = await fixture(page,false);
  const handle=await page.locator('.fcu-gis-head').boundingBox();
  await page.mouse.move(handle.x+30,handle.y+12);await page.mouse.down();
  await page.mouse.move(20,240,{steps:8});await page.mouse.up();
  const bounds=await safeBounds(page);
  expect(bounds.left).toBeGreaterThanOrEqual(7);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewport-7);
  expect(bounds.top).toBeGreaterThan(100);
  await expect(page.locator('.fcu-gis-head')).toHaveCSS('cursor','grab');
  expect(errors).toEqual([]);
});
