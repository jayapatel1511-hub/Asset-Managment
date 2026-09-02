"""
03_models.py — Build the staged equipment-model catalogue from
data/reference/equipment_models.csv and validate every asset produced by 02_clean.py resolves to
exactly one of its rows (FR-009).

Note: the Q4 *correction* of equipment_models.csv itself (draft -> corrected, with the full
diff) is a one-time data-cleanup pass, already done and recorded in
migration/reports/03_models_review.md. This script is the repeatable pipeline step: it reads
the (now-corrected) file, deduplicates it to the canonical catalogue, and gates the load on
every asset actually resolving.

The CSV's own columns are named `eng_*`, matching docs/01-data-model.md's Dataverse column
names — correct there, since that IS the schema. The JSON this script writes uses plain field
names (manufacturer, model, ...), matching every other migration/staged/*.json file and
app/src/api/types.ts's EquipmentModel interface: api/mock/store.ts hydrates all staged files the
same way, with no per-table renaming, so the shapes must already agree.

Writes:
  migration/staged/equipment_models.json   the curated catalogue (one row per canonical model)
  migration/reports/03_models_report.md
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
MODELS_CSV = ROOT / "data" / "reference" / "equipment_models.csv"
ASSETS_JSON = ROOT / "migration" / "staged" / "assets_clean.json"
STAGED_DIR = ROOT / "migration" / "staged"
REPORT_PATH = ROOT / "migration" / "reports" / "03_models_report.md"

# Component models created by 02_clean.py that have no row of their own in equipment_models.csv's
# source-mapping grain (they're listed in the csv's "New models" section conceptually, but since
# the csv is keyed by *source* rows, and these have no source row, they're declared here once,
# matching data/reference/equipment_models.csv's own build_model_catalog.py EXTRA_MODELS list).
EXTRA_CANONICAL = [
    {"manufacturer": "Larson Davis", "model": "831C Pre-Amp", "equipmenttype": "Microphone",
     "assetgroup": "Acoustics", "idprefix": "SLM-LD-PA", "isserialised": "Yes",
     "identifiertype": "Serial", "defaultcalintervalmonths": 12},
    {"manufacturer": "Larson Davis", "model": "831C Element", "equipmenttype": "Microphone",
     "assetgroup": "Acoustics", "idprefix": "SLM-LD-EL", "isserialised": "Yes",
     "identifiertype": "Serial", "defaultcalintervalmonths": 12},
]


def main() -> int:
    m = pd.read_csv(MODELS_CSV, dtype=str, keep_default_na=False)
    m = m[m["eng_equipmenttype"] != "EXCLUDED"]

    # DEVIATION from docs/01-data-model.md, recorded in docs/08-decisions.md: the doc states the
    # eng_equipmentmodel alternate key is manufacturer+model alone, e.g. one "Instantel Micromate"
    # row. But Micromate is a product FAMILY that appears in the fleet as three physically
    # different catalogue items sharing one name — the data-logger body (prefix DL-UM), its
    # geophone sensor (GEO-UM) and its microphone accessory (SLM-UA) — each needing its own
    # idprefix and equipmenttype, which a single row cannot hold. The real alternate key is
    # manufacturer+model+equipmenttype; `name` is disambiguated with the type in parentheses
    # whenever manufacturer+model alone is not unique, so `name` (the Dataverse primary name
    # column) stays unique too.
    seen: dict[tuple, dict] = {}
    for _, row in m.iterrows():
        key = (row["eng_manufacturer"], row["eng_model"], row["eng_equipmenttype"])
        if key not in seen:
            interval = row["eng_defaultcalintervalmonths"]
            seen[key] = {
                "manufacturer": row["eng_manufacturer"],
                "model": row["eng_model"],
                "equipmenttype": row["eng_equipmenttype"],
                "assetgroup": row["eng_assetgroup"],
                "idprefix": row["eng_idprefix"],
                "isserialised": row["eng_isserialised"] == "Yes",
                "identifiertype": row["eng_identifiertype"],
                "defaultcalintervalmonths": int(float(interval)) if interval else None,
            }

    catalog = list(seen.values())
    for extra in EXTRA_CANONICAL:
        key = (extra["manufacturer"], extra["model"], extra["equipmenttype"])
        if key not in seen:
            catalog.append({**extra, "isserialised": extra["isserialised"] == "Yes"})

    # disambiguate `name` where manufacturer+model repeats across equipment types
    mm_counts: dict[tuple, int] = {}
    for c in catalog:
        mm_counts[(c["manufacturer"], c["model"])] = mm_counts.get((c["manufacturer"], c["model"]), 0) + 1
    for c in catalog:
        base = f"{c['manufacturer']} {c['model']}".strip()
        c["name"] = f"{base} ({c['equipmenttype']})" if mm_counts[(c["manufacturer"], c["model"])] > 1 else base

    # FR-010 (as amended above): uniqueness of manufacturer + model + equipmenttype, and of name
    keys = [(c["manufacturer"], c["model"], c["equipmenttype"]) for c in catalog]
    names = [c["name"] for c in catalog]
    problems = []
    if len(set(keys)) != len(keys):
        problems.append("Duplicate manufacturer+model+equipmenttype in catalogue (violates FR-010).")
    if len(set(names)) != len(names):
        problems.append("Duplicate name in catalogue after disambiguation — needs a manual fix.")

    # FR-009 gate: every asset produced by 02_clean.py must resolve to exactly one of these rows.
    unresolved: list[str] = []
    assets: list[dict] = []
    if ASSETS_JSON.exists():
        assets = json.loads(ASSETS_JSON.read_text(encoding="utf-8"))
        catalog_keys = {(c["manufacturer"], c["model"], c["equipmenttype"]) for c in catalog}
        for a in assets:
            if (a["manufacturer"], a["model"], a["equipmenttype"]) not in catalog_keys:
                unresolved.append(a["assetid"])
    else:
        problems.append("migration/staged/assets_clean.json not found — run 02_clean.py first.")

    if unresolved:
        problems.append(f"{len(unresolved)} staged asset(s) reference a model not in the "
                         f"catalogue (FR-009 violation): {unresolved[:20]}")

    catalog.sort(key=lambda c: (c["manufacturer"], c["model"], c["equipmenttype"]))
    STAGED_DIR.mkdir(parents=True, exist_ok=True)
    (STAGED_DIR / "equipment_models.json").write_text(json.dumps(catalog, indent=2), encoding="utf-8")

    status = "FAIL" if problems else "PASS"
    lines = [
        "# 03 — Models report", "",
        f"**Status: {status}**", "",
        f"Canonical models: {len(catalog)} (from {len(m)} source-mapping rows in "
        f"equipment_models.csv, plus {len(EXTRA_CANONICAL)} Q5 component models).",
        f"Assets checked against catalogue: {len(assets)}, unresolved: {len(unresolved)}.",
    ]
    if problems:
        lines += ["", "## Problems", ""] + [f"- {p}" for p in problems]
    else:
        lines += ["", "Every staged asset resolves to exactly one catalogue model. Safe to "
                       "proceed to `04_load.py`."]
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"03_models: {status}. {len(catalog)} canonical models staged. "
          f"See {REPORT_PATH.relative_to(ROOT)}")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
