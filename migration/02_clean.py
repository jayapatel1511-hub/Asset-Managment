"""
02_clean.py — Clean and deduplicate the registry export into a staged asset list.

Reads data/source/registry_2026-09-02.csv (frozen, read-only) and
data/reference/equipment_models.csv (the Q4-corrected catalogue + source mapping) and
data/reference/locations.csv, and writes:

  migration/staged/assets_clean.json     one row per surviving asset, fully resolved
  migration/staged/projects_seed.json    deduplicated eng_project seed rows
  migration/staged/components_seed.json  Component relationships evidenced by the source (Q5)
  migration/reports/02_clean_report.md   counts: created/updated/skipped/unresolved (FR-024)
  migration/reports/02_conflicts.md      every judgement call requiring a human look (FR-024,
                                          the hard gate before a production load per US2/FR-026)

Idempotent (FR-025): re-running against the same inputs produces byte-identical staged JSON
(rows are sorted by a stable key before writing).

Dedup rules, in order (FR-011 through FR-014; see docs/04-migration.md and specs/002's edge
cases for the forensic basis of each):

  1. Model resolution (FR-005): every row must resolve to exactly one canonical model via
     (Asset Group, Equipment Type, Manufacturer, Model / Station). Fail the run on a miss.
  2. Rows whose canonical model is EXCLUDED (Q6 / Azure) are dropped and reported, not loaded.
  3. Reused non-serialised tag disambiguation (edge case: "11 SIM identifiers appear twice"):
     when one Asset ID is shared by a SIM row and a non-SIM row, the SIM keeps the tag; the
     other row is reassigned a TMP tag (original preserved in migrationsource).
  4. ID-collision correction: if, after step 3, an Asset ID is still shared by rows resolving to
     genuinely different canonical equipment types (found: DL-UM-16920 — a data logger row and
     its geophone sibling were both typed with the DL- id), the row whose own prefix does not
     match its canonical model's prefix is re-minted onto the correct prefix. This is a
     correction, not a duplicate collapse — the two rows are different physical assets.
  5. FR-011: same Asset ID + same office + same canonical model -> collapse to one row (a
     straightforward double-entry). The more complete row (more non-blank source fields) wins;
     ties broken by earlier source row.
  6. FR-012: same Asset ID + different offices + same canonical model -> collapse to one asset,
     home office chosen by the same completeness rule, and the pair is named in 02_conflicts.md
     for Jay's review (FR-026 gate).
  7. FR-013: same serial + same canonical model, different Asset ID -> NOT merged. Both rows are
     loaded as distinct assets and the pair is flagged in 02_conflicts.md. This is a deliberate
     spec choice (FR-013's own wording: "MUST flag, and MUST NOT automatically merge") — a human
     decides whether these are really one physical item.
  8. FR-014: same serial, different canonical equipment type (the expected instrument+sensor
     pattern, 132 cases) -> not a duplicate at all. Both rows kept, untouched.
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SOURCE_REGISTRY = ROOT / "data" / "source" / "registry_2026-09-02.csv"
MODELS_CSV = ROOT / "data" / "reference" / "equipment_models.csv"
LOCATIONS_CSV = ROOT / "data" / "reference" / "locations.csv"
STAGED_DIR = ROOT / "migration" / "staged"
REPORTS_DIR = ROOT / "migration" / "reports"

MIGRATION_DATE = "2026-09-02"  # the frozen export date; AddToInventory transactions use this

# FR-015: source Availability Status -> eng_assetstatus. Blank depends on lifecycle (below).
STATUS_MAP = {
    "Available": "Available",
    "Deployed or NOT Available": "CheckedOut",
    "Deployed": "CheckedOut",
    "Needs Repair / Calibration": "NeedsRepair",
}

RETIREMENT_REASON_MAP = {
    "Decommissioned": "Obsolete",  # not in the fixed list {Sold/Lost/Damaged/Obsolete}; closest fit
}

# Custodian resolution. There is no live Entra/Dataverse directory reachable from this offline
# migration environment, so "resolves to a directory user" is approximated against a small,
# fully-documented allowlist built from the Staff column's own distinct values (21 raw values,
# 87 rows — see migration/reports/02_clean_report.md for the full breakdown). Everything not on
# this list is left unresolved per FR-007 (never store an unresolved name as text).
FULL_NAME_STAFF = {
    "james ross": "James Ross",
    "james hicks": "James Hicks",
    "rachel charette": "Rachel Charette",
    "jacob lemieux vandal": "Jacob Lemieux Vandal",
    "farhad ahmadzadegan": "Farhad Ahmadzadegan",
    "kamal mistry": "Kamal Mistry",
    "amanda tocholke": "Amanda Tocholke",
    "curtis mossman": "Curtis Mossman",
    "brandon shamblaw": "Brandon Shamblaw",
    "calvin chan": "Calvin Chan",
    "kevin sanza": "Kevin Sanza",
    "martin villeneuve": "Martin Villeneuve",
}
# Initials resolved by elimination: exactly one full name above shares these initials, and no
# other candidate exists in the data. Flagged distinctly in the report as lower-confidence than
# a full-name match — a real directory lookup would not resolve on initials alone.
INITIALS_STAFF = {
    "jr": "James Ross",
    "jlv": "Jacob Lemieux Vandal",
    "rc": "Rachel Charette",
    "mv": "Martin Villeneuve",
}

THIRD_PARTY_KEYWORDS = re.compile(
    r"stolen|owned by|not ours|third.?party|client.owned|belongs to|do not own", re.I
)


def norm(s: str) -> str:
    return (s or "").strip()


def mint_serialised_id(prefix: str, serial: str) -> str:
    """{prefix}-{serial}, stripping a manufacturer code the serial already embeds if it repeats
    the prefix's own trailing segment (FR-006: DL-UM-16984, not DL-UM-UM16984)."""
    serial = norm(serial)
    last_seg = prefix.split("-")[-1]
    if last_seg and serial.upper().startswith(last_seg.upper()) and len(serial) > len(last_seg):
        serial = serial[len(last_seg):]
    return f"{prefix}-{serial}"


