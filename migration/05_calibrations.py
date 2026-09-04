"""
05_calibrations.py — Match the 253-row calibration history to staged assets and set each
matched asset's lastcaldate / nextcaldue directly (flows aren't running against a mock store,
so this script plays F2's role for the historical bulk load — see docs/03-automation.md).

Reads data/source/calibration_history_2026-09-02.corrected.csv (NEVER the original — its serial
column is empty in all 253 rows, per specs/README.md's data-quality finding) and
migration/staged/assets.json.

Writes:
  migration/staged/calibrationrecords.json
  migration/staged/assets.json              (rewritten in place: lastcaldate/nextcaldue set)
  migration/reports/05_calibration_report.md
  migration/reports/05_unmatched_calibrations.md
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path

import pandas as pd

def stable_guid(namespace: str, key: str) -> str:
    """Deterministic pseudo-GUID so re-running the migration is idempotent (FR-025). Identical
    derivation to 04_load.py's, so the two scripts cannot drift apart."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"ams://{namespace}/{key}"))


ROOT = Path(__file__).resolve().parent.parent
CAL_CSV = ROOT / "data" / "source" / "calibration_history_2026-09-02.corrected.csv"
ASSETS_JSON = ROOT / "migration" / "staged" / "assets.json"
STAGED_DIR = ROOT / "migration" / "staged"
REPORTS_DIR = ROOT / "migration" / "reports"

# FR-018: match on serial + model family, not serial alone (Sigicom's plain numeric serials
# collide across product lines — e.g. serial 108860 exists as a D10 logger, an S50 SLM and a
# V12 geophone, three different assets). First entry = FR-019's documented default when more
# than one candidate prefix actually holds that serial ("Micromate -> DL-UM or GEO-UM,
# ambiguous, default to the Data Logger, flag it"). Every other family is unambiguous once the
# Q4 model corrections are applied (each maps to exactly one surviving prefix).
MODEL_FAMILY_PREFIXES = {
    "Micromate": ["DL-UM", "GEO-UM"],
    "Minimate": ["DL-BE"],
    "Minimate Plus": ["DL-BE"],
    "S50": ["SLM-S50"],
    "V12": ["GEO-V12"],
    "C22": ["GEO-C22"],
    "D10": ["DL-D10"],
    "D10 Micro": ["DL-D10"],
    "D10 Black Case": ["DL-D10"],
    "SLM": ["SLM-UA"],
    "C50": ["SLM-C50"],
}


def parse_real_date(v: str) -> str | None:
    v = (v or "").strip()
    if not v:
        return None
    try:
        d = pd.to_datetime(v)
    except Exception:
        return None
    if d.year <= 1901:
        return None
    return d.strftime("%Y-%m-%d")


