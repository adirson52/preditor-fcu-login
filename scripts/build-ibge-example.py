"""Fit a small, explicitly synthetic IBGE teaching example with the project's core.

This never reads or modifies the national training base or running selection.
"""
import argparse
import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score

ROOT = Path(__file__).resolve().parents[1]
FEATURES = [
    {"id": "p_ibge_1banhexc_2022", "label": "Um banheiro exclusivo", "unit": "proporcao"},
    {"id": "p_ibge_calcainade_2022", "label": "Calcada inadequada", "unit": "proporcao"},
    {"id": "p_ibge_naocalca_2022", "label": "Sem calcada", "unit": "proporcao"},
    {"id": "ibge_mediapopdomc_2022", "label": "Moradores por domicilio tipo casa", "unit": "pessoas"},
    {"id": "m_ibge_renddppo_2022", "label": "Renda domiciliar", "unit": "reais"},
    {"id": "p_ibge_naoilupub_2022", "label": "Sem iluminacao publica", "unit": "proporcao"},
]


def assignment(seed):
    labels = [i % 5 for i in range(25)]
    for i in range(24, 0, -1):
        seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
        j = seed % (i + 1)
        labels[i], labels[j] = labels[j], labels[i]
    return labels


def export_model(model, frame):
    terms = []
    for j, name in enumerate(model.feature_names_in_):
        cuts = np.asarray(model.bins_[j][0]).tolist()
        scores = np.asarray(model.term_scores_[j]).tolist()
        terms.append({"id": name, "cuts": cuts, "scores": scores,
                      "min": float(frame[name].min()), "max": float(frame[name].max())})
    intercept = float(np.asarray(model.intercept_).ravel()[0])
    z = np.full(len(frame), intercept)
    for term in terms:
        z += np.asarray(term["scores"])[np.searchsorted(term["cuts"], frame[term["id"]], side="right") + 1]
    predicted = 1 / (1 + np.exp(-z))
    expected = model.predict_proba(frame[model.feature_names_in_])[:, 1]
    assert np.allclose(predicted, expected, rtol=1e-12, atol=1e-12)
    references = [{"cell": int(frame.index[i]), "p": float(expected[i]), "x": frame.iloc[i].to_dict()} for i in range(min(10, len(frame)))]
    return {"intercept": intercept, "terms": terms, "equationMaxError": float(np.max(np.abs(predicted - expected))), "referencePredictions": references}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--core", type=Path, required=True)
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location("selection_teaching_core", args.core)
    core = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = core
    spec.loader.exec_module(core)
    rng = np.random.default_rng(419)
    block = np.repeat(np.arange(25), 16)
    cell = np.tile(np.arange(16), 25)
    y = ((block * 13 + cell * 7) % 19 < 4).astype(int)
    sidewalk = np.clip(.30 + .30 * y + rng.normal(0, .22, 400), 0, 1)
    matrix = np.column_stack([
        np.clip(.25 + .45 * y + rng.normal(0, .18, 400), 0, 1),
        sidewalk, np.clip(.03 + .92 * sidewalk + rng.normal(0, .06, 400), 0, 1),
        np.maximum(1, 3 + .7 * y + rng.normal(0, .8, 400)),
        np.maximum(400, 2600 - 1100 * y + rng.normal(0, 750, 400)), np.zeros(400),
    ])
    features = [f["id"] for f in FEATURES]
    frame = pd.DataFrame(matrix, columns=features)
    frame["target"] = y
    config = SimpleNamespace(unitary_max_rows=0, corr_max_rows=0, strict_validation=True,
                             max_rounds_unitario=64, outer_bags_unitario=1, n_jobs=1,
                             learning_rate=.03, spearman_threshold=.7)

    def select(train, seed):
        kept, audit = core.audit_numeric_df(train, features, "toy_train", zero_threshold=1., missing_threshold=1., modal_threshold=1.)
        ranking = core.rank_ebm_unitario(train, kept, "target", config, seed)
        clusters, pairs, winners = core.spearman_clusters(train, kept, ranking, "target", config, seed)
        return kept, audit, ranking, clusters, pairs, winners

    def fit(train, names, seed):
        return core.fit_ebm(train[names], train.target, random_state=seed, max_rounds=96,
                            outer_bags=1, n_jobs=1, learning_rate=.03)

    divisions = [assignment(seed) for seed in [713, 742, 771, 800, 829]]
    evaluations = []
    first = None
    for rep, division in enumerate(divisions):
        group = np.asarray(division)[block]
        for fold in range(5):
            reserved = 4 - fold
            train = frame.loc[group != reserved]
            validation = frame.loc[group == reserved]
            assert len(train) == 320 and len(validation) == 80
            kept, audit, ranking, clusters, pairs, winners = select(train, 1000 + rep * 10 + fold)
            if rep == fold == 0:
                first = {"kept": kept, "audit": audit.to_dict("records"),
                         "ranking": ranking.to_dict("records"), "clusters": clusters.to_dict("records"),
                         "pairs": pairs.to_dict("records"), "winners": winners, "models": {}}
            for k in range(1, len(winners) + 1):
                model = fit(train, winners[:k], 3000 + rep * 10 + fold)
                probs = model.predict_proba(validation[winners[:k]])[:, 1]
                ap = float(average_precision_score(validation.target, probs))
                evaluations.append({"rep": rep + 1, "fold": fold + 1, "reserved": reserved, "k": k, "ap": ap})
                if rep == fold == 0:
                    ranked = sorted(zip(validation.index.tolist(), probs.tolist()), key=lambda row: (-row[1], row[0]))
                    first["models"][str(k)] = {**export_model(model, train[winners[:k]]), "ap": ap,
                                               "ranking": [{"cell": index, "p": p, "y": int(y[index])} for index, p in ranked]}
            print(f"Synthetic example: repetition {rep + 1}, fold {fold + 1}", flush=True)
    summary = []
    for k, data in pd.DataFrame(evaluations).groupby("k"):
        n = len(data)
        summary.append({"k": int(k), "mean": float(data.ap.mean()), "se": float(data.ap.std(ddof=1) / np.sqrt(n)), "n": n})
    complete = [row for row in summary if row["n"] == 25]
    best = max(complete, key=lambda row: (row["mean"], -row["k"]))
    threshold = best["mean"] - best["se"]
    recommended = min(row["k"] for row in complete if row["mean"] >= threshold)
    _, _, final_ranking, _, _, final_winners = select(frame, 419)
    final = fit(frame, final_winners[:recommended], 419)
    result = {
        "synthetic": True, "source": "Six real IBGE variable names; all values and targets are synthetic.",
        "nCells": 400, "nBlocks": 25, "features": FEATURES, "divisions": divisions,
        "cells": [{"id": f"EX-{i + 1:03d}", "block": int(block[i]), "y": int(y[i]), "x": matrix[i].tolist()} for i in range(400)],
        "first": first, "evaluations": evaluations, "curve": summary,
        "bestK": best["k"], "recommendedK": recommended, "threshold": threshold,
        "final": export_model(final, frame[final_winners[:recommended]]),
        "finalRanking": final_ranking.to_dict("records"),
        "config": {"interactions": 0, "spearmanThreshold": .7, "folds": 5, "repeats": 5,
                   "unitaryRounds": 64, "evaluationRounds": 96, "outerBags": 1,
                   "note": "Smaller teaching fit, not national production parameters. Fictional balanced block assignments."},
    }
    target = ROOT / "selection" / "ibge-example.json"
    target.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2) + "\n", encoding="utf-8")
    print(f"Written {target}; selected K={recommended}; best K={best['k']}; 25 evaluations per eligible K.")


if __name__ == "__main__":
    main()
