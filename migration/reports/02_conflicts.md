# 02 — Conflict report (sign-off required before production load per FR-026 / SC-010)

Every judgement call this run made that a human should look at before this data reaches production. Nothing here blocks a **development** load — it blocks going to Prod.

## Cross-office duplicates (16 found)

The brief's narrative baseline says 8; a full reconciliation of this frozen export against the corrected model catalogue finds more, because several of the 132 legitimate shared-serial sibling pairs (an instrument and its sensor, e.g. DL-UM-x / GEO-UM-x) are *each independently* duplicated across the same two offices, and two further pairs only surface after fixing the Sigicom S50/V12 equipment-type mislabels (Q4). This does not change the total duplicate-Asset-ID count (29), which matches the baseline exactly — see 01_profile_report.md. Every pair below is named so Jay can confirm the home-office choice.

- **SLM-S50-13595** — offices ['London', 'Ottawa'], kept home office **Ottawa** (row 86, more complete record). Source rows: [86, 611].
- **DL-UM-16984** — offices ['Sudbury', 'Toronto'], kept home office **Sudbury** (row 298, more complete record). Source rows: [157, 298].
- **GEO-UM-16984** — offices ['Sudbury', 'Toronto'], kept home office **Toronto** (row 164, more complete record). Source rows: [164, 383].
- **DL-UM-15713** — offices ['Sudbury', 'Toronto'], kept home office **Sudbury** (row 299, more complete record). Source rows: [176, 299].
- **GEO-UM-15713** — offices ['Sudbury', 'Toronto'], kept home office **Toronto** (row 177, more complete record). Source rows: [177, 384].
- **DL-UM-16842** — offices ['Sudbury', 'Toronto'], kept home office **Sudbury** (row 297, more complete record). Source rows: [180, 297].
- **GEO-UM-16842** — offices ['Sudbury', 'Toronto'], kept home office **Toronto** (row 181, more complete record). Source rows: [181, 382].
- **DL-BE-20745** — offices ['Sudbury', 'Toronto'], kept home office **Sudbury** (row 332, more complete record). Source rows: [221, 332].
- **DL-BE-20600** — offices ['Sudbury', 'Toronto'], kept home office **Sudbury** (row 333, more complete record). Source rows: [224, 333].
- **GEO-V12-30220** — offices ['Kitchener', 'Toronto'], kept home office **Toronto** (row 251, more complete record). Source rows: [251, 593].
- **DL-MP-13332** — offices ['Ottawa', 'Sudbury'], kept home office **Ottawa** (row 702, more complete record). Source rows: [276, 702].
- **GEO-BG-18201** — offices ['Kitchener', 'SWO'], kept home office **SWO** (row 550, more complete record). Source rows: [550, 600].
- **GEO-V12-32700** — offices ['Kitchener', 'London'], kept home office **Kitchener** (row 605, more complete record). Source rows: [605, 621].
- **SLM-S50-14575** — offices ['London', 'Stoney Creek'], kept home office **London** (row 610, more complete record). Source rows: [610, 699].
- **DST220** — offices ['SWO', 'Sudbury'], kept home office **SWO** (row 875, more complete record). Source rows: [875, 944].
- **DST372** — offices ['', 'Sudbury'], kept home office **Sudbury** (row 960, more complete record). Source rows: [960, 970].

## Same-office literal duplicates collapsed (3)

- **DL-UM-16850** — 2 identical-office rows [518, 551], kept row 518.
- **GEO-UM-16850** — 2 identical-office rows [555, 556], kept row 555.
- **DST100** — 2 identical-office rows [919, 943], kept row 919.

## FR-013 flagged, NOT merged: same serial + same model, different Asset ID (2)

Per FR-013 these are loaded as distinct assets; a human decides whether to merge them (and how) via a follow-up correction, not this script.
- serial **35590**, Sigicom V12 (Geophone): Asset IDs ['GEO-V12-35590', 'TMP-0005'], source rows [81, 965].
- serial **13654**, Sigicom S50 (SoundLevelMeter): Asset IDs ['SLM-S50-13654', 'TMP-0008'], source rows [470, 968].

## Notes suggesting third-party ownership or loss (3)

- **DL-BE-20588** (row 368): notes='Unit Stolen in Cochrane On, at ONTC train station for ONTC reinstated stations project.' project='STOLEN SEISMOGRAPH - 02406301 - ontc cochrane track'
- **TS-014** (row 1003): notes='Owned by Vanmar Construction Inc. Deployed at 02208928.000, Kitchener Station Park Phase 2 Condominium Development' project=''
- **TS-015** (row 1004): notes='Owned by Vanmar Construction Inc. Deployed at 02208928.000, Kitchener Station Park Phase 2 Condominium Development' project=''

## Sign-off

- [ ] Jay Patel has reviewed every item above and approves the production load (docs/08-decisions.md gets the date and any corrections requested).
