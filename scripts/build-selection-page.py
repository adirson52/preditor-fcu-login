"""Publish a dated selection snapshot alongside the existing offline validator.

No training, split generation or changes to the source data are performed here.
Requires beautifulsoup4. The generated HTML is deployed as a static file.
"""
import argparse
import csv
import hashlib
import html
import io
import json
import shutil
from datetime import datetime
from pathlib import Path

from bs4 import BeautifulSoup
from selection_catalog import catalogue, catalogue_html, real_ibge

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "selection"
SCENARIOS = [
    ("morfologico", "M", 58),
    ("ibge", "I", 30),
    ("economico_urbano", "U", 26),
    ("morfologico_ibge", "M + I", 88),
    ("morfologico_economico_urbano", "M + U", 84),
    ("ibge_economico_urbano", "I + U", 56),
    ("completo", "Completo", 114),
]
AREAS = [
    ("aracaju", "Aracaju"), ("baixada_santista", "Baixada Santista"),
    ("belem", "Bel\u00e9m"), ("belo_horizonte", "Belo Horizonte"),
    ("brasilia", "Bras\u00edlia"), ("campinas", "Campinas"),
    ("campo_grande", "Campo Grande"), ("cuiaba", "Cuiab\u00e1"),
    ("curitiba", "Curitiba"), ("florianopolis", "Florian\u00f3polis"),
    ("fortaleza", "Fortaleza"), ("goiania", "Goi\u00e2nia"),
    ("joao_pessoa", "Jo\u00e3o Pessoa"), ("maceio", "Macei\u00f3"),
    ("manaus", "Manaus"), ("natal", "Natal"),
    ("porto_alegre", "Porto Alegre"), ("recife", "Recife"),
    ("rio_de_janeiro", "Rio de Janeiro"), ("salvador", "Salvador"),
    ("sao_jose_dos_campos", "S\u00e3o Jos\u00e9 dos Campos"),
    ("sao_luis", "S\u00e3o Lu\u00eds"), ("sao_paulo", "S\u00e3o Paulo"),
    ("sorocaba", "Sorocaba"), ("teresina", "Teresina"), ("vitoria", "Vit\u00f3ria"),
]


def fragment(markup):
    return BeautifulSoup(markup, "html.parser")


def read_snapshot(output):
    state = json.loads((output / "estado_selecao_paralela.json").read_text(encoding="utf-8-sig"))
    summary_bytes = (output / "tabela_resumo_escolha_modelo_parcial.csv").read_bytes()
    records = list(csv.DictReader(io.StringIO(summary_bytes.decode("utf-8-sig"))))
    index = {(row["area"], row["cenario"]): row for row in records}
    if len(index) != len(records) or len(index) != state["completed"]:
        raise ValueError("State and CSV differ. Retry after the scheduler finishes updating its snapshot.")
    active = {(row["area"], row["scenario"]) for row in state.get("active", [])}
    known_areas = {"area_cu_" + slug for slug, _ in AREAS}
    known_scenarios = {name for name, _, _ in SCENARIOS}
    if any(area not in known_areas or scenario not in known_scenarios for area, scenario in index):
        raise ValueError("Unexpected area or scenario in selection outputs.")
    rows = []
    for slug, name in AREAS:
        area = "area_cu_" + slug
        values = []
        for scenario, label, candidates in SCENARIOS:
            record = index.get((area, scenario))
            k = int(record["k_recomendado"]) if record else None
            if k is not None and not 1 <= k <= candidates:
                raise ValueError(f"Invalid selected K: {area}, {scenario}, {k}")
            status = "completed" if record else "running" if (area, scenario) in active else "pending"
            values.append({"scenario": scenario, "label": label, "k": k, "status": status})
        completed = sum(value["status"] == "completed" for value in values)
        status = "completed" if completed == 7 else "running" if completed or any(v["status"] == "running" for v in values) else "pending"
        rows.append({"id": area, "name": name, "completed": completed, "status": status, "values": values})
    return {
        "updatedAt": state["updated_at"] + "-03:00",
        "timeZone": "America/Sao_Paulo",
        "completed": len(index), "expected": 182,
        "completedAreas": sum(row["completed"] == 7 for row in rows),
        "candidates": 114, "sensorsIncluded": False,
        "summarySHA256": hashlib.sha256(summary_bytes).hexdigest(),
        "rows": rows,
    }


