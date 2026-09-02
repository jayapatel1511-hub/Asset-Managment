"""
01_profile.py — Profile the frozen source export and fail loudly on drift.

Per docs/04-migration.md: "Re-run the profile in 00-brief.md and fail loudly if counts differ
from the committed baseline (protects against someone re-exporting a changed sheet mid-migration)."

FR-023: verify the source export against a committed profile baseline before loading, fail on
divergence. There is no separately-authored baseline file in the repo — this script IS the
baseline definition (the numbers below are transcribed from docs/00-brief.md and specs/README.md,
both written against this exact frozen export) and it also snapshots what it measured to
migration/staged/profile_baseline.json so a second run compares against its own prior result too,
not just the narrative numbers.

Idempotent: running it twice produces the same report and does not mutate any input.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SOURCE_REGISTRY = ROOT / "data" / "source" / "registry_2026-09-02.csv"
SOURCE_CAL_CORRECTED = ROOT / "data" / "source" / "calibration_history_2026-09-02.corrected.csv"
SOURCE_CAL_DEFECTIVE = ROOT / "data" / "source" / "calibration_history_2026-09-02.csv"
STAGED_DIR = ROOT / "migration" / "staged"
REPORT_PATH = ROOT / "migration" / "reports" / "01_profile_report.md"
BASELINE_PATH = STAGED_DIR / "profile_baseline.json"

# Numbers transcribed from docs/00-brief.md, specs/README.md and specs/002-inventory-migration/spec.md.
# These are the committed, narrative baseline for the 2026-09-02 export. A run that measures
# something different does not necessarily mean the data is wrong (see NOTES below for the ones
# this script's own forensic pass refines) — it means the mismatch must be looked at, not loaded
# past silently.
COMMITTED_BASELINE = {
    "registry_rows": 1053,
    "duplicated_asset_ids": 29,            # non-blank, non-prefix-only Asset ID appearing >1x
    "blank_or_prefix_only_asset_ids": 27,
    "shared_serial_different_type": 132,   # distinct serials spanning >=2 equipment types
    "distinct_offices": 10,
    "no_serial_pct_min": 25.0,             # "26%" — allow a point of rounding either side
    "no_serial_pct_max": 27.0,
    "no_manufacturer_pct_min": 21.0,       # "22%"
    "no_manufacturer_pct_max": 23.0,
    "calibration_rows": 253,
}


def pct_in_range(actual: float, lo: float, hi: float) -> bool:
    return lo <= actual <= hi


def profile_registry(df: pd.DataFrame) -> dict:
    non_blank_id = df["Asset ID"].str.strip() != ""
    prefix_only = df["Asset ID"].str.strip().str.endswith("-")
    real_id = non_blank_id & ~prefix_only

    dup_ids = df.loc[real_id].groupby("Asset ID").filter(lambda g: len(g) > 1)["Asset ID"].nunique()
    blank_or_prefix_only = (~non_blank_id | prefix_only).sum()

    has_serial = df[df["Serial Number"].str.strip() != ""]
    by_serial_type = has_serial.groupby("Serial Number")["Equipment Type"].nunique()
    shared_serial_diff_type = int((by_serial_type > 1).sum())

    offices = df[df["Current Office"].str.strip() != ""]["Current Office"].nunique()

    no_serial_pct = (df["Serial Number"].str.strip() == "").mean() * 100
    no_mfr_pct = (df["Manufacturer"].str.strip() == "").mean() * 100

    return {
        "registry_rows": len(df),
        "duplicated_asset_ids": int(dup_ids),
        "blank_or_prefix_only_asset_ids": int(blank_or_prefix_only),
        "shared_serial_different_type": shared_serial_diff_type,
        "distinct_offices": int(offices),
        "no_serial_pct": round(no_serial_pct, 1),
        "no_manufacturer_pct": round(no_mfr_pct, 1),
    }


def profile_calibration(path: Path) -> dict:
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    return {
        "calibration_rows": len(df),
        "has_serial_col": "serial" in [c.lower() for c in df.columns],
        "serial_populated": int((df.get("serial", pd.Series(dtype=str)).str.strip() != "").sum())
        if "serial" in df.columns else 0,
    }


def main() -> int:
    problems: list[str] = []
    notes: list[str] = []

    if not SOURCE_REGISTRY.exists():
        print(f"FATAL: {SOURCE_REGISTRY} not found", file=sys.stderr)
        return 1

    df = pd.read_csv(SOURCE_REGISTRY, dtype=str, keep_default_na=False)
    reg = profile_registry(df)
    cal_corrected = profile_calibration(SOURCE_CAL_CORRECTED)
    cal_defective = profile_calibration(SOURCE_CAL_DEFECTIVE) if SOURCE_CAL_DEFECTIVE.exists() else None

    checks = [
        ("registry_rows", reg["registry_rows"], COMMITTED_BASELINE["registry_rows"],
         lambda a, b: a == b),
        ("duplicated_asset_ids", reg["duplicated_asset_ids"], COMMITTED_BASELINE["duplicated_asset_ids"],
         lambda a, b: a == b),
        ("blank_or_prefix_only_asset_ids", reg["blank_or_prefix_only_asset_ids"],
         COMMITTED_BASELINE["blank_or_prefix_only_asset_ids"], lambda a, b: a == b),
        ("shared_serial_different_type", reg["shared_serial_different_type"],
         COMMITTED_BASELINE["shared_serial_different_type"], lambda a, b: a == b),
        ("distinct_offices", reg["distinct_offices"], COMMITTED_BASELINE["distinct_offices"],
         lambda a, b: a == b),
        ("calibration_rows (corrected)", cal_corrected["calibration_rows"],
         COMMITTED_BASELINE["calibration_rows"], lambda a, b: a == b),
    ]

    for name, actual, expected, cmp in checks:
        if not cmp(actual, expected):
            problems.append(f"{name}: expected {expected}, measured {actual}")

    if not pct_in_range(reg["no_serial_pct"], COMMITTED_BASELINE["no_serial_pct_min"],
                         COMMITTED_BASELINE["no_serial_pct_max"]):
        problems.append(
            f"no_serial_pct: expected ~26%, measured {reg['no_serial_pct']}%"
        )
    if not pct_in_range(reg["no_manufacturer_pct"], COMMITTED_BASELINE["no_manufacturer_pct_min"],
                         COMMITTED_BASELINE["no_manufacturer_pct_max"]):
        problems.append(
            f"no_manufacturer_pct: expected ~22%, measured {reg['no_manufacturer_pct']}%"
        )

    if not cal_corrected["has_serial_col"] or cal_corrected["serial_populated"] < cal_corrected["calibration_rows"]:
        problems.append(
            "calibration_history_2026-09-02.corrected.csv does not have a fully-populated 'serial' "
            "column — US3 (feature 002) cannot match calibration rows to assets without it."
        )

    if cal_defective is not None:
        notes.append(
            "The original (uncorrected) calibration export "
            f"({SOURCE_CAL_DEFECTIVE.name}) has {cal_defective['calibration_rows']} rows but no "
            "usable serial column — confirmed defective per specs/README.md. This script reads "
            "ONLY the .corrected.csv file for every downstream step."
        )

    # against our own last run, if any (protects re-runs / concurrent dev+prod exports diverging)
    STAGED_DIR.mkdir(parents=True, exist_ok=True)
    prior = None
    if BASELINE_PATH.exists():
        prior = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
        if prior.get("registry_sha256") and prior["registry_sha256"] != _sha256(SOURCE_REGISTRY):
            problems.append(
                "registry_2026-09-02.csv content hash differs from the last profiled run "
                f"(prior run recorded at {prior.get('profiled_at')}). If this is a deliberate "
                "re-export, delete migration/staged/profile_baseline.json to accept the new file "
                "as the baseline; otherwise investigate before loading."
            )

    status = "FAIL" if problems else "PASS"

    lines = [
        "# 01 — Profile report",
        "",
        f"**Status: {status}**",
        "",
        f"Source: `{SOURCE_REGISTRY.relative_to(ROOT)}` ({reg['registry_rows']} rows), "
        f"`{SOURCE_CAL_CORRECTED.relative_to(ROOT)}` ({cal_corrected['calibration_rows']} rows).",
        "",
        "## Measured vs. committed baseline",
        "",
        "| Metric | Baseline (docs/00-brief.md, specs/) | Measured | OK? |",
        "|---|---|---|---|",
    ]
    for name, actual, expected, cmp in checks:
        ok = "✓" if cmp(actual, expected) else "✗ MISMATCH"
        lines.append(f"| {name} | {expected} | {actual} | {ok} |")
    lines.append(
        f"| no_serial_pct | ~26% | {reg['no_serial_pct']}% | "
        f"{'✓' if pct_in_range(reg['no_serial_pct'], 25.0, 27.0) else '✗ MISMATCH'} |"
    )
    lines.append(
        f"| no_manufacturer_pct | ~22% | {reg['no_manufacturer_pct']}% | "
        f"{'✓' if pct_in_range(reg['no_manufacturer_pct'], 21.0, 23.0) else '✗ MISMATCH'} |"
    )

    if notes:
        lines += ["", "## Notes", ""] + [f"- {n}" for n in notes]

    if problems:
        lines += ["", "## Problems (migration MUST NOT proceed until resolved)", ""]
        lines += [f"- {p}" for p in problems]
    else:
        lines += ["", "All measured counts match the committed baseline. Safe to proceed to "
                       "`02_clean.py`."]

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")

    baseline_snapshot = {
        "profiled_at": pd.Timestamp.now(tz="America/Toronto").isoformat(),
        "registry_sha256": _sha256(SOURCE_REGISTRY),
        "measured": reg,
        "calibration_corrected": cal_corrected,
        "status": status,
    }
    if status == "PASS" or prior is None:
        BASELINE_PATH.write_text(json.dumps(baseline_snapshot, indent=2), encoding="utf-8")

    print(f"Profile: {status}. See {REPORT_PATH.relative_to(ROOT)}")
    for name, actual, expected, cmp in checks:
        mark = "OK" if cmp(actual, expected) else "MISMATCH"
        print(f"  [{mark}] {name}: expected {expected}, measured {actual}")

    return 1 if problems else 0


def _sha256(path: Path) -> str:
    import hashlib
    return hashlib.sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