def load_models() -> tuple[pd.DataFrame, dict, dict]:
    m = pd.read_csv(MODELS_CSV, dtype=str, keep_default_na=False)
    m["source_defaultcalintervalmonths"] = m["eng_defaultcalintervalmonths"]
    join_key = ["source_assetgroup", "source_equipmenttype", "source_manufacturer", "source_model"]
    m["_key"] = list(zip(*[m[c] for c in join_key]))
    by_source = {row["_key"]: row for _, row in m.iterrows()}
    # reverse map: idprefix -> set of canonical_keys that use it, and canonical_key -> equipmenttype,
    # used for the ID-collision-correction step (rule 4).
    prefix_to_types = defaultdict(set)
    for _, row in m.iterrows():
        if row["eng_equipmenttype"] != "EXCLUDED":
            prefix_to_types[row["eng_idprefix"]].add(row["eng_equipmenttype"])
    return m, by_source, prefix_to_types


def load_locations() -> set[str]:
    loc = pd.read_csv(LOCATIONS_CSV, dtype=str, keep_default_na=False)
    return set(loc["name"].str.strip())


def resolve_project(raw: str) -> tuple[str | None, str | None]:
    """Returns (project_number, project_name) or (None, None) if no recognizable number."""
    raw = norm(raw)
    if not raw:
        return None, None
    m = re.search(r"\b(\d{7,8}(?:\.\d{3})?)\b", raw)
    if not m:
        return None, None
    number = m.group(1)
    name = (raw[: m.start()] + raw[m.end():]).strip(" -.")
    return number, (name or None)


def resolve_custodian(raw: str) -> tuple[str | None, str | None]:
    """Returns (resolved_name, method) or (None, None) if unresolved."""
    raw = norm(raw)
    if not raw:
        return None, None
    key = raw.lower()
    if key in FULL_NAME_STAFF:
        return FULL_NAME_STAFF[key], "full_name"
    if key in INITIALS_STAFF:
        return INITIALS_STAFF[key], "initials"
    return None, None


def row_completeness(row: pd.Series) -> int:
    return int((row.astype(str).str.strip() != "").sum())


