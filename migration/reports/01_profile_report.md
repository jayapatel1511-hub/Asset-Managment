# 01 — Profile report

**Status: PASS**

Source: `data\source\registry_2026-09-02.csv` (1053 rows), `data\source\calibration_history_2026-09-02.corrected.csv` (253 rows).

## Measured vs. committed baseline

| Metric | Baseline (docs/00-brief.md, specs/) | Measured | OK? |
|---|---|---|---|
| registry_rows | 1053 | 1053 | ✓ |
| duplicated_asset_ids | 29 | 29 | ✓ |
| blank_or_prefix_only_asset_ids | 27 | 27 | ✓ |
| shared_serial_different_type | 132 | 132 | ✓ |
| distinct_offices | 10 | 10 | ✓ |
| calibration_rows (corrected) | 253 | 253 | ✓ |
| no_serial_pct | ~26% | 25.8% | ✓ |
| no_manufacturer_pct | ~22% | 22.1% | ✓ |

## Notes

- The original (uncorrected) calibration export (calibration_history_2026-09-02.csv) has 253 rows but no usable serial column — confirmed defective per specs/README.md. This script reads ONLY the .corrected.csv file for every downstream step.

All measured counts match the committed baseline. Safe to proceed to `02_clean.py`.