def table_rows(snapshot):
    result = []
    for row in snapshot["rows"]:
        cells = []
        for value in row["values"]:
            if value["status"] == "completed":
                body = f'<span class="selected-k">{value["k"]}</span>'
                label = f'{row["name"]}, {value["label"]}: {value["k"]} selecionadas'
            elif value["status"] == "running":
                body = '<span class="calculating">Calc.</span>'
                label = f'{row["name"]}, {value["label"]}: calculando na data do retrato'
            else:
                body = '<span class="not-started">&ndash;</span>'
                label = f'{row["name"]}, {value["label"]}: ainda sem resultado'
            cells.append(f'<td data-scenario="{value["scenario"]}" aria-label="{html.escape(label)}">{body}</td>')
        n = row["completed"]
        result.append(f'''<tr data-area="{row['id']}" data-status="{row['status']}">
<th scope="row">{html.escape(row['name'])}</th>
<td><span class="completion {row['status']}">{n}<span>/7</span></span><progress max="7" value="{n}" aria-label="Cen\u00e1rios conclu\u00eddos em {html.escape(row['name'])}"></progress></td>
{''.join(cells)}</tr>''')
    return "\n".join(result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--validator", required=True, type=Path)
    parser.add_argument("--outputs", required=True, type=Path)
    args = parser.parse_args()
    snapshot = read_snapshot(args.outputs)
    soup = BeautifulSoup(args.validator.read_text(encoding="utf-8"), "html.parser")
    assert len(soup.select(".site-tab")) == 2
    assert soup.find(id="map-data")
    lesson = BeautifulSoup((ASSETS / "illustrative.template.html").read_text(encoding="utf-8"), "html.parser")
    lesson_css = lesson.find("style").extract().string
    lesson_js = lesson.find("script").extract().string
    old_js = next(script for script in soup.find_all("script") if "const root = document.getElementById('split-espacial-passos')" in (script.string or ""))
    old_js.string = lesson_js
    old_css = next(style for style in soup.find_all("style") if "#split-espacial-passos .sp-navigation" in (style.string or ""))
    old_css.string = lesson_css
    soup.find(id="split-espacial-passos").replace_with(lesson.find(id="split-espacial-passos"))
    catalog = catalogue(args.outputs)
    real = real_ibge(args.outputs)
    (ASSETS / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (ASSETS / "ibge-aracaju.json").write_text(json.dumps(real, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    snapshot["validatorSHA256"] = hashlib.sha256(args.validator.read_bytes()).hexdigest()
    when = datetime.fromisoformat(snapshot["updatedAt"]).strftime("%d/%m/%Y \u00e0s %H:%M")
    replacements = {
        "__ROWS__": table_rows(snapshot), "__DATE__": when,
        "__DATETIME__": snapshot["updatedAt"],
        "__COMPLETED__": str(snapshot["completed"]),
        "__AREAS__": str(snapshot["completedAreas"]),
        "__PERCENT__": f'{100 * snapshot["completed"] / 182:.1f}'.replace(".", ","),
        "__CATALOG__": catalogue_html(catalog),
    }
    results = (ASSETS / "results.template.html").read_text(encoding="utf-8")
    for token, value in replacements.items():
        results = results.replace(token, value)
    soup.select_one("main").append(fragment((ASSETS / "variables.template.html").read_text(encoding="utf-8")))
    soup.select_one("main").append(fragment(results))
    soup.find(id="painel-resultados")["hidden"] = ""
    header = soup.select_one(".site-header")
    header.clear()
    header.append(fragment('''<nav class="selection-breadcrumb" aria-label="Navega\u00e7\u00e3o principal"><a href="/"><i data-lucide="arrow-left" aria-hidden="true"></i>Preditor FCU</a><span>Pesquisa e metodologia</span></nav>
<h1>Sele\u00e7\u00e3o de vari\u00e1veis</h1><p>Resultados por \u00e1rea de estudo, fam\u00edlias de vari\u00e1veis e valida\u00e7\u00e3o espacial.</p>'''))
    tabs = soup.select_one(".site-tabs")
    tabs["aria-label"] = "Sele\u00e7\u00e3o e valida\u00e7\u00e3o"
    tabs.append(fragment('''<button type="button" class="site-tab" id="aba-variaveis" role="tab" aria-controls="painel-variaveis" aria-selected="false" tabindex="-1" data-tab="variaveis-exemplo"><i data-lucide="chart-no-axes-combined" aria-hidden="true"></i>Vari\u00e1veis: exemplo</button><button type="button" class="site-tab" id="aba-resultados" role="tab" aria-controls="painel-resultados" aria-selected="false" tabindex="-1" data-tab="resultados"><i data-lucide="table-2" aria-hidden="true"></i>Resultados</button>'''))
    first_tab = soup.find(id="aba-passos")
    first_tab["data-tab"] = "exemplo-ilustrativo"
    first_tab.clear()
    first_tab.append(fragment('<i data-lucide="book-open" aria-hidden="true"></i>Exemplo ilustrativo'))
    soup.find(id="painel-passos").select_one(".panel-heading h2").string = "Exemplo ilustrativo: como dividimos o territ\u00f3rio"
    navigation = soup.find_all("script")[-1]
    navigation.string = (ASSETS / "site-tabs.js").read_text(encoding="utf-8")
    soup.title.string = "Sele\u00e7\u00e3o de vari\u00e1veis | Preditor FCU"
    review = soup.find(id="metodologia-reserva")
    style = soup.new_tag("style", id="selection-styles")
    style.string = (ASSETS / "results.css").read_text(encoding="utf-8") + "\n" + (ASSETS / "teaching.css").read_text(encoding="utf-8")
    soup.head.append(style)
    script = soup.new_tag("script", id="selection-controls")
    script.string = (ASSETS / "results.js").read_text(encoding="utf-8")
    soup.body.append(script)
    for element_id, filename in [("ibge-example-data", "ibge-example.json"), ("ibge-real-data", "ibge-aracaju.json")]:
        data_script = soup.new_tag("script", id=element_id, type="application/json")
        data_script.string = (ASSETS / filename).read_text(encoding="utf-8").replace("</script", "<\\/script")
        soup.body.append(data_script)
    example_script = soup.new_tag("script", id="ibge-example-controller")
    example_script.string = (ASSETS / "variables.js").read_text(encoding="utf-8")
    soup.body.append(example_script)
    meta = soup.new_tag("meta", attrs={"name": "description", "content": "Sele\u00e7\u00e3o de vari\u00e1veis nas 26 \u00e1reas de estudo: sete cen\u00e1rios por \u00e1rea e validador espacial interativo."})
    soup.head.append(meta)
    for link in soup.find_all("a", href=True):
        if link["href"].startswith("mapa_aracaju/"):
            link["href"] = "/selection/" + link["href"].split("/")[-1]
    # Include only the small public audit and summary, not national source files or local paths.
    map_dir = args.validator.parent / "mapa_aracaju"
    shutil.copyfile(map_dir / "aracaju_25_divisoes.csv", ASSETS / "aracaju_25_divisoes.csv")
    audit = json.loads((map_dir / "auditoria_aracaju.json").read_text(encoding="utf-8"))
    for field in ("source", "split", "roadsSource"):
        audit[field] = audit[field].replace("\\", "/").rsplit("/", 1)[-1]
    (ASSETS / "auditoria_aracaju.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (ASSETS / "results.json").write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with (ASSETS / "results.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["Area", "Concluidos", *[s[1] for s in SCENARIOS], "Atualizado em"])
        for row in snapshot["rows"]:
            writer.writerow([row["name"], f'{row["completed"]}/7', *[v["k"] if v["k"] is not None else "Calc." if v["status"] == "running" else "-" for v in row["values"]], snapshot["updatedAt"]])
    ids = [element["id"] for element in soup.find_all(id=True)]
    assert len(ids) == len(set(ids))
    assert len(soup.select('.site-tab')) == len(soup.select('[role="tabpanel"]')) == 4
    assert len(soup.select('#selection-table tbody tr')) == 26
    assert len(soup.select('#selection-status option')) == 4
    assert len(soup.select('[data-variable]')) == 114
    assert not soup.find("iframe")
    assert not soup.find("script", src=True)
    assert soup.find(id="map-data").string
    page = str(soup)
    assert "file:///" not in page
    destination = ROOT / "selecaovariaveis.html"
    destination.write_text(page, encoding="utf-8", newline="\n")
    print(f"{destination}: {snapshot['completed']}/182 scenarios, 26 areas, 4 tabs; {when} BRT")


if __name__ == "__main__":
    main()
