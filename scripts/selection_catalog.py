"""Public, source-backed candidate catalogue and real Aracaju selection curve."""
import csv
import html
import json
from collections import defaultdict


def catalogue(output):
    rows = list(csv.DictReader((output / "00_lista_variaveis_familias_pares.csv").open(encoding="utf-8-sig")))
    candidates = [row for row in rows if row["candidata_rodada"].lower() == "true"]
    groups = defaultdict(list)
    for row in candidates:
        name = row["variavel_treino_2022"]
        family = row["macrofamilia_codigo"]
        if family == "ibge":
            group = "Domicilios e populacao" if name.startswith("ibge_") else (
                "Banheiro, renda, agua e esgoto" if name in {
                    "m_ibge_banh_2022", "m_ibge_renddppo_2022", "p_ibge_1banhexc_2022",
                    "p_ibge_banhinad_2022", "p_ibge_naorede_2022", "p_ibge_esginade_2022"
                } else "Lixo e entorno urbano")
        elif "gba" in name:
            group = "Edificacoes GBA"
        elif name in {"decli_media", "has_decliv30"}:
            group = "Topografia"
        elif name.startswith(("idade_ocupacao_", "has_urbano_idade_")):
            group = "Presenca e idade urbana MapBiomas"
        elif family == "morfologico":
            group = "Vias e quadras OSM"
        elif name.startswith("cnpj_"):
            group = "Atividade economica CNPJ"
        else:
            group = "Equipamentos e servicos OSM"
        groups[(family, group)].append({
            "id": name, "label": row["nome_amigavel"], "source": row["fonte"],
            "year": row["ano_observacao"], "inference": row["variavel_inferencia_2026"],
            "static": row["estatica"].lower() == "sim",
        })
    assert len(candidates) == len({row["variavel_treino_2022"] for row in candidates}) == 114
    result = []
    for code, letter, title, count, description in [
        ("morfologico", "M", "Morfologia", 58, "Edificacoes, vias e quadras, topografia e ocupacao urbana."),
        ("ibge", "I", "IBGE", 30, "Domicilios, populacao, renda, saneamento e entorno. Sem variaveis do responsavel."),
        ("economico_urbano", "U", "Atividade economica e contexto urbano", 26, "Estabelecimentos CNPJ, equipamentos e servicos OSM."),
    ]:
        blocks = [{"name": name, "variables": variables} for (family, name), variables in groups.items() if family == code]
        assert sum(len(block["variables"]) for block in blocks) == count
        result.append({"code": code, "letter": letter, "name": title, "count": count, "description": description, "blocks": blocks})
    return result


def catalogue_html(data):
    esc = html.escape
    accents = {"Morfologia": "Morfologia", "IBGE": "IBGE",
               "Atividade economica e contexto urbano": "Atividade econ\u00f4mica e contexto urbano",
               "Edificacoes GBA": "Edifica\u00e7\u00f5es GBA", "Vias e quadras OSM": "Vias e quadras OSM",
               "Topografia": "Topografia", "Presenca e idade urbana MapBiomas": "Presen\u00e7a e idade urbana MapBiomas",
               "Domicilios e populacao": "Domic\u00edlios e popula\u00e7\u00e3o",
               "Banheiro, renda, agua e esgoto": "Banheiro, renda, \u00e1gua e esgoto",
               "Lixo e entorno urbano": "Lixo e entorno urbano", "Atividade economica CNPJ": "Atividade econ\u00f4mica CNPJ",
               "Equipamentos e servicos OSM": "Equipamentos e servi\u00e7os OSM"}
    sections = []
    for family in data:
        blocks = []
        for block in family["blocks"]:
            rows = []
            for v in block["variables"]:
                friendly = f'<span class="catalog-label">{esc(v["label"])}</span>' if v["label"] != v["id"] else ""
                pair = 'Mesma coluna (est\u00e1tica)' if v["static"] else f'<code>{esc(v["inference"])}</code>'
                rows.append(f'<tr data-variable="{esc(v["id"])}"><th scope="row">{friendly}<code>{esc(v["id"])}</code></th><td>{esc(v["source"])}<small>{esc(v["year"])}</small></td><td>{pair}</td></tr>')
            blocks.append(f'''<details class="catalog-group"><summary>{esc(accents.get(block['name'], block['name']))}<span>{len(rows)} vari\u00e1veis</span></summary><div class="catalog-scroll"><table><thead><tr><th>Sele\u00e7\u00e3o / treino</th><th>Fonte / observa\u00e7\u00e3o</th><th>Infer\u00eancia 2026</th></tr></thead><tbody>{''.join(rows)}</tbody></table></div></details>''')
        overview = ' \u00b7 '.join(f"{accents.get(block['name'], block['name'])}: {len(block['variables'])}" for block in family['blocks'])
        sections.append(f'''<details class="family-disclosure family-{family['letter'].lower()}" data-family="{family['code']}"><summary><span class="family-symbol">{family['letter']}</span><span class="family-summary-text"><strong>{esc(accents[family['name']])}</strong><small>{esc(overview)}</small></span><span class="candidate-count">{family['count']} candidatas</span></summary><div class="catalog-blocks">{''.join(blocks)}</div></details>''')
    return '<div class="family-catalog">' + ''.join(sections) + '</div>'


def real_ibge(output):
    folder = output / "execucoes/area_cu_aracaju/area_cu_aracaju/ibge"
    summary = json.loads((folder / "13_resumo_recomendado.json").read_text(encoding="utf-8"))
    curve = []
    with (folder / "06_topk_resumo.csv").open(encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            curve.append({"k": int(row["k"]), "mean": float(row["ap_mean"]), "se": float(row["ap_se"]), "n": int(row["ap_n"])})
    return {"synthetic": False, "area": "Aracaju", "family": "IBGE", "summary": summary, "curve": curve}
