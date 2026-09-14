(function () {
  const active = new Map();
  const ns = 'http://www.w3.org/2000/svg';
  const clamp = x => Math.max(0, Math.min(1, x));
  const smooth = (p, start, end) => { const t = clamp((p - start) / (end - start)); return t * t * (3 - 2 * t); };
  const mix = (a, b, p) => a + (b - a) * p;
  const number = x => x.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  function node(tag, attrs = {}, text) {
    const element = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function destroy(key) { active.get(key)?.destroy(); active.delete(key); }
  function player(host, key, title, subtitle, draw, duration = 14000) {
    destroy(key);
    host.innerHTML = '<section class="lesson-movie" data-movie="' + key + '"><div class="movie-capture"><h4></h4><p class="movie-subtitle"></p><svg class="movie-scene" role="img"></svg><p class="movie-reading" aria-live="polite"></p></div><div class="movie-controls"><button type="button" class="icon-button" data-play title="Pausar" aria-label="Pausar anima\u00e7\u00e3o"><i data-lucide="pause"></i></button><button type="button" class="icon-button" data-replay title="Repetir" aria-label="Repetir anima\u00e7\u00e3o"><i data-lucide="rotate-ccw"></i></button><input type="range" min="0" max="1000" value="0" step="1" aria-label="Progresso da anima\u00e7\u00e3o"><output></output><a class="movie-download" href="/selection/' + key + '.gif" download title="Baixar GIF"><i data-lucide="download"></i><span>GIF</span></a></div></section>';
    const root = host.firstElementChild;
    root.querySelector('h4').textContent = title;
    root.querySelector('.movie-subtitle').textContent = subtitle;
    const scene = root.querySelector('svg');
    scene.setAttribute('aria-label', title + '. ' + subtitle);
    const reading = root.querySelector('.movie-reading');
    const toggle = root.querySelector('[data-play]');
    const progress = root.querySelector('input');
    const output = root.querySelector('output');
    let frame = null, playing = false, position = 0, start = 0, lastDraw = 0, disposed = false;
    let pendingAuto = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    let paint = draw(scene, Math.max(260, root.clientWidth));
    function update(p) {
      position = clamp(p);
      const message = paint(position);
      if (reading.textContent !== message) reading.textContent = message;
      progress.value = Math.round(position * 1000);
      output.textContent = Math.round(position * 100) + '%';
      root.dataset.progress = position.toFixed(4);
    }
    function button() {
      toggle.innerHTML = '<i data-lucide="' + (playing ? 'pause' : 'play') + '"></i>';
      toggle.setAttribute('aria-label', playing ? 'Pausar anima\u00e7\u00e3o' : 'Reproduzir anima\u00e7\u00e3o');
      toggle.title = playing ? 'Pausar' : 'Reproduzir';
      root.dataset.playing = playing;
      window.lucide?.createIcons({ root });
    }
    function pause() { cancelAnimationFrame(frame); playing = false; button(); }
    function tick(time) {
      if (!playing || disposed) return;
      if (!root.isConnected || root.closest('[hidden]') || document.hidden) { pause(); return; }
      if (time - lastDraw >= 32) { update((time - start) / duration); lastDraw = time; }
      if (position >= 1) { pause(); return; }
      frame = requestAnimationFrame(tick);
    }
    function play() {
      if (disposed) return;
      pendingAuto = false;
      if (position >= 1) update(0);
      cancelAnimationFrame(frame);
      playing = true; start = performance.now() - position * duration; lastDraw = 0; button();
      frame = requestAnimationFrame(tick);
    }
    const api = {
      root, play, pause,
      seek(p) { pendingAuto = false; pause(); update(p); },
      resize() {
        if (disposed || root.closest('[hidden]')) return;
        scene.replaceChildren(); paint = draw(scene, Math.max(260, root.clientWidth)); update(position);
      },
      destroy() { observer.disconnect(); pause(); disposed = true; },
      get progress() { return position; }, get playing() { return playing; }
    };
    toggle.addEventListener('click', () => playing ? pause() : play());
    root.querySelector('[data-replay]').addEventListener('click', () => { api.seek(0); play(); });
    progress.addEventListener('input', () => api.seek(Number(progress.value) / 1000));
    const observer = new IntersectionObserver(entries => {
      const entry = entries[0];
      if (pendingAuto && entry.intersectionRatio >= .3 && !document.hidden) play();
      else if (!entry.isIntersecting && playing) pause();
    }, { threshold: [0, .3] });
    active.set(key, api); update(0); button();
    observer.observe(scene);
    return api;
  }
  function blocks(host, divisions) {
    const letters = 'ABCDE';
    return player(host, 'blocos-repeticoes', 'Os mesmos 25 blocos mudam de grupo', 'Diagrama por grupo, n\u00e3o mapa. Cada bloco leva suas 16 c\u00e9lulas juntas.', (scene, width) => {
      const row = 73, top = 25, left = 30, track = (width - left - 8) / 5;
      const size = Math.min(53, track - 7), tileHeight = size + 18;
      scene.setAttribute('viewBox', '0 0 ' + width + ' 397');
      const title = node('text', { x: left, y: 14, class: 'movie-axis' }, 'Repeti\u00e7\u00e3o 1'); scene.append(title);
      for (let g = 0; g < 5; g++) {
        scene.append(node('line', { x1: 0, x2: width, y1: top + g * row + tileHeight + 4, y2: top + g * row + tileHeight + 4, class: 'movie-guide' }));
        scene.append(node('text', { x: 6, y: top + g * row + size / 2 + 5, class: 'movie-group' }, letters[g]));
      }
      const positions = divisions.slice(0, 2).map(split => split.map((g, index) => ({ x: left + split.slice(0, index).filter(value => value === g).length * track, y: top + g * row })));
      const items = divisions[0].map((group, b) => {
        const item = node('g', { 'data-moving-block': b, class: b === 12 ? 'moving-block focus-block' : 'moving-block' });
        item.append(node('rect', { width: size, height: size, rx: 2, class: 'block-surface' }));
        const cellSize = (size - 6) / 4;
        for (let cell = 0; cell < 16; cell++) item.append(node('rect', { x: 3 + cell % 4 * cellSize, y: 3 + Math.floor(cell / 4) * cellSize, width: cellSize - 1, height: cellSize - 1, class: 'block-cell', 'data-movie-cell': cell }));
        item.append(node('text', { x: size / 2, y: size + 13, 'text-anchor': 'middle', class: 'movie-id' }, 'B' + String(b + 1).padStart(2, '0')));
        item.append(node('title', {}, 'Bloco ' + (b + 1) + ': 16 celulas; grupo ' + letters[group] + ' passa a ' + letters[divisions[1][b]]));
        scene.append(item); return item;
      });
      scene.append(items[12]);
      return p => {
        const t = smooth(p, .22, .70);
        title.textContent = p < .22 ? '1. Repeti\u00e7\u00e3o 1' : p < .70 ? '2. Reorganizando os grupos' : '3. Repeti\u00e7\u00e3o 2';
        items.forEach((item, b) => {
          item.setAttribute('transform', 'translate(' + mix(positions[0][b].x, positions[1][b].x, t) + ',' + mix(positions[0][b].y, positions[1][b].y, t) + ')');
          item.dataset.group = letters[divisions[p < .70 ? 0 : 1][b]];
        });
        return p < .22 ? 'B13 est\u00e1 no grupo E. Cada linha re\u00fane cinco blocos.' : p < .70 ? 'Acompanhe B13 em amarelo: suas 16 c\u00e9lulas viajam juntas de E para B.' : 'B13 agora pertence a B. Refazemos as cinco rodadas com esta nova divis\u00e3o. A geografia n\u00e3o mudou.';
      };
    });
  }
  function ranks(values) {
    const ordered = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
    const rank = [];
    for (let i = 0; i < ordered.length;) {
      let end = i + 1;
      while (end < ordered.length && ordered[end].value === ordered[i].value) end++;
      for (let j = i; j < end; j++) rank[ordered[j].index] = (i + end - 1) / 2;
      i = end;
    }
    return rank;
  }
  function spearman(host, data) {
    const pair = data.first.pairs[0];
    const a = data.features.findIndex(feature => feature.id === pair.feature_a);
    const b = data.features.findIndex(feature => feature.id === pair.feature_b);
    const cells = data.cells.filter(cell => data.divisions[0][cell.block] !== 4).slice(0, 10);
    // Use full-precision ranks, keeping average positions for ties.
    const xRanks = ranks(cells.map(cell => cell.x[a])), yRanks = ranks(cells.map(cell => cell.x[b]));
    const api = player(host, 'spearman-celulas', 'Duas filas, as mesmas dez c\u00e9lulas', 'Da menor propor\u00e7\u00e3o para a maior. O ID acompanha a c\u00e9lula nas duas filas.', (scene, width) => {
      const gutter = Math.max(42, width * .16), side = (width - gutter - 8) / 2, right = side + gutter + 8;
      const top = 51, row = 33, height = 27;
      scene.setAttribute('viewBox', '0 0 ' + width + ' 389');
      const headingA = node('text', { x: 0, y: 17, class: 'movie-column-title' }, 'Cal\u00e7ada');
      headingA.append(node('tspan', { x: 0, dy: 15 }, 'inadequada'));
      const headingB = node('text', { x: right, y: 17, class: 'movie-column-title' }, 'Sem cal\u00e7ada');
      scene.append(headingA, headingB);
      const links = cells.map((cell, index) => { const line = node('line', { class: 'rank-link' + (index === 0 ? ' rank-focus' : '') }); scene.append(line); return line; });
      const tiles = [0, 1].map(column => cells.map((cell, index) => {
        const tile = node('g', { class: 'rank-cell' + (index === 0 ? ' rank-focus' : ''), 'data-rank-cell': cell.id, 'data-column': column });
        tile.append(node('rect', { width: side, height, rx: 3 }));
        tile.append(node('text', { x: 6, y: 18, class: 'movie-id' }, cell.id));
        tile.append(node('text', { x: side - 5, y: 18, 'text-anchor': 'end', class: 'movie-value' }, (cell.x[column ? b : a] * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'));
        tile.append(node('title', {}, cell.id + ': ' + number(cell.x[column ? b : a])));
        scene.append(tile); return tile;
      }));
      return p => {
        const first = smooth(p, .16, .43), second = smooth(p, .55, .80);
        cells.forEach((cell, index) => {
          const leftRank = mix(index, xRanks[index], first);
          const rightRank = mix(leftRank, yRanks[index], second);
          const leftY = top + leftRank * row, rightY = top + rightRank * row;
          tiles[0][index].setAttribute('transform', 'translate(0,' + leftY + ')');
          tiles[1][index].setAttribute('transform', 'translate(' + right + ',' + rightY + ')');
          tiles[0][index].dataset.rank = xRanks[index] + 1;
          tiles[1][index].dataset.rank = yRanks[index] + 1;
          Object.entries({ x1: side, x2: right, y1: leftY + height / 2, y2: rightY + height / 2 }).forEach(([key, value]) => links[index].setAttribute(key, value));
        });
        scene.dataset.phase = p < .16 ? 'ids' : p < .55 ? 'first-rank' : p < .80 ? 'second-rank' : 'compare';
        return p < .16 ? '1. As duas filas come\u00e7am na ordem do ID. Ainda n\u00e3o comparamos os valores.' : p < .55 ? '2. Ordenamos pela cal\u00e7ada inadequada. A outra fila acompanha os mesmos IDs.' : p < .80 ? '3. Agora s\u00f3 a fila da direita se ordena por aus\u00eancia de cal\u00e7ada.' : '4. Quase a mesma ordem! As linhas ligam a mesma c\u00e9lula. Poucas trocas indicam informa\u00e7\u00f5es parecidas.';
      };
    }, 18000);
    const result = document.createElement('div'); result.className = 'spearman-decision';
    result.innerHTML = '<p><strong>Na conta completa: \u03c1 = ' + number(pair.spearman_rho) + '</strong> (320 c\u00e9lulas do treino fict\u00edcio, n\u00e3o s\u00f3 as dez animadas).</p><div><span class="kept-term">Cal\u00e7ada inadequada: fica</span><span class="removed-term">Sem cal\u00e7ada: sai deste grupo</span></div><p>|\u03c1| \u2265 0,70 liga as duas vari\u00e1veis. A import\u00e2ncia do EBM unit\u00e1rio decide qual fica, n\u00e3o o Spearman.</p>';
    host.append(result);
    return api;
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) active.forEach(api => api.pause()); });
  let resizeFrame;
  addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => active.forEach(api => api.resize()));
  });
  window.LessonMotion = { blocks, spearman, ranks, destroy, get: key => active.get(key), pauseAll: () => active.forEach(api => api.pause()) };
})();
