repo: jayapatel1511-hub/Asset-Managment
branch: master
path: docs/12-ui-spec.md, app/src

## Last sync

date: 2026-09-03T17:09:24Z

### Updated in this project

- Built a clickable mockup of all 20 screens, 6 dialogs and the X01/X02 states from `docs/12-ui-spec.md`.
- Reproduced the Fluent UI v9 web theme tokens (§ 2.4) by hand, light and dark.
- Resolved the 21 design gaps (G-01 to G-21) and the two § 11 open questions; logged in `DECISIONS.md`.
- Imported read-only copies of `docs/12-ui-spec.md` and `app/src/i18n/en.json` as the copy source.

## Screen map

| Project screen | Built from |
|---|---|
| S01 Search / Home, D01 Scan | `app/src/features/search/SearchPage.tsx`, `app/src/features/search/ScanDialog.tsx`, spec § 5.1–5.2 |
| S03 Asset detail, D02–D05 | `app/src/features/asset/AssetDetailPage.tsx`, spec § 5.3–5.4 |
| S04 Checkout, S05 Return, S06 Transfer | spec § 5.5–5.7 |
| S07 Calibration due | spec § 5.8 |
| S08 Sites, S09 Site detail, S10 Deploy, S11 Recover, D06 Swap | spec § 5.9–5.13 |
| S13–S15 Admin | spec § 5.14–5.16 |
| S16 Needs attention | spec § 5.17 |
| S17–S20 Reports | spec § 5.18–5.21 |
| App shell, header, bottom nav | `app/src/App.tsx`, `app/src/components/BottomNav.tsx`, spec § 2.1, § 3.1 |
| StatusPill.dc.html | `app/src/components/StatusPill.tsx`, spec § 2.5 |
| AssetRow.dc.html | `app/src/components/AssetRow.tsx`, spec § C2 |
| All copy | `app/src/i18n/en.json` |

Not read, by instruction: `app/public/data/`, `migration/staged/`.
