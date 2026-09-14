const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs/promises');

(async () => {
  const output = process.argv[2];
  if (!output) throw new Error('Pass an output directory for rendered PNG frames.');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 1100 }, reducedMotion: 'reduce' });
    await page.goto((process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8779') + '/selecaovariaveis.html');
    await page.addStyleTag({ content: '.lesson-movie{max-width:640px}' });
    for (const key of ['blocos-repeticoes', 'spearman-celulas']) {
      if (key === 'blocos-repeticoes') {
        for (let i = 0; i < 10; i++) await page.locator('#sp-next').click();
      } else {
        await page.locator('#aba-variaveis').click();
        await page.locator('#ibge-step').selectOption('4');
      }
      const folder = path.join(output, key);
      await fs.mkdir(folder, { recursive: true });
      const capture = page.locator(`[data-movie="${key}"] .movie-capture`);
      for (let index = 0; index < 91; index++) {
        await page.evaluate(({ key, index }) => LessonMotion.get(key).seek(index / 90), { key, index });
        await capture.screenshot({ path: path.join(folder, `${String(index).padStart(3, '0')}.png`), animations: 'disabled' });
      }
      console.log(`${key}: 91 frames rendered`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