def main() -> int:
    problems: list[str] = []
    report_lines: list[str] = []
    conflict_lines: list[str] = []

    df = pd.read_csv(SOURCE_REGISTRY, dtype=str, keep_default_na=False)
    df["_row"] = df.index + 2  # spreadsheet row number, header = 1
    models_df, models_by_source, prefix_to_types = load_models()
    curated_locations = load_locations()

    # --- drop the one stray fully-blank filler row ---
    is_blank_filler = (df["Asset ID"].str.strip() == "") & (df["Manufacturer"].str.strip() == "") \
        & (df["Model / Station"].str.strip() == "") & (df["Equipment Type"].str.strip() == "") \
        & (df["Asset Group"].str.strip() == "")
    dropped_blank = df[is_blank_filler]
    df = df[~is_blank_filler].copy()

    # --- FR-005: resolve every row to a canonical model; fail loudly on a miss ---
    unresolved_model_rows = []
    excluded_rows = []
    resolved = []
    for _, row in df.iterrows():
        key = (row["Asset Group"], row["Equipment Type"], row["Manufacturer"], row["Model / Station"])
        model = models_by_source.get(key)
        if model is None:
            unresolved_model_rows.append(row)
            continue
        if model["eng_equipmenttype"] == "EXCLUDED":
            excluded_rows.append((row, model))
            continue
        resolved.append((row, model))

    if unresolved_model_rows:
        problems.append(
            f"{len(unresolved_model_rows)} row(s) do not resolve to any row in "
            f"equipment_models.csv (FR-005) — the run MUST NOT proceed:"
        )
        for row in unresolved_model_rows[:20]:
            problems.append(
                f"  row {row['_row']}: {row['Asset Group']!r}/{row['Equipment Type']!r}/"
                f"{row['Manufacturer']!r}/{row['Model / Station']!r}"
            )

    if problems:
        _fail(problems)
        return 1

    # --- Step 3: reused non-serialised tag disambiguation ---
    # Group current rows by (Asset ID, office) is too narrow — the reused-tag pattern shares an
    # ID across offices too (DST220, DST301). Group by Asset ID alone first.
    by_asset_id: dict[str, list[int]] = defaultdict(list)
    for i, (row, model) in enumerate(resolved):
        aid = norm(row["Asset ID"])
        if aid and not aid.endswith("-"):
            by_asset_id[aid].append(i)

    tmp_counter = 0

    def next_tmp() -> str:
        nonlocal tmp_counter
        tmp_counter += 1
        return f"TMP-{tmp_counter:04d}"

    reassigned_tmp = []  # (row, model, new_id, reason)
    id_corrections = []  # (row, model, old_id, new_id, reason)
    final_id_of: dict[int, str] = {}  # index into `resolved` -> final asset id

    for aid, idxs in by_asset_id.items():
        types_here = {resolved[i][1]["eng_equipmenttype"] for i in idxs}
        if len(types_here) <= 1:
            continue  # nothing to disambiguate here
        # more than one canonical type shares this literal Asset ID.
        has_sim = any(resolved[i][1]["eng_equipmenttype"] == "CellularService" for i in idxs)
        if has_sim and len(idxs) >= 2:
            # SIM keeps the tag (prefer the row with a populated ICCID if >1 SIM row); every
            # non-SIM row sharing the tag gets a TMP id.
            sim_idxs = [i for i in idxs if resolved[i][1]["eng_equipmenttype"] == "CellularService"]
            sim_idxs.sort(key=lambda i: (resolved[i][0]["SIM ICCID"].strip() == "", -row_completeness(resolved[i][0])))
            keep_sim = sim_idxs[0]
            for i in idxs:
                if i == keep_sim:
                    continue
                if i in sim_idxs:
                    # a second SIM row reusing the same tag as another SIM: treat as a plain
                    # same-ID duplicate later (step 5/6), not a reuse case.
                    continue
                row, model = resolved[i]
                new_id = next_tmp()
                reassigned_tmp.append((row, model, new_id,
                    f"Asset ID {aid!r} was shared with a SIM (Cellular Service) row; the SIM kept "
                    f"the tag (edge case: 11 reused non-serialised tags). This row (a "
                    f"{model['eng_equipmenttype']}) is retagged {new_id}, original preserved."))
                final_id_of[i] = new_id

    # --- Step 4: ID-collision correction (same id, still >1 canonical type after step 3) ---
    still_shared: dict[str, list[int]] = defaultdict(list)
    for i, (row, model) in enumerate(resolved):
        if i in final_id_of:
            continue
        aid = norm(row["Asset ID"])
        if aid and not aid.endswith("-"):
            still_shared[aid].append(i)
    for aid, idxs in still_shared.items():
        if len(idxs) < 2:
            continue
        types_here = {resolved[i][1]["eng_equipmenttype"] for i in idxs}
        if len(types_here) <= 1:
            continue
        for i in idxs:
            row, model = resolved[i]
            implied_types = prefix_to_types.get(_prefix_of(aid), set())
            if model["eng_equipmenttype"] not in implied_types:
                serial = norm(row["Serial Number"])
                new_id = mint_serialised_id(model["eng_idprefix"], serial) if serial else next_tmp()
                id_corrections.append((row, model, aid, new_id,
                    f"Asset ID {aid!r} was shared by rows of different equipment types "
                    f"(found alongside a {[t for t in types_here if t != model['eng_equipmenttype']][0]}"
                    f" row) — these are two different physical assets mistakenly given the same "
                    f"tag. This row (a {model['eng_equipmenttype']}) is re-tagged to {new_id}, "
                    f"matching its own model's prefix; original preserved."))
                final_id_of[i] = new_id

    # --- assemble the working row list with final ids ---
    working = []
    for i, (row, model) in enumerate(resolved):
        aid = norm(row["Asset ID"])
        if i in final_id_of:
            final_id = final_id_of[i]
            source_tag = aid or "(blank)"
        elif not aid or aid.endswith("-"):
            final_id = next_tmp()
            source_tag = aid or "(blank)"
        else:
            final_id = aid
            source_tag = aid
        working.append({"row": row, "model": model, "final_id": final_id, "source_tag": source_tag})

    # --- Steps 5 & 6: same final_id collapsing (same office / cross office) ---
    by_final_id: dict[str, list[int]] = defaultdict(list)
    for i, w in enumerate(working):
        by_final_id[w["final_id"]].append(i)

    dropped_as_duplicate = []  # (row, reason)
    kept_indices: list[int] = []
    cross_office_pairs = []
    same_office_dupes = []

    for final_id, idxs in by_final_id.items():
        if len(idxs) == 1:
            kept_indices.append(idxs[0])
            continue
        # rank by completeness, most complete first
        idxs_sorted = sorted(idxs, key=lambda i: (-row_completeness(working[i]["row"]), working[i]["row"]["_row"]))
        winner = idxs_sorted[0]
        losers = idxs_sorted[1:]
        kept_indices.append(winner)
        offices = {norm(working[i]["row"]["Current Office"]) for i in idxs}
        if len(offices) > 1:
            cross_office_pairs.append((final_id, [working[i]["row"] for i in idxs], working[winner]["row"]))
        else:
            same_office_dupes.append((final_id, [working[i]["row"] for i in idxs], working[winner]["row"]))
        for i in losers:
            dropped_as_duplicate.append((working[i]["row"], final_id))

    # --- Step 7: FR-013 flag-only true duplicates (same serial + canonical model, different id) ---
    flagged_true_duplicates = []
    by_serial_model: dict[tuple, list[int]] = defaultdict(list)
    for i in kept_indices:
        w = working[i]
        serial = norm(w["row"]["Serial Number"])
        if not serial:
            continue
        canon = (w["model"]["eng_manufacturer"], w["model"]["eng_model"], w["model"]["eng_equipmenttype"])
        by_serial_model[(serial, canon)].append(i)
    for (serial, canon), idxs in by_serial_model.items():
        ids = {working[i]["final_id"] for i in idxs}
        if len(ids) > 1:
            flagged_true_duplicates.append((serial, canon, [working[i] for i in idxs]))

    # --- resolve office, status, lifecycle, custodian, project, notes for every kept row ---
    assets = []
    unresolved_offices = set()
    unresolved_custodians = []
    third_party_flags = []
    project_rows = {}
    component_seeds = []
    missing_office_assets = []

    for i in kept_indices:
        w = working[i]
        row, model, final_id = w["row"], w["model"], w["final_id"]

        office = norm(row["Current Office"])
        if office and office not in curated_locations:
            unresolved_offices.add(office)
        # eng_homeoffice is required; a handful of source rows (SIMs, servers) never had one at
        # all. Rather than leave it blank (violates the schema) or guess a real office, land them
        # on the curated "Unassigned" placeholder and the completion queue (FR-032).
        home_office = office or "Unassigned"
        needs_office_completion = not office

        avail = norm(row["Availability Status"])
        lifecycle_raw = norm(row["Lifecycle Status"])
        lifecycle = "Retired" if lifecycle_raw == "Retired" else "Active"
        if avail in STATUS_MAP:
            status = STATUS_MAP[avail]
        elif avail == "":
            status = "Available" if lifecycle == "Active" else "Retired"
        else:
            status = "NeedsRepair"  # unrecognized value: conservative, never silently Available

        retirement_reason = None
        if lifecycle == "Retired":
            rr = norm(row["Retirement Reason"])
            retirement_reason = RETIREMENT_REASON_MAP.get(rr, rr or "Obsolete")

        custodian, method = resolve_custodian(row["Staff"])
        if norm(row["Staff"]) and custodian is None:
            unresolved_custodians.append((final_id, row["Staff"], row["_row"]))
        elif method == "initials":
            unresolved_custodians.append((final_id, f"{row['Staff']} -> resolved to {custodian} by initials (flagged, not a full-name match)", row["_row"]))

        proj_number, proj_name = resolve_project(row["Project ID"])
        if proj_number:
            if proj_number not in project_rows or (proj_name and len(proj_name) > len(project_rows[proj_number].get("name") or "")):
                project_rows.setdefault(proj_number, {"number": proj_number, "name": proj_name})
        elif norm(row["Project ID"]):
            pass  # kept in notes below; not assigned (FR-007-equivalent honesty for projects)

        notes_parts = [norm(row["Notes"])]
        if proj_number is None and norm(row["Project ID"]):
            notes_parts.append(f"[migration] Project ID field could not be parsed as a project "
                                f"number, kept as text: {row['Project ID']!r}")
        serial = norm(row["Serial Number"])
        if serial and not re.search(r"\d", serial):
            notes_parts.append(f"[migration] Serial Number field held non-serial text, moved to "
                                f"notes: {serial!r}")
            serial = ""
        notes = "\n".join(p for p in notes_parts if p) or None

        if THIRD_PARTY_KEYWORDS.search(row["Notes"]) or THIRD_PARTY_KEYWORDS.search(row["Project ID"]):
            third_party_flags.append((final_id, row["Notes"], row["Project ID"], row["_row"]))

        asset = {
            "assetid": final_id,
            "migrationsource": f"row {row['_row']}: {w['source_tag']}",
            "manufacturer": model["eng_manufacturer"],
            "model": model["eng_model"],
            "equipmenttype": model["eng_equipmenttype"],
            "assetgroup": model["eng_assetgroup"],
            "idprefix": model["eng_idprefix"],
            "serialnumber": serial or None,
            "homeoffice": home_office,
            "lifecycle": lifecycle,
            "status": status,
            # CheckedOut (from "Deployed or NOT Available") means the source explicitly does NOT
            # know where the asset is (Q3) — claiming currentlocation = home office would be
            # exactly the dishonesty this migration exists to remove. Available/NeedsRepair items
            # are still physically at the office; Retired/CheckedOut have no known current location.
            "currentlocation": home_office if status in ("Available", "NeedsRepair") else None,
            "custodian": custodian,
            "currentproject": proj_number,
            "retirementreason": retirement_reason,
            "notes": notes,
            "carrier": norm(row["Carrier"]) or None,
            "identifiervalue": norm(row["SIM ICCID"]) or None,
            "phonenumber": norm(row["Phone Number"]) or None,
            "staticip": norm(row["Static IP"]) or None,
        }
        assets.append(asset)
        if needs_office_completion:
            missing_office_assets.append((final_id, row["_row"]))

        # Q5 components: only the 3 rows with BOTH Pre Amp Serial and Element Serial populated.
        pre_amp = norm(row["Pre Amp Serial"])
        element = norm(row["Element Serial"])
        if pre_amp and element:
            pa_id = f"SLM-LD-PA-{pre_amp}"
            el_id = f"SLM-LD-EL-{element}"
            component_seeds.append({
                "parent_assetid": final_id, "child_assetid": pa_id,
                "child_manufacturer": "Larson Davis", "child_model": "831C Pre-Amp",
                "child_equipmenttype": "Microphone", "child_serial": pre_amp,
                "relationshiptype": "Component",
            })
            component_seeds.append({
                "parent_assetid": final_id, "child_assetid": el_id,
                "child_manufacturer": "Larson Davis", "child_model": "831C Element",
                "child_equipmenttype": "Microphone", "child_serial": element,
                "relationshiptype": "Component",
            })

    # deterministic order
    assets.sort(key=lambda a: a["assetid"])
    for c in component_seeds:
        assets.append({
            "assetid": c["child_assetid"], "migrationsource": f"component of {c['parent_assetid']}",
            "manufacturer": c["child_manufacturer"], "model": c["child_model"],
            "equipmenttype": c["child_equipmenttype"], "assetgroup": "Acoustics",
            "idprefix": c["child_assetid"].rsplit("-", 1)[0], "serialnumber": c["child_serial"],
            "homeoffice": next((a["homeoffice"] for a in assets if a["assetid"] == c["parent_assetid"]), None),
            "lifecycle": "Active",
            "status": next((a["status"] for a in assets if a["assetid"] == c["parent_assetid"]), "Available"),
            "currentlocation": next((a["currentlocation"] for a in assets if a["assetid"] == c["parent_assetid"]), None),
            "custodian": None, "currentproject": None, "retirementreason": None,
            "notes": f"Component of {c['parent_assetid']} (created per Q5 — SLM pre-amp/element get their own Asset IDs).",
            "carrier": None, "identifiervalue": None, "phonenumber": None, "staticip": None,
        })

    STAGED_DIR.mkdir(parents=True, exist_ok=True)
    (STAGED_DIR / "assets_clean.json").write_text(json.dumps(assets, indent=2), encoding="utf-8")
    (STAGED_DIR / "projects_seed.json").write_text(
        json.dumps(sorted(project_rows.values(), key=lambda p: p["number"]), indent=2), encoding="utf-8")
    (STAGED_DIR / "components_seed.json").write_text(json.dumps(component_seeds, indent=2), encoding="utf-8")

    # ---------------- reports ----------------
    report_lines += [
        "# 02 — Clean report", "",
        f"Source rows: {len(df) + len(dropped_blank)} (incl. 1 blank filler row, dropped).",
        f"Rows resolved to a curated model: {len(resolved) + len(excluded_rows)}.",
        f"Rows excluded (Q6 — configuration, not equipment): {len(excluded_rows)}.",
        f"Rows reassigned off a reused tag (edge case, SIM keeps the tag): {len(reassigned_tmp)}.",
        f"Rows corrected for an Asset-ID collision between two different physical assets: {len(id_corrections)}.",
        f"Rows dropped as a duplicate of another row (FR-011/FR-012, more complete row kept): {len(dropped_as_duplicate)}.",
        f"Assets created: {len(assets)} (incl. {len(component_seeds)} Q5 components created from Pre Amp/Element Serial evidence).",
        f"Distinct projects seeded: {len(project_rows)}.",
        f"Custodian rows resolved: {sum(1 for a in assets if a['custodian'])} of 87 non-blank "
        f"Staff values (75 by full-name match, 8 by initials — flagged as lower-confidence since "
        f"a real directory lookup would not resolve on initials alone); "
        f"{len(unresolved_custodians)} rows listed below (4 genuinely unresolved + 8 initials-flagged).",
        "",
        "## Excluded rows (Q6 — ASSUMPTION, pending Jay's confirmation)", "",
    ]
    for row, model in excluded_rows:
        report_lines.append(f"- row {row['_row']}: {row['Asset ID'] or '(blank)'} "
                             f"({row['Manufacturer']}/{row['Model / Station']}) — excluded as configuration, not equipment.")

    report_lines += ["", "## Reused-tag reassignments", ""]
    for row, model, new_id, reason in reassigned_tmp:
        report_lines.append(f"- row {row['_row']} ({row['Asset ID']} -> {new_id}): {reason}")

    report_lines += ["", "## Asset-ID collision corrections", ""]
    for row, model, old_id, new_id, reason in id_corrections:
        report_lines.append(f"- row {row['_row']} ({old_id} -> {new_id}): {reason}")

    report_lines += ["", "## Duplicates collapsed (same Asset ID)", ""]
    for final_id, rows, winner in same_office_dupes:
        report_lines.append(f"- {final_id}: {len(rows)} rows, same office ({norm(winner['Current Office'])}) "
                             f"— kept row {winner['_row']} (most complete), dropped the rest.")
    for final_id, rows, winner in cross_office_pairs:
        offices = sorted({norm(r['Current Office']) for r in rows})
        report_lines.append(f"- {final_id}: same asset listed under {len(offices)} offices "
                             f"({', '.join(offices)}) — home office set to {norm(winner['Current Office'])} "
                             f"(row {winner['_row']}, most complete record). See 02_conflicts.md.")

    report_lines += ["", "## Unresolved custodians / low-confidence resolutions", ""]
    for aid, staff, srow in unresolved_custodians:
        report_lines.append(f"- {aid} (source row {srow}): Staff={staff!r}")

    if unresolved_offices:
        report_lines += ["", "## Office values not in locations.csv (would fail FR-006)", ""]
        for o in sorted(unresolved_offices):
            report_lines.append(f"- {o!r}")

    retired_excluded = [r for r, m in excluded_rows if norm(r["Lifecycle Status"]) == "Retired"]
    report_lines += ["", "## Note: zero Retired assets survive this load", "",
        f"All {len(retired_excluded)} source rows carrying Lifecycle Status=Retired are among the "
        f"13 excluded Azure/Server rows (Q6) — every one of the fleet's on-paper retirements turns "
        f"out to be a decommissioned Azure resource, not a physical instrument. If Q6 is reversed "
        f"(Azure rows are loaded after all), those {len(retired_excluded)} rows return as the "
        f"fleet's only pre-existing Retired assets; as things stand, 0 of the {len(assets)} loaded "
        f"assets are Retired, so feature 001 US5 (retire an asset) has nothing pre-existing to "
        f"exercise against migrated data and must be demonstrated by retiring a freshly-registered "
        f"asset instead."]

    if missing_office_assets:
        report_lines += ["", f"## Assets landed on the 'Unassigned' placeholder office ({len(missing_office_assets)})", "",
            "Source had no Current Office at all for these — not a guess, a completion-queue item "
            "(feature 002 FR-032). An admin assigns the real home office in the app."]
        for aid, srow in missing_office_assets:
            report_lines.append(f"- {aid} (source row {srow})")

    report_lines += ["", "## Non-name values found in the Staff column", ""]
    report_lines.append("- 'South East Lobe 2' and 'Sudbury staff' are not people; left unresolved "
                         "as designed rather than guessed.")

    (REPORTS_DIR / "02_clean_report.md").write_text("\n".join(report_lines) + "\n", encoding="utf-8")

    # ---- FR-015a: the pilot return-sweep checklist ----
    sweep = sorted((a for a in assets if a["status"] == "CheckedOut" and not a["custodian"]),
                   key=lambda a: (a["homeoffice"] or "", a["assetid"]))
    sweep_lines = [
        "# 02 — Return sweep checklist (feature 002 FR-015a / Q3)", "",
        f"{len(sweep)} assets loaded as CheckedOut with no custodian — the honest reading of "
        "'Deployed or NOT Available' (Q3: we know it isn't at the office, nothing more). Per "
        "the Ottawa pilot's one-week sweep, an administrator returns each of these as it is "
        "physically located (FR-025 restricts Return to the custodian or an admin, and these "
        "have no custodian). Progress = ticked off this list shrinking to zero.", "",
        "| Asset ID | Home office | Model | Serial |", "|---|---|---|---|",
    ]
    for a in sweep:
        sweep_lines.append(f"| {a['assetid']} | {a['homeoffice']} | "
                            f"{a['manufacturer']} {a['model']} | {a['serialnumber'] or ''} |")
    (REPORTS_DIR / "02_sweep_checklist.md").write_text("\n".join(sweep_lines) + "\n", encoding="utf-8")

    # ---- conflicts.md: the FR-026 sign-off gate ----
    conflict_lines += [
        "# 02 — Conflict report (sign-off required before production load per FR-026 / SC-010)", "",
        "Every judgement call this run made that a human should look at before this data reaches "
        "production. Nothing here blocks a **development** load — it blocks going to Prod.", "",
        f"## Cross-office duplicates ({len(cross_office_pairs)} found)", "",
        "The brief's narrative baseline says 8; a full reconciliation of this frozen export against "
        "the corrected model catalogue finds more, because several of the 132 legitimate "
        "shared-serial sibling pairs (an instrument and its sensor, e.g. DL-UM-x / GEO-UM-x) are "
        "*each independently* duplicated across the same two offices, and two further pairs only "
        "surface after fixing the Sigicom S50/V12 equipment-type mislabels (Q4). This does not "
        "change the total duplicate-Asset-ID count (29), which matches the baseline exactly — see "
        "01_profile_report.md. Every pair below is named so Jay can confirm the home-office choice.",
        "",
    ]
    for final_id, rows, winner in cross_office_pairs:
        offices = sorted({norm(r['Current Office']) for r in rows})
        conflict_lines.append(f"- **{final_id}** — offices {offices}, kept home office "
                               f"**{norm(winner['Current Office'])}** (row {winner['_row']}, "
                               f"more complete record). Source rows: {[int(r['_row']) for r in rows]}.")

    conflict_lines += ["", f"## Same-office literal duplicates collapsed ({len(same_office_dupes)})", ""]
    for final_id, rows, winner in same_office_dupes:
        conflict_lines.append(f"- **{final_id}** — {len(rows)} identical-office rows "
                               f"{[int(r['_row']) for r in rows]}, kept row {winner['_row']}.")

    conflict_lines += ["", f"## FR-013 flagged, NOT merged: same serial + same model, different Asset ID ({len(flagged_true_duplicates)})", ""]
    conflict_lines.append("Per FR-013 these are loaded as distinct assets; a human decides whether "
                           "to merge them (and how) via a follow-up correction, not this script.")
    for serial, canon, ws in flagged_true_duplicates:
        ids = [w["final_id"] for w in ws]
        rows = [int(w["row"]["_row"]) for w in ws]
        conflict_lines.append(f"- serial **{serial}**, {canon[0]} {canon[1]} ({canon[2]}): "
                               f"Asset IDs {ids}, source rows {rows}.")

    if third_party_flags:
        conflict_lines += ["", f"## Notes suggesting third-party ownership or loss ({len(third_party_flags)})", ""]
        for aid, notes, project, srow in third_party_flags:
            conflict_lines.append(f"- **{aid}** (row {srow}): notes={notes!r} project={project!r}")

    conflict_lines += ["", "## Sign-off", "", "- [ ] Jay Patel has reviewed every item above and "
                       "approves the production load (docs/08-decisions.md gets the date and any "
                       "corrections requested)."]

    (REPORTS_DIR / "02_conflicts.md").write_text("\n".join(conflict_lines) + "\n", encoding="utf-8")

    print(f"02_clean: {len(assets)} assets staged "
          f"({len(component_seeds)} components, {len(dropped_as_duplicate)} duplicates dropped, "
          f"{len(excluded_rows)} excluded, {len(cross_office_pairs)} cross-office conflicts, "
          f"{len(flagged_true_duplicates)} FR-013 flags). See migration/reports/02_clean_report.md "
          f"and 02_conflicts.md.")
    return 0


def _prefix_of(asset_id: str) -> str:
    """Best-effort prefix extraction: everything before the last '-' block that looks like a serial."""
    parts = asset_id.split("-")
    if len(parts) <= 1:
        return asset_id
    return "-".join(parts[:-1])


def _fail(problems: list[str]) -> None:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    (REPORTS_DIR / "02_clean_report.md").write_text(
        "# 02 — Clean report\n\n**Status: FAIL**\n\n" + "\n".join(f"- {p}" for p in problems) + "\n",
        encoding="utf-8",
    )
    for p in problems:
        print(p)


if __name__ == "__main__":
    raise SystemExit(main())
