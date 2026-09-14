# Selection and spatial validator

Public route: `/selecaovariaveis` (`selecaovariaveis.html`, Vercel clean URLs).

Four views share one document, in this order: Illustrative example, Aracaju,
Variables example, and Results. The map
contains the existing saved splits, cell geometries and offline road context.
No model is trained by this page. The main dashboard and authentication are
unchanged, except for a navigation link to this page.

## Snapshot

`results.json` records the publication timestamp, selected K and status for
every area/scenario. `results.csv` exports the same 26 rows. The page is a dated
snapshot, not a live monitor. Completed counts come from the consolidated CSV,
not from the expected number of variables or a progress estimate.

M = 58 morphology candidates; I = 30 IBGE candidates; U = 26 economic/urban
candidates. Seven unions, 182 selections in 26 areas. Sentinel-1 and Sentinel-2
are excluded from this round. Combinations do not enable EBM interaction terms.

## Regenerate locally

Install `beautifulsoup4` in the research Python environment, then run from this
repository, passing the existing documentation index and scheduler output folder:

```powershell
python scripts/build-selection-page.py `
  --validator "E:\Banco de dados Preditor Br\06_IBGE.v3\05_documentacao\index.html" `
  --outputs "E:\Banco de dados Preditor Br\06_IBGE.v3\03_outputs\32_selecao_macrofamilias_paralela"
```

The generator checks CSV/state consistency and fails instead of publishing a
mixed snapshot. It preserves the source validator and strips local source paths
from the downloadable audit. It does not copy national Parquets, training
outputs, credentials or private databases into the website.

`results.template.html`, `results.css` and `results.js` are the editable results
view. The final HTML embeds all validator dependencies and loads the map lazily.
Vercel serves the generated HTML directly and does not need the research files.

`illustrative.template.html` contains the spatial lesson, with interactive
explanations of rounds, repeated splits and all 25 evaluations in stages 10-12.
`site-tabs.js` preserves the old `#passo-a-passo` deep link as an alias.

`catalog.json` is generated from the actual candidate-pair CSV. The disclosure
lists contain exactly 114 unique candidates, their sources and inference pairs.
`ibge-aracaju.json` contains the real saved AP/K curve and recommendation for
Aracaju. It is kept separate from the synthetic example.

## Calculated teaching example

`variables.template.html`, `variables.js` and `teaching.css` form a 15-stage
walkthrough. It uses six real IBGE variable names on 400 synthetic cells, with
five fictional balanced assignments of the same 25 blocks. Values and targets
are explicitly synthetic; the EBM fits and reported APs are actually computed.
They must not be presented as observations or performance of the national model.

To regenerate its small EBM fits (one CPU worker; no national data touched):

```powershell
python scripts/build-ibge-example.py `
  --core "E:\Banco de dados Preditor Br\06_IBGE.v3\02_scripts\06_selecao_ebm_unitario_spearman.py"
```

This reuses the research core's numeric audit, unitary EBM ranking, Spearman
clustering and additive EBM fit functions. The didactic run uses smaller
iteration/bag settings, not the production hyperparameters. It exports bins,
term scores, intercepts, holdout rankings and reference predictions. The browser
uses the exported lookup functions and logistic link. Reference predictions
check Python/JavaScript equation agreement below 1e-12.

## Verify

```powershell
npm ci
npx playwright test tests/selection.spec.js --workers=1
```

For an already running local server or a published deployment:

```powershell
$env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:8779"
npx playwright test tests/selection.spec.js --workers=1
```

Coverage includes all 182 table values/statuses, filters, CSV download, four
tabs, the 400-cell example, the real map, map state preservation, canvas pixels,
desktop/mobile overflow, all 15 teaching stages, equation controls and numeric
agreement, all 114 source-backed catalogue entries, and dashboard navigation.

## Moving diagrams and GIFs

`lesson-motion.js` replaces the two static repetition grids with 25 identifiable
blocks moving between group lanes (not geographic positions). The Spearman scene
sorts two copies of the same ten synthetic training cells by their two values.
It distinguishes these ten illustrated observations from the reported correlation
on all 320 training cells. Rank ties use average ranks. Pause, replay, seek and
reduced-motion preferences are supported; hidden tabs stop animation work.

The downloadable GIFs are deterministic renders of those same scenes, not a
separate illustration. To regenerate with a local test server on port 8779:

```powershell
node scripts/render-selection-gifs.cjs "E:\Banco de dados Preditor Br\06_IBGE.v3\05_documentacao\validador\gif-frames"
python scripts/encode-selection-gifs.py "E:\Banco de dados Preditor Br\06_IBGE.v3\05_documentacao\validador\gif-frames"
npx playwright test tests/selection.spec.js tests/selection-motion.spec.js --workers=1
```

Only the final two GIFs are published. PNG rendering frames stay outside the repo.