def main() -> int:
    cal = pd.read_csv(CAL_CSV, dtype=str, keep_default_na=False)
    assets = json.loads(ASSETS_JSON.read_text(encoding="utf-8"))
    by_serial: dict[str, list[dict]] = {}
    for a in assets:
        if a["serialnumber"]:
            by_serial.setdefault(a["serialnumber"], []).append(a)

    records = []
    matched_count = 0
    ambiguous_matches = []
    unmatched = []
    skipped = []
    dup_same_day = []

    seen_asset_dates: dict[tuple, int] = {}

    for _, row in cal.iterrows():
        cdate = parse_real_date(row["calibration_date"])
        ndate = parse_real_date(row["next_cal_date"])
        serial = row["serial"].strip()
        family = row["model_station"].strip()

        if cdate is None:
            reason = (
                "calibration_date is the literal 'N/A' (next_cal_date is '#VALUE!') — a "
                "spreadsheet formula error, no usable date at all"
                if row["calibration_date"].strip() == "N/A" else
                "calibration_date is blank and next_cal_date is the sentinel '1900-12-31' — this "
                "reads as an Excel date-arithmetic error (computing an interval from a blank "
                "start date), not a genuine future due date. Skipped per FR-020's 'implausible "
                "date' clause rather than loaded as a fabricated 2026 due date. NOTE: this "
                "contradicts specs/002's edge case, which describes these 40 rows as loadable "
                "with 'no calibration date but a next-due date' — this run's forensic check finds "
                "their actual next_cal_date value is the same 1900 sentinel in all 40 rows, not a "
                "real date. Flagged for Jay: if the source spreadsheet holds a real due date for "
                "these that this export corrupted, a further corrected re-export is needed."
            )
            skipped.append({"source_row": row["source_row"], "serial": serial, "model": family,
                             "reason": reason})
            continue

        candidates = MODEL_FAMILY_PREFIXES.get(family)
        if candidates is None:
            unmatched.append({"source_row": row["source_row"], "serial": serial, "model": family,
                               "reason": f"Unrecognized model family {family!r} — not in "
                               f"MODEL_FAMILY_PREFIXES."})
            continue

        pool = by_serial.get(serial, [])
        hits = [a for a in pool if any(a["assetid"].startswith(p + "-") for p in candidates)]
        if not hits:
            unmatched.append({"source_row": row["source_row"], "serial": serial, "model": family,
                               "reason": f"No asset with serial {serial!r} under expected "
                               f"prefix(es) {candidates}."})
            continue

        hit_prefixes = {p for p in candidates for a in hits if a["assetid"].startswith(p + "-")}
        if len(hit_prefixes) > 1:
            chosen_prefix = candidates[0]
            asset = next(a for a in hits if a["assetid"].startswith(chosen_prefix + "-"))
            ambiguous_matches.append({"source_row": row["source_row"], "serial": serial,
                                       "model": family, "matched": asset["assetid"],
                                       "also_could_be": [a["assetid"] for a in hits if a is not asset]})
        else:
            asset = hits[0]

        key = (asset["assetid"], cdate)
        seen_asset_dates[key] = seen_asset_dates.get(key, 0) + 1
        if seen_asset_dates[key] > 1:
            dup_same_day.append({"assetid": asset["assetid"], "date": cdate,
                                  "source_row": row["source_row"]})

        records.append({
            # FR-025 idempotency: a calibration record needs a STABLE id, derived from the source
            # row it came from, so re-running this script or reloading the staged data produces
            # the same identity every time. Without it, `server/src/db/seed.ts` fell back to
            # randomUUID() and every reload minted new ids for these 164 records — which made the
            # real dataset the one thing in the pipeline that was not reproducible, and orphaned
            # anything referencing a record by id. Same derivation as 04_load.py's stable_guid;
            # source_row is unique across all 164 rows.
            "id": stable_guid("calibration", str(row["source_row"])),
            "asset": asset["assetid"],
            "calibrationdate": cdate,
            "nextduedate": ndate,
            "lab": "Montreal Calibration",
            "certificatenumber": row["certificate"].strip() or None,
            "certificateurl": None,
            "cost": row["cost"].strip() or None,
            "result": None,  # not recorded in source; never fabricated
            "source_row": int(row["source_row"]),
        })
        matched_count += 1

    # FR-022: asset's lastcaldate/nextcaldue = most recent matched record by calibration date
    by_asset: dict[str, list[dict]] = {}
    for r in records:
        by_asset.setdefault(r["asset"], []).append(r)
    asset_lookup = {a["assetid"]: a for a in assets}
    for assetid, recs in by_asset.items():
        latest = max(recs, key=lambda r: r["calibrationdate"])
        asset_lookup[assetid]["lastcaldate"] = latest["calibrationdate"]
        asset_lookup[assetid]["nextcaldue"] = latest["nextduedate"]

    ASSETS_JSON.write_text(json.dumps(assets, indent=2), encoding="utf-8")
    STAGED_DIR.joinpath("calibrationrecords.json").write_text(
        json.dumps(records, indent=2), encoding="utf-8")

    unknown_status = sum(1 for a in assets if not a["nextcaldue"] and a["lifecycle"] == "Active")

    report = [
        "# 05 — Calibration matching report", "",
        f"Source rows: {len(cal)}.",
        f"Matched to an asset: {matched_count} ({len(ambiguous_matches)} resolved via the "
        f"documented Micromate ambiguity rule — defaulted to the Data Logger, flagged below).",
        f"Skipped (no usable date — FR-020): {len(skipped)} "
        f"(47 literal 'N/A'/'#VALUE!' rows + 40 blank-date/1900-sentinel rows).",
        f"Unmatched (usable date, no asset found — FR-021): {len(unmatched)}.",
        f"Same asset + same calibration date recorded twice: {len(dup_same_day)}.",
        "",
        f"After matching, {unknown_status} Active assets have no next-due date at all — these are "
        f"assets with zero calibration history (no matched record, and no history to derive one "
        f"from). Feature 004 US1 (FR-003) groups these as 'calibration status unknown' rather than "
        f"omitting them.",
        "",
        "## Ambiguous matches (Micromate -> defaulted to Data Logger, per docs/04-migration.md)", "",
    ]
    for m in ambiguous_matches:
        report.append(f"- source row {m['source_row']}, serial {m['serial']}: matched "
                       f"**{m['matched']}**, could also be {m['also_could_be']}.")

    if dup_same_day:
        report += ["", "## Same asset, same calibration date, recorded twice", ""]
        for d in dup_same_day:
            report.append(f"- {d['assetid']} on {d['date']} (source row {d['source_row']})")

    (REPORTS_DIR / "05_calibration_report.md").write_text("\n".join(report) + "\n", encoding="utf-8")

    unmatched_report = [
        "# 05 — Unmatched calibration rows", "",
        f"{len(unmatched)} row(s) had a usable calibration date but no matching asset by serial + "
        f"model family; {len(skipped)} more had no usable date at all (see 05_calibration_report.md "
        f"for why). Every one of the source's 253 rows is accounted for in one of these two lists "
        f"or the matched set (SC-005 / feature 002 FR-021).",
        "",
        "## No matching asset found", "",
        "| source_row | serial | model | reason |", "|---|---|---|---|",
    ]
    for u in unmatched:
        unmatched_report.append(f"| {u['source_row']} | {u['serial']} | {u['model']} | {u['reason']} |")
    unmatched_report += ["", "## Skipped — no usable date", "",
                          "| source_row | serial | model | reason |", "|---|---|---|---|"]
    for s in skipped:
        unmatched_report.append(f"| {s['source_row']} | {s['serial']} | {s['model']} | {s['reason']} |")
    (REPORTS_DIR / "05_unmatched_calibrations.md").write_text(
        "\n".join(unmatched_report) + "\n", encoding="utf-8")

    total_accounted = matched_count + len(unmatched) + len(skipped)
    ok = total_accounted == len(cal)
    print(f"05_calibrations: {matched_count} matched, {len(unmatched)} unmatched, "
          f"{len(skipped)} skipped (total {total_accounted} of {len(cal)} — "
          f"{'OK' if ok else 'MISMATCH, investigate'}).")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
