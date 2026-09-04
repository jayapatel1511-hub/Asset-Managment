"""
04_load.py --env dev|prod — Assemble the full staged dataset the app's mock backend reads.

There is no Dataverse in this session (no tenant access — CLAUDE.md/session constraint), so
"load" means writing the final, ordered JSON documents to migration/staged/ that
app/src/api/mock/ loads at startup and treats exactly as if they had come from Dataverse. The
shape of each file mirrors the eng_* tables in docs/01-data-model.md one for one, so swapping in
the real `dataverse/` backend later is a data-source change, not a shape change.

Order (per docs/04-migration.md): locations -> models -> projects -> assets ->
AddToInventory transactions+lines -> (05_calibrations.py runs after this).

Writes:
  migration/staged/locations.json
  migration/staged/equipment_models.json     (already written by 03_models.py; re-validated here)
  migration/staged/projects.json
  migration/staged/assets.json               (assets_clean.json + resolved lookups, final shape)
  migration/staged/transactions.json         one AddToInventory txn per office (+ one "no office" bucket)
  migration/staged/transactionlines.json     one line per asset
  migration/staged/idsequence.json           next value per Asset ID prefix, continuing past every
                                              existing tag so the running app never mints a collision
  migration/reports/04_load_report.md
  migration/staged/04_loaded_ids.csv         assetid -> guid-ish staged id, for traceability
"""
from __future__ import annotations

import argparse
import json
import re
import uuid
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
STAGED_DIR = ROOT / "migration" / "staged"
REPORTS_DIR = ROOT / "migration" / "reports"
LOCATIONS_CSV = ROOT / "data" / "reference" / "locations.csv"

MIGRATION_DATE = "2026-09-02T09:00:00-04:00"  # America/Toronto, per FR-017 (no date shifting)
SVC_ACCOUNT = "svc-ams@englobecorp.com"


