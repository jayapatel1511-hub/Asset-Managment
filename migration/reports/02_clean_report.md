# 02 — Clean report

Source rows: 1053 (incl. 1 blank filler row, dropped).
Rows resolved to a curated model: 1052.
Rows excluded (Q6 — configuration, not equipment): 13.
Rows reassigned off a reused tag (edge case, SIM keeps the tag): 9.
Rows corrected for an Asset-ID collision between two different physical assets: 1.
Rows dropped as a duplicate of another row (FR-011/FR-012, more complete row kept): 19.
Assets created: 1026 (incl. 6 Q5 components created from Pre Amp/Element Serial evidence).
Distinct projects seeded: 25.
Custodian rows resolved: 83 of 87 non-blank Staff values (75 by full-name match, 8 by initials — flagged as lower-confidence since a real directory lookup would not resolve on initials alone); 12 rows listed below (4 genuinely unresolved + 8 initials-flagged).

## Excluded rows (Q6 — ASSUMPTION, pending Jay's confirmation)

- row 720: SRV-THOR-001 (Microsoft/Azure) — excluded as configuration, not equipment.
- row 721: SRV-THOR-002 (Microsoft/Azure) — excluded as configuration, not equipment.
- row 722: SRV-THOR-003 (Microsoft/Azure) — excluded as configuration, not equipment.
- row 723: SRV-THOR-004 (Microsoft/Azure) — excluded as configuration, not equipment.
- row 724: SRV-THOR-005 (Microsoft/Azure) — excluded as configuration, not equipment.
- row 725: SRV-THOR-006 (Microsoft/Azure) — excluded as configuration, not equipment.
- row 726: SRV-THOR-007 (Microsoft/Azure) — excluded as configuration, not equipment.
- row 727: SRV-THOR-008 (Microsoft/Azure) — excluded as configuration, not equipment.
- row 728: SRV-THOR-009 (Microsoft/Azure) — excluded as configuration, not equipment.
- row 729: SRV-THOR-010 (Microsoft/Azure) — excluded as configuration, not equipment.
- row 730: SRV-THOR-011 (Microsoft/Azure) — excluded as configuration, not equipment.
- row 731: SRV-THOR-012 (Microsoft/Azure) — excluded as configuration, not equipment.
- row 732: SRV-THOR-013 (Microsoft/Azure) — excluded as configuration, not equipment.

## Reused-tag reassignments

- row 961 (DST215 -> TMP-0001): Asset ID 'DST215' was shared with a SIM (Cellular Service) row; the SIM kept the tag (edge case: 11 reused non-serialised tags). This row (a DataLogger) is retagged TMP-0001, original preserved.
- row 962 (DST289 -> TMP-0002): Asset ID 'DST289' was shared with a SIM (Cellular Service) row; the SIM kept the tag (edge case: 11 reused non-serialised tags). This row (a DataLogger) is retagged TMP-0002, original preserved.
- row 963 (DST241 -> TMP-0003): Asset ID 'DST241' was shared with a SIM (Cellular Service) row; the SIM kept the tag (edge case: 11 reused non-serialised tags). This row (a DataLogger) is retagged TMP-0003, original preserved.
- row 964 (DST065 -> TMP-0004): Asset ID 'DST065' was shared with a SIM (Cellular Service) row; the SIM kept the tag (edge case: 11 reused non-serialised tags). This row (a Geophone) is retagged TMP-0004, original preserved.
- row 965 (DST025 -> TMP-0005): Asset ID 'DST025' was shared with a SIM (Cellular Service) row; the SIM kept the tag (edge case: 11 reused non-serialised tags). This row (a Geophone) is retagged TMP-0005, original preserved.
- row 966 (DST301 -> TMP-0006): Asset ID 'DST301' was shared with a SIM (Cellular Service) row; the SIM kept the tag (edge case: 11 reused non-serialised tags). This row (a Geophone) is retagged TMP-0006, original preserved.
- row 967 (DST098 -> TMP-0007): Asset ID 'DST098' was shared with a SIM (Cellular Service) row; the SIM kept the tag (edge case: 11 reused non-serialised tags). This row (a SoundLevelMeter) is retagged TMP-0007, original preserved.
- row 968 (DST078 -> TMP-0008): Asset ID 'DST078' was shared with a SIM (Cellular Service) row; the SIM kept the tag (edge case: 11 reused non-serialised tags). This row (a SoundLevelMeter) is retagged TMP-0008, original preserved.
- row 969 (DST243 -> TMP-0009): Asset ID 'DST243' was shared with a SIM (Cellular Service) row; the SIM kept the tag (edge case: 11 reused non-serialised tags). This row (a SoundLevelMeter) is retagged TMP-0009, original preserved.

## Asset-ID collision corrections

- row 171 (DL-UM-16920 -> GEO-UM-16920): Asset ID 'DL-UM-16920' was shared by rows of different equipment types (found alongside a DataLogger row) — these are two different physical assets mistakenly given the same tag. This row (a Geophone) is re-tagged to GEO-UM-16920, matching its own model's prefix; original preserved.

## Duplicates collapsed (same Asset ID)

