(function () {
  const root = document.getElementById('painel-variaveis');
  const data = JSON.parse(document.getElementById('ibge-example-data').textContent);
  const real = JSON.parse(document.getElementById('ibge-real-data').textContent);
  const visual = document.getElementById('ibge-visual');
  const select = document.getElementById('ibge-step');
  const previous = document.getElementById('ibge-previous');
  const next = document.getElementById('ibge-next');
  const f = (value, digits = 3) => Number(value).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const esc = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const labels = {
    p_ibge_1banhexc_2022: 'Um banheiro exclusivo', p_ibge_calcainade_2022: 'Cal\u00e7ada inadequada',
    p_ibge_naocalca_2022: 'Sem cal\u00e7ada', ibge_mediapopdomc_2022: 'Moradores por domic\u00edlio tipo casa',
    m_ibge_renddppo_2022: 'Renda domiciliar', p_ibge_naoilupub_2022: 'Sem ilumina\u00e7\u00e3o p\u00fablica'
  };
  const label = id => labels[id] || id;
  const state = { step: 0, k: data.recommendedK, cell: 4, values: {} };
  const steps = [
    ['Dados', 'Uma linha por c\u00e9lula, uma coluna por vari\u00e1vel',
      'O IBGE oferece 30 candidatas nesta rodada. Para acompanhar a conta sem esconder etapas, usamos aqui <strong>seis nomes reais</strong>. Cada uma das 400 c\u00e9lulas recebe seis valores simulados.',
      'A resposta fica em outra coluna: <strong>y = 1</strong> significa FCU no cadastro; <strong>y = 0</strong>, fora do cadastro. O ID apenas identifica a linha: n\u00e3o vira preditora.',
      'X = 400 linhas \u00d7 6 vari\u00e1veis<br>y = 400 respostas de refer\u00eancia',
      'Dados e resposta s\u00e3o coisas diferentes.', 'Um pequeno trecho da tabela fict\u00edcia'],
    ['Reserva espacial', 'Primeiro guardamos o grupo que far\u00e1 a prova',
      'Na primeira divis\u00e3o, os grupos A, B, C e D fornecem <strong>320 c\u00e9lulas de treino</strong>. As 80 c\u00e9lulas de E ficam reservadas. Os blocos de 16 c\u00e9lulas permanecem inteiros.',
      'A sele\u00e7\u00e3o desta rodada tamb\u00e9m fica dentro do treino: qualidade, ranking individual e Spearman n\u00e3o consultam o grupo E. As letras deste exemplo s\u00e3o fict\u00edcias; Aracaju usa seus splits salvos.',
      'Treino: X<sub>A\u2013D</sub> + y<sub>A\u2013D</sub><br>Reserva: X<sub>E</sub>; y<sub>E</sub> s\u00f3 na confer\u00eancia',
      'O gabarito reservado n\u00e3o decide quais vari\u00e1veis sobrevivem dentro desta rodada.', '400 c\u00e9lulas nos mesmos 25 blocos'],
    ['Qualidade', 'Uma coluna constante n\u00e3o distingue lugares',
      'Examinamos os valores no treino. Neste exemplo, <strong>sem ilumina\u00e7\u00e3o p\u00fablica vale zero em todas as c\u00e9lulas</strong>. Ela n\u00e3o separa uma linha da outra e sai desta sele\u00e7\u00e3o did\u00e1tica.',
      'Na rodada nacional, o filtro atual remove colunas sem valores v\u00e1lidos ou sem varia\u00e7\u00e3o, al\u00e9m de conferir tipos num\u00e9ricos. N\u00e3o estamos aplicando um corte de 80% de aus\u00eancia: os limites desta execu\u00e7\u00e3o foram configurados em 1,0.',
      'Se valores distintos &lt; 2 \u2192 excluir nesta rodada',
      'Uma vari\u00e1vel pode sobreviver em uma \u00e1rea e sair em outra.', 'Seis candidatas; cinco sobrevivem no treino'],
    ['Ranking individual', 'Treinamos um EBM pequeno para cada vari\u00e1vel',
      'O primeiro ajuste recebe s\u00f3 uma coluna, depois outro ajuste recebe s\u00f3 a seguinte. Medimos a <strong>import\u00e2ncia do termo</strong>, baseada no tamanho m\u00e9dio de suas contribui\u00e7\u00f5es em valor absoluto.',
      'A ordem inicial vem dessa import\u00e2ncia. A AP calculada no treino aparece apenas como diagn\u00f3stico e crit\u00e9rio secund\u00e1rio de ordena\u00e7\u00e3o. <strong>Ela ainda n\u00e3o \u00e9 a AP dos grupos reservados.</strong>',
      'Um modelo por coluna:<br>z = b<sub>0</sub> + f<sub>j</sub>(x<sub>j</sub>)<br><small>Import\u00e2ncia: m\u00e9dia ponderada de |f<sub>j</sub>|. N\u00e3o \u00e9 porcentagem de acerto.</small>',
      'Aqui ordenamos candidatas. Ainda n\u00e3o escolhemos o conjunto final.', 'Import\u00e2ncia unit\u00e1ria no treino desta rodada'],
    ['Redund\u00e2ncia', 'As mesmas c\u00e9lulas ficam quase na mesma ordem?',
      'Imagine uma fila da menor para a maior propor\u00e7\u00e3o de <strong>cal\u00e7ada inadequada</strong>. Agora ordene as mesmas c\u00e9lulas pela propor\u00e7\u00e3o <strong>sem cal\u00e7ada</strong>. A anima\u00e7\u00e3o mostra essas duas filas, usando dez c\u00e9lulas do treino fict\u00edcio.',
      'Se as c\u00e9lulas quase n\u00e3o trocam de posi\u00e7\u00e3o entre as filas, as duas vari\u00e1veis ordenam os lugares de modo parecido. <strong>Spearman mede essa semelhan\u00e7a de ordem.</strong> Mesma ordem: perto de +1. Ordem invertida: perto de \u22121, tamb\u00e9m considerada redundante pelo nosso filtro.',
      'Spearman compara posi\u00e7\u00f5es, n\u00e3o a diferen\u00e7a entre os valores.<br><small>No treino completo: |\u03c1| \u2265 0,70 \u2192 ligar as vari\u00e1veis em um grupo. Empates recebem a posi\u00e7\u00e3o m\u00e9dia.</small>',
      'A correla\u00e7\u00e3o detecta a repeti\u00e7\u00e3o de informa\u00e7\u00e3o. O ranking unit\u00e1rio escolhe a representante.', 'Acompanhe o mesmo ID nas duas ordena\u00e7\u00f5es'],
    ['Top-K', 'Testamos quantas representantes manter',
      'As representantes seguem a ordem do ranking. <strong>Top-1</strong> usa a primeira; <strong>Top-2</strong> usa as duas primeiras; e assim por diante. Cada quantidade K recebe seu pr\u00f3prio ajuste EBM.',
      'Os nomes podem mudar entre folds, porque ranking e Spearman s\u00e3o refeitos em cada treino. O que comparamos ao longo das rodadas \u00e9 a quantidade K dentro desse procedimento.',
      'Top-K = as K primeiras representantes<br><small>K conta vari\u00e1veis, n\u00e3o c\u00e9lulas priorit\u00e1rias.</small>',
      'Mais vari\u00e1veis n\u00e3o garantem melhor resultado na valida\u00e7\u00e3o.', 'Conjunto testado nesta primeira rodada'],
    ['Ajuste do conjunto', 'O EBM aprende uma curva para cada vari\u00e1vel',
      'Agora as K colunas entram <strong>juntas</strong> em um novo EBM, usando somente o treino. Ele aprende pequenas corre\u00e7\u00f5es sucessivas e constr\u00f3i uma fun\u00e7\u00e3o f para cada vari\u00e1vel.',
      'Uma curva pode ser n\u00e3o linear: passar de 10% para 20% n\u00e3o precisa ter o mesmo efeito que passar de 80% para 90%. No nosso ajuste aditivo, n\u00e3o existem termos de intera\u00e7\u00e3o entre vari\u00e1veis.',
      'z = b<sub>0</sub> + f<sub>1</sub>(x<sub>1</sub>) + \u22ef + f<sub>K</sub>(x<sub>K</sub>)',
      'As curvas do conjunto s\u00e3o aprendidas novamente. N\u00e3o somamos os modelos unit\u00e1rios da etapa 4.', 'Curvas do EBM ajustado no treino A\u2013D'],
    ['Previs\u00e3o', 'O modelo recebe as 80 c\u00e9lulas que ficaram fora',
      'O ajuste terminou. Entregamos os valores X do grupo E ao modelo e recebemos uma probabilidade estimada por c\u00e9lula. A coluna y continua escondida do ajuste.',
      'Ordenamos as probabilidades da maior para a menor. Essa lista \u00e9 um ranking de semelhan\u00e7a com o cadastro. Neste momento ainda n\u00e3o chamamos as previs\u00f5es de acertos.',
      'Modelo ajustado + X<sub>E</sub> \u2192 p<sub>E</sub>',
      'Probabilidade \u00e9 a sa\u00edda por c\u00e9lula; AP \u00e9 uma medida do ranking inteiro.', 'Dez primeiras previs\u00f5es do grupo E'],
    ['Confer\u00eancia', 'Reabrimos o gabarito e calculamos a AP',
      'Agora comparamos as previs\u00f5es com o cadastro reservado. A precis\u00e3o diz a fra\u00e7\u00e3o de FCUs entre as c\u00e9lulas examinadas. O recall diz a fra\u00e7\u00e3o das FCUs reservadas j\u00e1 encontradas.',
      'A AP resume a precis\u00e3o nos diferentes avan\u00e7os de recall, percorrendo os cortes do ranking. Seu c\u00e1lculo aqui usa todas as 80 c\u00e9lulas reservadas, <strong>n\u00e3o apenas as dez mostradas</strong>. Empates de probabilidade s\u00e3o tratados em conjunto pela m\u00e9trica.',
      'AP = \u03a3 (R<sub>n</sub> \u2212 R<sub>n\u22121</sub>) \u00d7 P<sub>n</sub><br><small>P = precis\u00e3o; R = recall. AP n\u00e3o \u00e9 acur\u00e1cia.</small>',
      'Essa AP avalia um modelo, em um grupo que ele n\u00e3o usou para aprender.', 'Previs\u00f5es conferidas com o cadastro fict\u00edcio'],
    ['Revezamento', 'Recome\u00e7amos tudo em cada uma das 25 rodadas',
      'Cada quadrinho \u00e0 direita guarda uma AP. Antes de produzi-la, separamos o grupo da vez e refazemos <strong>filtro, ranking, Spearman e ajuste Top-K</strong> usando s\u00f3 os outros grupos.',
      'Cinco rodadas completam uma repeti\u00e7\u00e3o. Cinco repeti\u00e7\u00f5es geram 25 avalia\u00e7\u00f5es. Dentro de cada \u00e1rea real, os cen\u00e1rios M, I, U e suas combina\u00e7\u00f5es usam as mesmas divis\u00f5es para permitir uma compara\u00e7\u00e3o justa.',
      'Para cada K: 5 repeti\u00e7\u00f5es \u00d7 5 folds = 25 APs',
      'O mesmo K pode corresponder a nomes diferentes em treinos diferentes.', '25 APs do exemplo para a quantidade K escolhida'],
    ['Escolha de K', 'Comparamos a AP m\u00e9dia e aplicamos a regra 1-SE',
      'Para cada K, calculamos a m\u00e9dia das APs. O K com maior m\u00e9dia \u00e9 o <strong>melhor K</strong>. A regra 1-SE aceita uma pequena perda: a melhor m\u00e9dia menos um erro-padr\u00e3o do melhor K.',
      'Escolhemos o menor K que alcan\u00e7a esse limite. A regra pode reduzir a quantidade ou manter o pr\u00f3prio melhor K, como acontece neste exemplo. O erro-padr\u00e3o \u00e9 um resumo usado pela regra; as rodadas se sobrep\u00f5em, portanto n\u00e3o s\u00e3o 25 testes independentes.',
      'Limite = AP<sub>melhor</sub> \u2212 SE<sub>melhor</sub><br>K recomendado = menor K com AP m\u00e9dia \u2265 limite<br><small>No c\u00f3digo: SE = desvio-padr\u00e3o das APs / \u221an.</small>',
      'S\u00f3 comparamos K com todas as avalia\u00e7\u00f5es exigidas conclu\u00eddas.', 'AP m\u00e9dia por K; linha pontilhada = limite 1-SE'],
    ['Lista final', 'Fixamos a quantidade e reconstru\u00edmos a lista',
      'Depois de escolher K pela valida\u00e7\u00e3o, refazemos o ranking e os grupos com toda a \u00e1rea dispon\u00edvel. Guardamos as primeiras K representantes dessa lista final, junto de seus pares de infer\u00eancia.',
      'Para mostrar a equa\u00e7\u00e3o nas pr\u00f3ximas etapas, ajustamos ainda um EBM did\u00e1tico nas 400 c\u00e9lulas com essa lista. <strong>Esse ajuste final do exemplo n\u00e3o tem um novo conjunto de teste independente.</strong>',
      'K escolhido + ranking final da \u00e1rea \u2192 lista de K vari\u00e1veis',
      'O processo de escolha da lista e o treinamento do modelo final s\u00e3o etapas diferentes.', 'Lista do ajuste final did\u00e1tico'],
    ['Equa\u00e7\u00e3o', 'Buscamos a contribui\u00e7\u00e3o de cada valor',
      'Para uma c\u00e9lula, lemos o valor de cada vari\u00e1vel e consultamos sua curva. Cada consulta devolve uma contribui\u00e7\u00e3o f(x). Somamos essas contribui\u00e7\u00f5es ao valor de base b\u2080.',
      'Os valores de base e das curvas foram aprendidos pelo EBM did\u00e1tico. O controle \u00e0 direita muda uma caracter\u00edstica mantendo as outras fixas; a conta acompanha a curva exportada. Isso explica o modelo, <strong>n\u00e3o demonstra um efeito causal no territ\u00f3rio</strong>.',
      'z = b<sub>0</sub> + \u03a3 f<sub>j</sub>(x<sub>j</sub>)<br><small>z est\u00e1 na escala logit. Contribui\u00e7\u00f5es n\u00e3o s\u00e3o pontos percentuais.</small>',
      'Uma contribui\u00e7\u00e3o positiva aumenta z; uma negativa diminui z.', 'Valores da c\u00e9lula e contribui\u00e7\u00f5es aprendidas'],
    ['Probabilidade', 'Transformamos a soma em uma probabilidade',
      'A soma z pode ser negativa ou positiva e n\u00e3o tem limite de 0 a 1. A fun\u00e7\u00e3o log\u00edstica transforma essa soma em uma probabilidade entre 0% e 100%.',
      'As probabilidades ordenam as c\u00e9lulas. Se quisermos uma classe sim/n\u00e3o, precisaremos de uma regra de corte adicional. Na infer\u00eancia real, o IBGE 2022 permanece est\u00e1tico; as outras fam\u00edlias usam seus pares temporais aprovados.',
      'p(FCU | x) = 1 / (1 + e<sup>\u2212z</sup>)',
      'p de uma c\u00e9lula n\u00e3o \u00e9 a AP do modelo e n\u00e3o garante que o cadastro esteja completo.', 'A mesma equa\u00e7\u00e3o, agora na escala de probabilidade'],
    ['Resultado real', 'Agora compare com a sele\u00e7\u00e3o IBGE de Aracaju',
      'Sa\u00edmos do exemplo fict\u00edcio. Este gr\u00e1fico vem dos outputs reais de Aracaju: <strong>30 candidatas IBGE</strong>, 84.323 c\u00e9lulas e 25 avalia\u00e7\u00f5es por K eleg\u00edvel.',
      'O melhor K foi 17. A regra 1-SE recomendou 16, com AP m\u00e9dia de 0,8372. Essa \u00e9 uma avalia\u00e7\u00e3o usada na sele\u00e7\u00e3o, n\u00e3o uma prova final independente. As curvas e a equa\u00e7\u00e3o das etapas anteriores continuam pertencendo apenas ao exemplo sint\u00e9tico.',
      'Aracaju / IBGE: K recomendado = 16<br>AP m\u00e9dia = 0,8372',
      'As demais \u00e1reas e combina\u00e7\u00f5es est\u00e3o na aba Resultados.', 'Curva real AP \u00d7 K: Aracaju, cen\u00e1rio IBGE']
  ];

  function name(id) { return '<span class="variable-name">' + esc(label(id)) + '<small>' + esc(id) + '</small></span>'; }
  function table(headers, rows, wide = false) {
    return '<div class="example-table-scroll' + (wide ? ' wide' : '') + '"><table class="visual-table"><thead><tr>' + headers.map(h => '<th scope="col">' + h + '</th>').join('') + '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(cell => '<td>' + cell + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  }
  function kControl() {
    return '<label class="example-control">Vari\u00e1veis no modelo: K <input type="range" id="ibge-k" min="1" max="' + Object.keys(data.first.models).length + '" step="1" value="' + state.k + '"><output>' + state.k + '</output></label>';
  }
  function wireK() {
    const input = document.getElementById('ibge-k');
    if (input) input.addEventListener('change', () => { state.k = Number(input.value); render(); });
    if (input) input.addEventListener('input', () => { input.nextElementSibling.textContent = input.value; });
  }
  function svg(width, height, body, aria) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + esc(aria) + '">' + body + '</svg>';
  }
  function chartCurve(rows, selected, threshold, width) {
    const w = Math.max(240, Math.round(width)), h = 260, left = 40, right = w - 18, bottom = h - 42;
    const maxK = Math.max(...rows.map(row => row.k));
    const x = k => left + (k - 1) / Math.max(1, maxK - 1) * (right - left);
    const y = value => bottom - value * (bottom - 18);
    let body = '';
    for (const tick of [0, .25, .5, .75, 1]) body += '<line x1="' + left + '" x2="' + right + '" y1="' + y(tick) + '" y2="' + y(tick) + '" stroke="#d8e3e8"/><text x="' + (left - 7) + '" y="' + (y(tick) + 4) + '" text-anchor="end" class="chart-axis">' + f(tick, 2) + '</text>';
    body += '<line x1="' + left + '" x2="' + right + '" y1="' + y(threshold) + '" y2="' + y(threshold) + '" class="chart-threshold"/>';
    body += '<path d="' + rows.map((row, i) => (i ? 'L' : 'M') + x(row.k) + ',' + y(row.mean)).join(' ') + '" class="chart-line"/>';
    rows.forEach(row => {
      body += '<circle cx="' + x(row.k) + '" cy="' + y(row.mean) + '" r="' + (row.k === selected ? 5 : 3) + '" class="chart-point' + (row.k === selected ? ' selected' : '') + '"><title>K=' + row.k + '; AP=' + f(row.mean, 4) + '; SE=' + f(row.se, 4) + '</title></circle>';
      if (maxK <= 6 || [1, 4, 8, 12, 16, maxK].includes(row.k)) body += '<text x="' + x(row.k) + '" y="' + (bottom + 19) + '" text-anchor="middle" class="chart-axis">' + row.k + '</text>';
    });
    body += '<text x="' + (w / 2) + '" y="' + (h - 4) + '" text-anchor="middle" class="chart-title">K: quantidade de vari\u00e1veis</text><text x="' + left + '" y="12" class="chart-title">AP m\u00e9dia</text>';
    return svg(w, h, body, 'AP media por quantidade de variaveis, com limite 1-SE e K recomendado destacado.');
  }
  function termChart(term, width) {
    const w = Math.max(240, Math.round(width)), h = 185, left = 36, right = w - 14, bottom = h - 36;
    const scores = term.scores.slice(1, term.cuts.length + 2);
    const max = Math.max(.3, ...scores.map(Math.abs));
    const x = value => left + (value - term.min) / (term.max - term.min || 1) * (right - left);
    const y = value => 18 + (max - value) / (max * 2) * (bottom - 18);
    const edges = [term.min, ...term.cuts, term.max];
    let path = '';
    scores.forEach((score, i) => { path += (i ? 'L' : 'M') + x(edges[i]) + ',' + y(score) + 'L' + x(edges[i + 1]) + ',' + y(score); });
    return svg(w, h, '<line x1="' + left + '" x2="' + right + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="#b7cbd4"/><path d="' + path + '" class="chart-line"/>' + [-max, 0, max].map(v => '<text x="' + (left - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" class="chart-axis">' + f(v, 1) + '</text>').join('') + [term.min, (term.min + term.max) / 2, term.max].map(v => '<text x="' + x(v) + '" y="' + (bottom + 18) + '" text-anchor="middle" class="chart-axis">' + f(v, term.max > 10 ? 0 : 1) + '</text>').join('') + '<text x="' + left + '" y="12" class="chart-axis">Contribui\u00e7\u00e3o em logit</text>', label(term.id) + ': curva EBM de contribuicao em logit.');
  }
  function contribution(term, value) {
    let bin = 1;
    while (bin <= term.cuts.length && value >= term.cuts[bin - 1]) bin++;
    return term.scores[bin];
  }
  function prediction() {
    const terms = data.final.terms.map(term => ({ id: term.id, value: state.values[term.id], score: contribution(term, state.values[term.id]) }));
    const z = data.final.intercept + terms.reduce((total, term) => total + term.score, 0);
    return { z, p: 1 / (1 + Math.exp(-z)), terms };
  }
  function resetCell(index) {
    state.cell = index;
    data.final.terms.forEach(term => { state.values[term.id] = data.cells[index].x[data.features.findIndex(feature => feature.id === term.id)]; });
  }
  function updateEquation() {
    const result = prediction();
    result.terms.forEach((term, i) => {
      document.getElementById('term-value-' + i).textContent = f(term.value, term.value > 10 ? 0 : 2);
      document.getElementById('term-score-' + i).textContent = 'f(x) = ' + (term.score >= 0 ? '+' : '') + f(term.score);
    });
    const signed = value => (value >= 0 ? ' + ' : ' \u2212 ') + f(Math.abs(value));
    document.getElementById('equation-values').innerHTML = '<strong>z = ' + f(data.final.intercept) + result.terms.map(t => signed(t.score)).join('') + ' = ' + f(result.z) + '</strong><br>p = 1 / (1 + e<sup>\u2212(' + f(result.z) + ')</sup>)';
    document.getElementById('equation-probability').textContent = f(result.p * 100, 1) + '%';
    document.getElementById('equation-fill').style.width = result.p * 100 + '%';
    const all = [{ id: 'Valor de base b\u2080', score: data.final.intercept }, ...result.terms];
    const scale = Math.max(1, ...all.map(term => Math.abs(term.score)));
    document.getElementById('equation-bars').innerHTML = all.map(term => '<div><span>' + esc(label(term.id)) + '</span><span class="track"><span class="bar ' + (term.score < 0 ? 'negative' : '') + '" style="left:' + (term.score < 0 ? 50 - Math.abs(term.score) / scale * 50 : 50) + '%;width:' + Math.abs(term.score) / scale * 50 + '%"></span></span><output>' + f(term.score) + '</output></div>').join('');
  }
  function equation() {
    visual.innerHTML = '<label class="example-control">C\u00e9lula fict\u00edcia <select id="equation-cell">' + [4, 20, 58, 103].map(index => '<option value="' + index + '"' + (state.cell === index ? ' selected' : '') + '>' + data.cells[index].id + '</option>').join('') + '</select></label><div class="equation-terms">' + data.final.terms.map((term, i) => '<label class="equation-term"><span>' + esc(label(term.id)) + '</span><output id="term-value-' + i + '"></output><input type="range" data-term="' + esc(term.id) + '" min="' + term.min + '" max="' + term.max + '" step="any" value="' + state.values[term.id] + '"><output id="term-score-' + i + '"></output><small>' + esc(term.id) + '</small></label>').join('') + '</div><div id="equation-bars" class="contribution-bars"></div><div id="equation-values" class="equation-values" aria-live="polite"></div><div class="probability-result"><strong id="equation-probability"></strong><div class="probability-track"><span id="equation-fill"></span></div></div><p class="example-footnote">Probabilidade do EBM did\u00e1tico. Valores num\u00e9ricos exibidos arredondados; a soma usa a precis\u00e3o completa.</p>';
    visual.querySelectorAll('[data-term]').forEach(input => input.addEventListener('input', () => { state.values[input.dataset.term] = Number(input.value); updateEquation(); }));
    document.getElementById('equation-cell').addEventListener('change', event => { resetCell(Number(event.target.value)); equation(); });
    updateEquation();
  }
  function renderVisual() {
    window.LessonMotion?.destroy('spearman-celulas');
    const width = visual.clientWidth || 600;
    const model = data.first.models[String(state.k)];
    if (state.step === 0) {
      visual.innerHTML = table(['C\u00e9lula', ...data.features.map((_, i) => 'x' + (i + 1)), 'y'], data.cells.slice(0, 6).map(cell => [cell.id, ...cell.x.map((value, i) => f(value, i === 4 ? 0 : 2)), cell.y]), true) + '<p class="example-footnote">Seis das 400 linhas. ID identifica a c\u00e9lula; x1\u2013x6 s\u00e3o suas caracter\u00edsticas; y \u00e9 o gabarito.</p>' + table(['Coluna', 'Vari\u00e1vel IBGE'], data.features.map((feature, i) => ['x' + (i + 1), name(feature.id)])) + '<p class="example-footnote">Propor\u00e7\u00f5es est\u00e3o entre 0 e 1. Nomes IBGE reais; todos os valores aqui s\u00e3o fict\u00edcios.</p>';
    } else if (state.step === 1) {
      visual.innerHTML = '<div class="example-grid" role="img" aria-label="25 blocos: 20 de treino e cinco reservados para validar.">' + data.divisions[0].map((group, b) => '<div class="example-block' + (group === 4 ? ' validation' : '') + '">' + data.cells.slice(b * 16, b * 16 + 16).map(cell => '<span class="' + (cell.y && group !== 4 ? 'fcu' : '') + '"></span>').join('') + '<i>' + 'ABCDE'[group] + '</i></div>').join('') + '</div><div class="example-legend"><span class="train-text">A\u2013D: treino (320)</span><span class="validation-text">E: reservado (80)</span></div>';
    } else if (state.step === 2) {
      visual.innerHTML = table(['Vari\u00e1vel', 'Valores distintos', 'Decis\u00e3o'], data.first.audit.map(row => [name(row.feature), row.distinct, '<span class="example-badge' + (row.kept ? '' : ' excluded') + '">' + (row.kept ? 'Mantida' : 'Constante: sai') + '</span>'])) + '<p class="example-footnote">Este quadro considera somente as 320 c\u00e9lulas do treino. A exclus\u00e3o de ilumina\u00e7\u00e3o \u00e9 uma constru\u00e7\u00e3o do exemplo, n\u00e3o uma conclus\u00e3o sobre o Brasil.</p>';
    } else if (state.step === 3) {
      const max = Math.max(...data.first.ranking.map(row => row.ebm_unit_importance));
      visual.innerHTML = '<div class="rank-bars">' + data.first.ranking.map(row => '<div class="rank-bar"><span>' + row.rank_ebm_unitario + '. ' + esc(label(row.feature)) + '</span><span class="rank-track"><span class="rank-fill" style="width:' + row.ebm_unit_importance / max * 100 + '%"></span></span><output>' + f(row.ebm_unit_importance) + '</output></div>').join('') + '</div><p class="example-footnote">Barras: import\u00e2ncia dos EBMs unit\u00e1rios, medida no treino. N\u00e3o s\u00e3o APs nem pesos fixos de uma regress\u00e3o linear.</p>';
    } else if (state.step === 4) {
      window.LessonMotion.spearman(visual, data);
      const ids = [...new Set(data.first.clusters.map(row => row.cluster_id))];
      visual.insertAdjacentHTML('beforeend', '<details class="selection-method"><summary>As quatro representantes que seguem para Top-K</summary><p>Grupos conectados: podem existir liga\u00e7\u00f5es em cadeia, sem que todos os pares ultrapassem 0,70.</p><div class="cluster-list">' + ids.map(id => '<div class="cluster"><strong>Grupo ' + id + '</strong>' + data.first.clusters.filter(row => row.cluster_id === id).map(row => '<span class="' + (row.winner ? 'winner' : '') + '">' + esc(label(row.feature)) + (row.winner ? ' \u2192 representante' : ' \u2192 sai deste grupo') + '</span>').join('') + '</div>').join('') + '</div></details>');
    } else if (state.step === 5) {
      visual.innerHTML = kControl() + '<div class="selected-variables">' + data.first.winners.map((id, i) => '<div class="selected-variable' + (i >= state.k ? ' inactive' : '') + '">' + (i + 1) + '. ' + esc(label(id)) + '<br><small>' + (i < state.k ? 'Entra neste Top-K' : 'Fora deste Top-K') + '</small></div>').join('') + '</div>';
    } else if (state.step === 6) {
      visual.innerHTML = kControl() + '<div class="curve-grid">' + model.terms.map(term => '<section class="curve-panel"><h4>' + esc(label(term.id)) + '</h4></section>').join('') + '</div><p class="example-footnote">Eixo horizontal: valor da vari\u00e1vel. Eixo vertical: contribui\u00e7\u00e3o na escala logit. Todas as curvas deste quadro vieram do ajuste conjunto apenas no treino.</p>';
      visual.querySelectorAll('.curve-panel').forEach((panel, i) => panel.insertAdjacentHTML('beforeend', termChart(model.terms[i], panel.clientWidth)));
    } else if (state.step === 7 || state.step === 8) {
      const reveal = state.step === 8;
      visual.innerHTML = kControl() + table(['Posi\u00e7\u00e3o', 'C\u00e9lula', 'Probabilidade', 'FCU cadastrada'], model.ranking.slice(0, 10).map((row, i) => [i + 1, data.cells[row.cell].id, f(row.p * 100, 1) + '%', reveal ? (row.y ? '<span class="example-badge">Sim</span>' : 'N\u00e3o') : 'Oculta'])) + '<p class="example-footnote">' + (reveal ? '<strong>AP nas 80 c\u00e9lulas reservadas: ' + f(model.ap, 4) + '</strong>. O gabarito foi usado s\u00f3 na confer\u00eancia deste modelo.' : 'As c\u00e9lulas desta lista n\u00e3o participaram do treino do modelo desta rodada.') + '</p>';
    } else if (state.step === 9) {
      visual.innerHTML = kControl() + '<div class="cv-matrix"><span></span>' + [1, 2, 3, 4, 5].map(n => '<strong>Rod. ' + n + '</strong>').join('') + data.divisions.map((_, rep) => '<strong>Rep. ' + (rep + 1) + '</strong>' + [1, 2, 3, 4, 5].map(fold => { const row = data.evaluations.find(r => r.rep === rep + 1 && r.fold === fold && r.k === state.k); return '<span class="ap-value">' + (row ? f(row.ap) : '\u2013') + '</span>'; }).join('')).join('') + '</div><p class="example-footnote">25 valores calculados no exemplo sint\u00e9tico. Cada linha usa uma divis\u00e3o; cada coluna troca o grupo reservado.</p>';
    } else if (state.step === 10) {
      visual.innerHTML = chartCurve(data.curve, data.recommendedK, data.threshold, width) + table(['K', 'AP m\u00e9dia', 'Erro-padr\u00e3o', 'Rodadas'], data.curve.map(row => [row.k + (row.k === data.recommendedK ? ' \u2190 recomendado' : ''), f(row.mean, 4), f(row.se, 4), row.n])) + '<p class="example-footnote">Limite 1-SE: ' + f(data.threshold, 4) + '. Melhor K = ' + data.bestK + '; recomendado = ' + data.recommendedK + '. Neste exemplo a regra n\u00e3o reduziu K.</p>';
    } else if (state.step === 11) {
      visual.innerHTML = table(['Ordem', 'Vari\u00e1vel final'], data.final.terms.map((term, i) => [i + 1, name(term.id)])) + '<p class="example-footnote">K = ' + data.recommendedK + '. Lista reconstru\u00edda nas 400 c\u00e9lulas do exemplo, depois da compara\u00e7\u00e3o de K. Para o IBGE, a coluna de 2022 permanece a mesma na infer\u00eancia.</p>';
    } else if (state.step === 12 || state.step === 13) {
      equation();
    } else {
      const best = real.curve.find(row => row.k === real.summary.k_best);
      visual.innerHTML = chartCurve(real.curve, real.summary.k_recomendado, best.mean - best.se, width) + table(['Resultado real', 'Valor'], [['Candidatas', real.summary.n_variaveis_base_area], ['Representantes na sele\u00e7\u00e3o final', real.summary.n_clusters], ['Melhor K / AP', real.summary.k_best + ' / ' + f(real.summary.ap_best, 4)], ['K recomendado / AP', real.summary.k_recomendado + ' / ' + f(real.summary.ap_recomendado, 4)]]) + '<details class="selection-method"><summary>As 16 vari\u00e1veis recomendadas em Aracaju</summary>' + table(['Vari\u00e1vel selecionada'], real.summary.variaveis_recomendadas.map(id => ['<code>' + esc(id) + '</code>'])) + '</details><p class="example-footnote">Fonte: 06_topk_resumo.csv e 13_resumo_recomendado.json, cen\u00e1rio IBGE / Aracaju. Resultados reais da sele\u00e7\u00e3o, separados do exemplo acima.</p>';
    }
    wireK();
  }
  function render() {
    if (root.hidden) return;
    const [phase, title, one, two, formula, takeaway, caption] = steps[state.step];
    document.getElementById('ibge-phase').textContent = phase + ' \u00b7 ' + (state.step + 1) + ' de ' + steps.length;
    document.getElementById('ibge-title').textContent = title;
    document.getElementById('ibge-story').innerHTML = '<p>' + one + '</p><p>' + two + '</p>';
    document.getElementById('ibge-formula').innerHTML = formula;
    document.getElementById('ibge-takeaway').textContent = takeaway;
    document.getElementById('ibge-visual-title').textContent = caption;
    document.getElementById('ibge-visual-source').textContent = state.step === 14 ? 'DADOS REAIS \u00b7 ARACAJU' : 'DADOS FICT\u00cdCIOS \u00b7 EBM CALCULADO';
    select.value = state.step;
    previous.disabled = state.step === 0;
    next.disabled = state.step === steps.length - 1;
    renderVisual();
  }
  steps.forEach((step, i) => { const option = document.createElement('option'); option.value = i; option.textContent = (i + 1) + '. ' + step[0]; select.append(option); });
  select.addEventListener('change', () => { state.step = Number(select.value); render(); });
  previous.addEventListener('click', () => { if (state.step > 0) { state.step--; render(); } });
  next.addEventListener('click', () => { if (state.step < steps.length - 1) { state.step++; render(); } });
  let resizeFrame;
  addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      const movie = window.LessonMotion?.get('spearman-celulas');
      if (state.step === 4 && movie) movie.resize();
      else render();
    });
  });
  resetCell(state.cell);
  window.IbgeExample = { render, state, prediction, contribution, data, real };
})();