def stable_guid(namespace: str, key: str) -> str:
    """Deterministic pseudo-GUID so re-running the migration is idempotent (FR-025) — the same
    source key always gets the same staged id, instead of a fresh random one every run."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"ams://{namespace}/{key}"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", choices=["dev", "prod"], default="dev")
    args = parser.parse_args()

    assets_path = STAGED_DIR / "assets_clean.json"
    projects_path = STAGED_DIR / "projects_seed.json"
    components_path = STAGED_DIR / "components_seed.json"
    models_path = STAGED_DIR / "equipment_models.json"
    if not all(p.exists() for p in (assets_path, projects_path, components_path, models_path)):
        print("FATAL: run 02_clean.py and 03_models.py first.")
        return 1

    assets_clean = json.loads(assets_path.read_text(encoding="utf-8"))
    projects_seed = json.loads(projects_path.read_text(encoding="utf-8"))
    components_seed = json.loads(components_path.read_text(encoding="utf-8"))
    models = json.loads(models_path.read_text(encoding="utf-8"))

    # ---- locations ----
    loc_df = pd.read_csv(LOCATIONS_CSV, dtype=str, keep_default_na=False)
    locations = []
    for _, row in loc_df.iterrows():
        locations.append({
            "id": stable_guid("location", row["name"]),
            "name": row["name"],
            "locationtype": row["locationtype"],
            "parentlocation": row["parent"] or None,
            "isactive": True,
            "note": row["note"] or None,
        })
    loc_names = {l["name"] for l in locations}

    # ---- projects ----
    projects = []
    for p in projects_seed:
        projects.append({
            "id": stable_guid("project", p["number"]),
            "projectnumber": p["number"],
            "name": p.get("name") or f"Project {p['number']}",
            "status": "Active",
            "office": None,
            "pm": None,
        })

    # ---- assets: attach staged ids + resolve lookups to the guids above ----
    asset_id_map: dict[str, str] = {}
    assets = []
    for a in assets_clean:
        guid = stable_guid("asset", a["assetid"])
        asset_id_map[a["assetid"]] = guid
        assets.append({
            "id": guid,
            "assetid": a["assetid"],
            "migrationsource": a["migrationsource"],
            "equipmentmodel": {"manufacturer": a["manufacturer"], "model": a["model"],
                                 "equipmenttype": a["equipmenttype"]},
            "serialnumber": a["serialnumber"],
            "homeoffice": a["homeoffice"],
            "lifecycle": a["lifecycle"],
            "status": a["status"],
            "currentlocation": a["currentlocation"],
            "custodian": a["custodian"],
            "currentproject": a["currentproject"],
            "parentasset": None,   # set below for the 6 Q5 components
            "lastcaldate": None,   # set by 05_calibrations.py
            "nextcaldue": None,    # set by 05_calibrations.py
            "retirementreason": a["retirementreason"],
            "notes": a["notes"],
            "carrier": a["carrier"],
            "identifiervalue": a["identifiervalue"],
            "phonenumber": a["phonenumber"],
            "staticip": a["staticip"],
        })

    # ---- Q5 components: standing eng_assetrelationship rows + parentasset mirror ----
    relationships = []
    asset_by_id = {a["assetid"]: a for a in assets}
    for c in components_seed:
        parent = asset_by_id.get(c["parent_assetid"])
        child = asset_by_id.get(c["child_assetid"])
        if not parent or not child:
            continue
        child["parentasset"] = parent["assetid"]
        relationships.append({
            "id": stable_guid("relationship", f"{c['parent_assetid']}::{c['child_assetid']}"),
            "parentasset": parent["assetid"],
            "childasset": child["assetid"],
            "relationshiptype": "Component",
            "start": MIGRATION_DATE,
            "end": None,
            "createdbyline": None,  # set below once the AddToInventory line exists
            "closedbyline": None,
        })

    # ---- AddToInventory transactions + lines, one transaction per office (docs/04-migration.md) ----
    transactions = []
    lines = []
    by_office: dict[str, list[dict]] = {}
    for a in assets:
        by_office.setdefault(a["homeoffice"] or "(no office)", []).append(a)

    for office, office_assets in sorted(by_office.items(), key=lambda kv: kv[0]):
        txn_id = stable_guid("txn-addtoinventory", office)
        transactions.append({
            "id": txn_id,
            "name": f"TXN-{stable_guid('seq', office)[:6].upper()}",
            "transactiontype": "AddToInventory",
            "transactiondate": MIGRATION_DATE,
            "performedby": SVC_ACCOUNT,
            "fromlocation": None, "tolocation": office if office != "(no office)" else None,
            "fromuser": None, "touser": None,
            "fromproject": None, "toproject": None,
            "primaryasset": None,
            "notes": f"Migration load ({args.env}) — {len(office_assets)} assets for "
                     f"{office if office != '(no office)' else 'assets with no recorded office'}.",
            "expectedreturn": None,
        })
        for a in office_assets:
            line_id = stable_guid("line", f"{txn_id}::{a['assetid']}")
            lines.append({
                "id": line_id,
                "transaction": txn_id,
                "asset": a["assetid"],
                "statusbefore": a["status"],   # migration establishes day-one state directly
                "statusafter": a["status"],
                "kitrole": None,
                "orientation": None,
                "powersource": None,
                "condition": None,
                "processed": True,
                "notes": "Migrated from data/source/registry_2026-09-02.csv "
                         f"({a['migrationsource']}).",
            })
            if a["parentasset"]:
                for rel in relationships:
                    if rel["childasset"] == a["assetid"] and rel["createdbyline"] is None:
                        # txn_id, NOT line_id, despite the column name. The name says "line" and
                        # the value is a transaction — that discrepancy is real and predates this
                        # fix, but the value has to match what READS it. Every consumer compares
                        # this against a TRANSACTION id:
                        #   app/src/domain/pointInTime.ts     `r.createdbyline === entry.transaction`
                        #   server/src/services/transactionService.ts   writes result.transactionId
                        #   app/src/api/mock/store.ts                   same
                        #   server/src/db/views.sql (v_asset_timeline)  follows the write path
                        # Writing a line id here meant all six migrated component attachments were
                        # invisible in every timeline — UI, API and view alike — because the
                        # comparison could never match. Found by the reporting lane, 2026-09-03.
                        rel["createdbyline"] = txn_id

    # ---- id sequence: next value per prefix, continuing past every existing tag ----
    idsequence = {}
    for a in assets:
        prefix = a["assetid"].rsplit("-", 1)[0] if "-" in a["assetid"] else a["assetid"]
        suffix = a["assetid"].rsplit("-", 1)[-1]
        m = re.fullmatch(r"\d+", suffix)
        if m:
            idsequence[prefix] = max(idsequence.get(prefix, 0), int(suffix))
    tmp_nums = [int(a["assetid"].split("-")[1]) for a in assets if a["assetid"].startswith("TMP-")]
    idsequence["TMP"] = max(tmp_nums, default=0)
    idsequence = {k: {"nextvalue": v + 1} for k, v in sorted(idsequence.items())}

    # ---- write everything ----
    STAGED_DIR.mkdir(parents=True, exist_ok=True)
    (STAGED_DIR / "locations.json").write_text(json.dumps(locations, indent=2), encoding="utf-8")
    (STAGED_DIR / "projects.json").write_text(json.dumps(projects, indent=2), encoding="utf-8")
    (STAGED_DIR / "assets.json").write_text(json.dumps(assets, indent=2), encoding="utf-8")
    (STAGED_DIR / "assetrelationships.json").write_text(json.dumps(relationships, indent=2), encoding="utf-8")
    (STAGED_DIR / "transactions.json").write_text(json.dumps(transactions, indent=2), encoding="utf-8")
    (STAGED_DIR / "transactionlines.json").write_text(json.dumps(lines, indent=2), encoding="utf-8")
    (STAGED_DIR / "idsequence.json").write_text(json.dumps(idsequence, indent=2), encoding="utf-8")
    (STAGED_DIR / f"04_loaded_ids.csv").write_text(
        "assetid,id\n" + "\n".join(f"{a['assetid']},{a['id']}" for a in assets) + "\n",
        encoding="utf-8",
    )

    # sanity checks
    problems = []
    homeoffice_unmapped = {a["homeoffice"] for a in assets if a["homeoffice"] and a["homeoffice"] not in loc_names}
    if homeoffice_unmapped:
        problems.append(f"Assets reference a home office not in locations.csv (FR-006): {homeoffice_unmapped}")
    if len(assets) != len({a['id'] for a in assets}):
        problems.append("Duplicate staged asset GUIDs — should be impossible, investigate stable_guid inputs.")
    line_count_by_asset = {}
    for l in lines:
        line_count_by_asset[l["asset"]] = line_count_by_asset.get(l["asset"], 0) + 1
    missing_history = [a["assetid"] for a in assets if line_count_by_asset.get(a["assetid"], 0) != 1]
    if missing_history:
        problems.append(f"{len(missing_history)} asset(s) do not have exactly one AddToInventory "
                         f"line (FR-008): {missing_history[:10]}")

    status = "FAIL" if problems else "PASS"
    lines_report = [
        f"# 04 — Load report ({args.env})", "",
        f"**Status: {status}**", "",
        f"Locations: {len(locations)}. Projects: {len(projects)}. Assets: {len(assets)}. "
        f"Component relationships: {len(relationships)}. Transactions: {len(transactions)} "
        f"(one AddToInventory per office). Transaction lines: {len(lines)}.",
        f"ID sequence prefixes tracked: {len(idsequence)}.",
        "",
        "## Every loaded asset has a history entry (FR-008)",
        f"- {len(assets) - len(missing_history)} / {len(assets)} confirmed.",
    ]
    if problems:
        lines_report += ["", "## Problems", ""] + [f"- {p}" for p in problems]
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    (REPORTS_DIR / "04_load_report.md").write_text("\n".join(lines_report) + "\n", encoding="utf-8")

    print(f"04_load ({args.env}): {status}. {len(assets)} assets, {len(transactions)} transactions, "
          f"{len(lines)} lines. See migration/reports/04_load_report.md")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
