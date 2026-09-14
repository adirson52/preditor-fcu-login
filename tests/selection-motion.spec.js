const { test, expect } = require('@playwright/test');
const route = process.env.SELECTION_PATH || '/selecaovariaveis.html';

for (const width of [1366, 390, 320]) {
  test(`moving blocks and ranked cells at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(route);
    for (let i = 0; i < 10; i++) await page.locator('#sp-next').click();
    await expect(page.locator('[data-moving-block]')).toHaveCount(25);
    await expect(page.locator('[data-movie-cell]')).toHaveCount(400);
    const positions = await page.evaluate(() => {
      const movie = LessonMotion.get('blocos-repeticoes');
      const tile = document.querySelector('[data-moving-block="12"]');
      movie.seek(0); const from = tile.getAttribute('transform'); const groupFrom = tile.dataset.group;
      movie.seek(.5); const middle = tile.getAttribute('transform');
      movie.seek(1); const to = tile.getAttribute('transform'); const groupTo = tile.dataset.group;
      return { from, middle, to, groupFrom, groupTo, groups: Array.from(document.querySelectorAll('[data-moving-block]')).map(e => e.dataset.group) };
    });
    expect(new Set([positions.from, positions.middle, positions.to]).size).toBe(3);
    expect([positions.groupFrom, positions.groupTo]).toEqual(['E', 'B']);
    for (const letter of 'ABCDE') expect(positions.groups.filter(group => group === letter)).toHaveLength(5);
    const movie = page.locator('[data-movie="blocos-repeticoes"]');
    await movie.locator('[data-replay]').click();
    await page.waitForTimeout(900);
    const t = await page.evaluate(() => LessonMotion.get('blocos-repeticoes').progress);
    expect(t).toBeGreaterThan(.02);
    await movie.locator('[data-play]').click();
    await expect(movie).toHaveAttribute('data-playing', 'false');
    const paused = await page.evaluate(() => LessonMotion.get('blocos-repeticoes').progress);
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => LessonMotion.get('blocos-repeticoes').progress)).toBe(paused);
    await page.locator('#aba-variaveis').click();
    await page.locator('#ibge-step').selectOption('4');
    await expect(page.locator('[data-rank-cell]')).toHaveCount(20);
    const ranks = await page.evaluate(() => {
      const animation = LessonMotion.get('spearman-celulas');
      animation.seek(.5);
      const before = Array.from(document.querySelectorAll('[data-rank-cell]')).map(e => e.getAttribute('transform'));
      animation.seek(1);
      return { before, after: Array.from(document.querySelectorAll('[data-rank-cell]')).map(e => e.getAttribute('transform')), ties: LessonMotion.ranks([10, 5, 10, 20]), identities: Array.from(document.querySelectorAll('[data-rank-cell]')).map(e => e.dataset.rankCell) };
    });
    expect(ranks.before.slice(0, 10)).toEqual(ranks.after.slice(0, 10));
    expect(ranks.before.slice(10)).not.toEqual(ranks.after.slice(10));
    expect(ranks.identities.slice(0, 10)).toEqual(ranks.identities.slice(10));
    expect(ranks.ties).toEqual([1.5, 0, 1.5, 3]);
    await page.setViewportSize({ width: width + 1, height: 900 });
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => LessonMotion.get('spearman-celulas').progress)).toBe(1);
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.spearman-decision')).toContainText('320');
    await expect(page.locator('.spearman-decision')).toContainText('0,963');
    await page.locator('[data-movie="spearman-celulas"] [data-replay]').click();
    await page.locator('#aba-resultados').click();
    expect(await page.evaluate(() => LessonMotion.get('spearman-celulas').playing)).toBe(false);
    await page.locator('#aba-variaveis').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const textClipped = await page.locator('[data-movie="spearman-celulas"] svg text').evaluateAll(elements => elements.some(element => {
      const bounds = element.getBoundingClientRect(), parent = element.closest('svg').getBoundingClientRect();
      return bounds.left < parent.left - 1 || bounds.right > parent.right + 1;
    }));
    expect(textClipped).toBe(false);
    expect(errors).toEqual([]);
  });
}

test('reduced motion starts paused and GIF exports exist', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(route + '#variaveis-exemplo');
  await page.locator('#ibge-step').selectOption('4');
  await expect(page.locator('[data-movie="spearman-celulas"]')).toHaveAttribute('data-playing', 'false');
  await page.locator('[data-play]').click();
  await expect(page.locator('[data-movie="spearman-celulas"]')).toHaveAttribute('data-playing', 'true');
  for (const name of ['spearman-celulas', 'blocos-repeticoes']) {
    const response = await request.get('/selection/' + name + '.gif');
    expect(response.ok()).toBe(true);
    expect((await response.body()).subarray(0, 6).toString()).toBe('GIF89a');
  }
});
