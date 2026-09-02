# 05 — Calibration matching report

Source rows: 253.
Matched to an asset: 164 (59 resolved via the documented Micromate ambiguity rule — defaulted to the Data Logger, flagged below).
Skipped (no usable date — FR-020): 87 (47 literal 'N/A'/'#VALUE!' rows + 40 blank-date/1900-sentinel rows).
Unmatched (usable date, no asset found — FR-021): 2.
Same asset + same calibration date recorded twice: 0.

After matching, 863 Active assets have no next-due date at all — these are assets with zero calibration history (no matched record, and no history to derive one from). Feature 004 US1 (FR-003) groups these as 'calibration status unknown' rather than omitting them.

## Ambiguous matches (Micromate -> defaulted to Data Logger, per docs/04-migration.md)

- source row 7, serial UM18425: matched **DL-UM-18425**, could also be ['GEO-UM-18425'].
- source row 8, serial UM21927: matched **DL-UM-21927**, could also be ['GEO-UM-21927'].
- source row 9, serial UM18392: matched **DL-UM-18392**, could also be ['GEO-UM-18392'].
- source row 10, serial UM21931: matched **DL-UM-21931**, could also be ['GEO-UM-21931'].
- source row 11, serial UM16960: matched **DL-UM-16960**, could also be ['GEO-UM-16960'].
- source row 12, serial UM15392: matched **DL-UM-15392**, could also be ['GEO-UM-15392'].
- source row 13, serial UM16818: matched **DL-UM-16818**, could also be ['GEO-UM-16818'].
- source row 14, serial UM16598: matched **DL-UM-16598**, could also be ['GEO-UM-16598'].
- source row 15, serial UM12572: matched **DL-UM-12572**, could also be ['GEO-UM-12572'].
- source row 16, serial UM11555: matched **DL-UM-11555**, could also be ['GEO-UM-11555'].
- source row 17, serial UM12108: matched **DL-UM-12108**, could also be ['GEO-UM-12108'].
- source row 18, serial UM21925: matched **DL-UM-21925**, could also be ['GEO-UM-21925'].
- source row 19, serial UM18473: matched **DL-UM-18473**, could also be ['GEO-UM-18473'].
- source row 20, serial UM21929: matched **DL-UM-21929**, could also be ['GEO-UM-21929'].
- source row 21, serial UM17270: matched **DL-UM-17270**, could also be ['GEO-UM-17270'].
- source row 22, serial UM17281: matched **DL-UM-17281**, could also be ['GEO-UM-17281'].
- source row 23, serial UM18390: matched **DL-UM-18390**, could also be ['GEO-UM-18390'].
- source row 24, serial UM21933: matched **DL-UM-21933**, could also be ['GEO-UM-21933'].
- source row 25, serial UM17198: matched **DL-UM-17198**, could also be ['GEO-UM-17198'].
- source row 26, serial UM17269: matched **DL-UM-17269**, could also be ['GEO-UM-17269'].
- source row 30, serial UM12100: matched **DL-UM-12100**, could also be ['GEO-UM-12100'].
- source row 31, serial UM17263: matched **DL-UM-17263**, could also be ['GEO-UM-17263'].
- source row 32, serial UM16815: matched **DL-UM-16815**, could also be ['GEO-UM-16815'].
- source row 33, serial UM17176: matched **DL-UM-17176**, could also be ['GEO-UM-17176'].
- source row 34, serial UM15403: matched **DL-UM-15403**, could also be ['GEO-UM-15403'].
- source row 35, serial UM17314: matched **DL-UM-17314**, could also be ['GEO-UM-17314'].
- source row 36, serial UM15720: matched **DL-UM-15720**, could also be ['GEO-UM-15720'].
- source row 37, serial UM21932: matched **DL-UM-21932**, could also be ['GEO-UM-21932'].
- source row 38, serial UM17179: matched **DL-UM-17179**, could also be ['GEO-UM-17179'].
- source row 102, serial UM17049: matched **DL-UM-17049**, could also be ['GEO-UM-17049'].
- source row 103, serial UM21945: matched **DL-UM-21945**, could also be ['GEO-UM-21945'].
- source row 105, serial UM17273: matched **DL-UM-17273**, could also be ['GEO-UM-17273'].
- source row 107, serial UM7134: matched **DL-UM-7134**, could also be ['GEO-UM-7134'].
- source row 109, serial UM12574: matched **DL-UM-12574**, could also be ['GEO-UM-12574'].
- source row 110, serial UM15396: matched **DL-UM-15396**, could also be ['GEO-UM-15396'].
- source row 112, serial UM17278: matched **DL-UM-17278**, could also be ['GEO-UM-17278'].
- source row 113, serial UM17266: matched **DL-UM-17266**, could also be ['GEO-UM-17266'].
- source row 114, serial UM16984: matched **DL-UM-16984**, could also be ['GEO-UM-16984'].
- source row 115, serial UM8293: matched **DL-UM-8293**, could also be ['GEO-UM-8293'].
- source row 116, serial UM15390: matched **DL-UM-15390**, could also be ['GEO-UM-15390'].
- source row 117, serial UM18423: matched **DL-UM-18423**, could also be ['GEO-UM-18423'].
- source row 118, serial UM17268: matched **DL-UM-17268**, could also be ['GEO-UM-17268'].
- source row 120, serial UM16920: matched **DL-UM-16920**, could also be ['GEO-UM-16920'].
- source row 122, serial UM18235: matched **DL-UM-18235**, could also be ['GEO-UM-18235'].
- source row 124, serial UM15713: matched **DL-UM-15713**, could also be ['GEO-UM-15713'].
- source row 126, serial UM16842: matched **DL-UM-16842**, could also be ['GEO-UM-16842'].
- source row 129, serial UM13816: matched **DL-UM-13816**, could also be ['GEO-UM-13816'].
- source row 132, serial UM12105: matched **DL-UM-12105**, could also be ['GEO-UM-12105'].
- source row 133, serial UM20781: matched **DL-UM-20781**, could also be ['GEO-UM-20781'].
- source row 134, serial UM20931: matched **DL-UM-20931**, could also be ['GEO-UM-20931'].
- source row 135, serial UM15390: matched **DL-UM-15390**, could also be ['GEO-UM-15390'].
- source row 137, serial UM21926: matched **DL-UM-21926**, could also be ['GEO-UM-21926'].
- source row 138, serial UM15389: matched **DL-UM-15389**, could also be ['GEO-UM-15389'].
- source row 139, serial UM18234: matched **DL-UM-18234**, could also be ['GEO-UM-18234'].
- source row 140, serial UM20908: matched **DL-UM-20908**, could also be ['GEO-UM-20908'].
- source row 141, serial UM17259: matched **DL-UM-17259**, could also be ['GEO-UM-17259'].
- source row 147, serial UM17284: matched **DL-UM-17284**, could also be ['GEO-UM-17284'].
- source row 160, serial UM16982: matched **DL-UM-16982**, could also be ['GEO-UM-16982'].
- source row 204, serial UM18236: matched **DL-UM-18236**, could also be ['GEO-UM-18236'].
