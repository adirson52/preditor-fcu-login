# Selection and spatial validator

Public route: `/selecaovariaveis` (`selecaovariaveis.html`, Vercel clean URLs).

Three views share one document: Results, Step by step, and Aracaju. The map
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

Coverage includes all 182 table values/statuses, filters, CSV download, three
tabs, the 400-cell example, the real map, map state preservation, canvas pixels,
desktop/mobile overflow, and the dashboard navigation link.