- DL-UM-16850: 2 rows, same office (SWO) — kept row 518 (most complete), dropped the rest.
- GEO-UM-16850: 2 rows, same office (SWO) — kept row 555 (most complete), dropped the rest.
- DST100: 2 rows, same office (Sudbury) — kept row 919 (most complete), dropped the rest.
- SLM-S50-13595: same asset listed under 2 offices (London, Ottawa) — home office set to Ottawa (row 86, most complete record). See 02_conflicts.md.
- DL-UM-16984: same asset listed under 2 offices (Sudbury, Toronto) — home office set to Sudbury (row 298, most complete record). See 02_conflicts.md.
- GEO-UM-16984: same asset listed under 2 offices (Sudbury, Toronto) — home office set to Toronto (row 164, most complete record). See 02_conflicts.md.
- DL-UM-15713: same asset listed under 2 offices (Sudbury, Toronto) — home office set to Sudbury (row 299, most complete record). See 02_conflicts.md.
- GEO-UM-15713: same asset listed under 2 offices (Sudbury, Toronto) — home office set to Toronto (row 177, most complete record). See 02_conflicts.md.
- DL-UM-16842: same asset listed under 2 offices (Sudbury, Toronto) — home office set to Sudbury (row 297, most complete record). See 02_conflicts.md.
- GEO-UM-16842: same asset listed under 2 offices (Sudbury, Toronto) — home office set to Toronto (row 181, most complete record). See 02_conflicts.md.
- DL-BE-20745: same asset listed under 2 offices (Sudbury, Toronto) — home office set to Sudbury (row 332, most complete record). See 02_conflicts.md.
- DL-BE-20600: same asset listed under 2 offices (Sudbury, Toronto) — home office set to Sudbury (row 333, most complete record). See 02_conflicts.md.
- GEO-V12-30220: same asset listed under 2 offices (Kitchener, Toronto) — home office set to Toronto (row 251, most complete record). See 02_conflicts.md.
- DL-MP-13332: same asset listed under 2 offices (Ottawa, Sudbury) — home office set to Ottawa (row 702, most complete record). See 02_conflicts.md.
- GEO-BG-18201: same asset listed under 2 offices (Kitchener, SWO) — home office set to SWO (row 550, most complete record). See 02_conflicts.md.
- GEO-V12-32700: same asset listed under 2 offices (Kitchener, London) — home office set to Kitchener (row 605, most complete record). See 02_conflicts.md.
- SLM-S50-14575: same asset listed under 2 offices (London, Stoney Creek) — home office set to London (row 610, most complete record). See 02_conflicts.md.
- DST220: same asset listed under 2 offices (SWO, Sudbury) — home office set to SWO (row 875, most complete record). See 02_conflicts.md.
- DST372: same asset listed under 2 offices (, Sudbury) — home office set to Sudbury (row 960, most complete record). See 02_conflicts.md.

## Unresolved custodians / low-confidence resolutions

- DL-BE-20593 (source row 270): Staff='JLV -> resolved to Jacob Lemieux Vandal by initials (flagged, not a full-name match)'
- DL-BE-13367 (source row 277): Staff='JLV -> resolved to Jacob Lemieux Vandal by initials (flagged, not a full-name match)'
- DL-UM-21943 (source row 287): Staff='Noah M'
- DL-UM-15387 (source row 296): Staff='South East Lobe 2'
- DL-UM-16917 (source row 312): Staff='RC -> resolved to Rachel Charette by initials (flagged, not a full-name match)'
- DL-UM-16959 (source row 315): Staff='Sudbury staff'
- DL-UM-12569 (source row 321): Staff='JR -> resolved to James Ross by initials (flagged, not a full-name match)'
- DL-UM-17272 (source row 327): Staff='JR -> resolved to James Ross by initials (flagged, not a full-name match)'
- DL-BE-11418 (source row 346): Staff='JR -> resolved to James Ross by initials (flagged, not a full-name match)'
- DL-BE-21022 (source row 364): Staff='RC -> resolved to Rachel Charette by initials (flagged, not a full-name match)'
- AC-007 (source row 1006): Staff='MM'
- AC-011 (source row 1019): Staff='MV -> resolved to Martin Villeneuve by initials (flagged, not a full-name match)'

## Note: zero Retired assets survive this load

All 5 source rows carrying Lifecycle Status=Retired are among the 13 excluded Azure/Server rows (Q6) — every one of the fleet's on-paper retirements turns out to be a decommissioned Azure resource, not a physical instrument. If Q6 is reversed (Azure rows are loaded after all), those 5 rows return as the fleet's only pre-existing Retired assets; as things stand, 0 of the 1026 loaded assets are Retired, so feature 001 US5 (retire an asset) has nothing pre-existing to exercise against migrated data and must be demonstrated by retiring a freshly-registered asset instead.

## Assets landed on the 'Unassigned' placeholder office (9)

Source had no Current Office at all for these — not a guess, a completion-queue item (feature 002 FR-032). An admin assigns the real home office in the app.
- SRV-INFRANet (source row 733)
- SRV-Vision (source row 734)
- SRV-Vision II (source row 735)
- DST309 (source row 971)
- DST143 (source row 972)
- DST104 (source row 973)
- DST381 (source row 974)
- DST422 (source row 975)
- DST265 (source row 976)

## Non-name values found in the Staff column

- 'South East Lobe 2' and 'Sudbury staff' are not people; left unresolved as designed rather than guessed.
