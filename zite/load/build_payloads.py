"""
Build bulk_create_records payloads for the "Englobe AMS - Zite test" database.

Reads migration/synthetic/demo/ (371 fictional assets, seed englobe-ams-007) and emits
JSON batches under zite/load/out/. Read-only against migration/; writes only under zite/.

NEVER point this at migration/staged/ - those are real Englobe assets. The guard below
refuses any dataset whose manifest is not the verified synthetic demo profile.

Three fields present in the source are deliberately DROPPED and have no column in the
target: identifiervalue (ICCID), phonenumber, staticip. 74 of the 371 rows carry them.
See docs/18-hosting-alternatives.md section 7a.
"""
import json, os, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC = os.path.join(ROOT, "migration", "synthetic", "demo")
OUT = os.path.join(HERE, "out")

REQUIRED_SEED = "englobe-ams-007"
REQUIRED_PROFILE = "demo"


def load(name):
    with open(os.path.join(SRC, name), encoding="utf-8") as f:
        return json.load(f)


def guard():
    m = load("manifest.json")
    if m.get("seed") != REQUIRED_SEED or m.get("profile") != REQUIRED_PROFILE:
        sys.exit("REFUSED: not the synthetic demo profile (%s/%s)" % (m.get("seed"), m.get("profile")))
    if m.get("verified") is not True:
        sys.exit("REFUSED: manifest.verified is not true (feature 007 FR-056)")
    print("dataset ok: seed=%s profile=%s asOf=%s" % (m["seed"], m["profile"], m["asOf"]))
    return m


def demojibake(s):
    # The generator wrote UTF-8 bytes that had already been decoded as cp1252, so em
    # dashes arrive mangled. Round-trip them back; clean strings pass through untouched.
    if not isinstance(s, str):
        return s
    try:
        return s.encode("cp1252").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s


def write(name, rows):
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
    print("  %s: %d rows -> %d bytes" % (name, len(rows), os.path.getsize(path)))


def chunk(rows, n):
    return [rows[i:i + n] for i in range(0, len(rows), n)]


guard()
os.makedirs(OUT, exist_ok=True)
assets = load("assets.json")
locations = load("locations.json")
models = load("equipment_models.json")
projects = load("projects.json")

# --- Categories -----------------------------------------------------------------------
# One hierarchical table (docs/17 section F, approved by Jay 2026-09-03): roots = the 8
# asset groups, leaves = the 18 equipment types, one lookup from Equipment Models to the leaf.
#
# The demo data has 20 distinct (group, type) pairs but only 18 distinct type NAMES:
# "Microphone" and "SoundLevelMeter" each appear under both Acoustics and Seismographs.
# A tree whose leaves are unique by name cannot hold that, so each contested leaf is
# assigned to the group holding the MOST OF ITS ASSETS (minimum distortion), ties broken
# by model count then group name. The cost is printed below and recorded in docs/08.
model_key = lambda m: (m["manufacturer"], m["model"], m["equipmenttype"])
by_model = {model_key(m): m for m in models}
assets_per_pair = collections.Counter()
models_per_pair = collections.Counter()
for m in models:
    models_per_pair[(m["assetgroup"], m["equipmenttype"])] += 1
for a in assets:
    m = by_model[model_key(a["equipmentmodel"])]
    assets_per_pair[(m["assetgroup"], m["equipmenttype"])] += 1

groups_of = lambda t: sorted({m["assetgroup"] for m in models if m["equipmenttype"] == t})
leaf_parent = {}
for etype in sorted({m["equipmenttype"] for m in models}):
    leaf_parent[etype] = max(
        groups_of(etype),
        key=lambda g: (assets_per_pair[(g, etype)], models_per_pair[(g, etype)], g),
    )

moved_assets = moved_models = 0
for t in sorted(leaf_parent):
    gs = groups_of(t)
    if len(gs) > 1:
        for g in gs:
            if g != leaf_parent[t]:
                moved_assets += assets_per_pair[(g, t)]
                moved_models += models_per_pair[(g, t)]
        print("  contested leaf %r: %s -> parent %r" % (t, gs, leaf_parent[t]))
print("  category collision cost: %d assets, %d models roll up under a different root "
      "than the flat assetgroup column" % (moved_assets, moved_models))

roots = sorted({m["assetgroup"] for m in models})
write("01_categories_roots.json",
      [{"Name": g, "Active": True, "Sort Order": (i + 1) * 10} for i, g in enumerate(roots)])
write("02_categories_leaves.json",
      [{"Name": t, "Active": True, "Sort Order": (i + 1) * 10, "_parent": leaf_parent[t]}
       for i, t in enumerate(sorted(leaf_parent))])

# --- Locations ------------------------------------------------------------------------
# Depth is at most 1: Ontario (Region) parents the 10 Offices and 1 Storage; Sites and the
# CalLab are roots. Two passes so a parent always exists before its children link to it.
def loc_row(l):
    r = {"Name": l["name"], "Location Type": l["locationtype"], "Active": bool(l["isactive"])}
    if l["note"]:
        r["Note"] = l["note"]
    return r


tops = [loc_row(l) for l in locations if not l["parentlocation"]]
kids = [dict(loc_row(l), _parent=l["parentlocation"]) for l in locations if l["parentlocation"]]
for i, b in enumerate(chunk(tops, 50), 1):
    write("03_locations_top_%d.json" % i, b)
write("04_locations_children.json", kids)

# --- Projects -------------------------------------------------------------------------
project_rows = [{"Project Number": p["projectnumber"], "Project Name": demojibake(p["name"]),
                 "Status": p["status"], "_office": p["office"]} for p in projects]
for i, b in enumerate(chunk(project_rows, 50), 1):
    write("05_projects_%d.json" % i, b)

# --- Equipment Models -----------------------------------------------------------------
# Reservable defaults No and is seeded Yes for the Vehicles group only (docs/01,
# eng_isreservable). The demo profile has no Vehicles group, so every model here is False.
write("06_models.json", [{
    "Name": m["name"], "Manufacturer": m["manufacturer"], "Model": m["model"],
    "ID Prefix": m["idprefix"], "Serialised": bool(m["isserialised"]),
    "Identifier Type": m["identifiertype"],
    "Default Cal Interval Months": m["defaultcalintervalmonths"],
    "Reservable": False, "_category": m["equipmenttype"],
} for m in models])
# Equipment-model NAME is not unique - "Instantel Micromate" is three different models
# (DataLogger / Geophone / Microphone), which is correct: docs/01 makes the alternate key
# manufacturer + model + category. So the id map is keyed on that composite instead, in
# the same row order as 06_models.json.
write("06_models_keys.json",
      [{"Key": "%s|%s|%s" % model_key(m)} for m in models])

# --- Assets ---------------------------------------------------------------------------
# ICCID / phone number / static IP are dropped here and have no target column at all.
dropped = sum(1 for a in assets if a["identifiervalue"] or a["phonenumber"] or a["staticip"])
print("  dropping ICCID/phone/static IP from %d rows - no column exists for them" % dropped)
rows, parents = [], []
for a in assets:
    r = {"Asset ID": a["assetid"], "Lifecycle": a["lifecycle"], "Status": a["status"],
         "Data Origin": a["migrationsource"],
         "_model": "%s|%s|%s" % model_key(a["equipmentmodel"])}
    for src, dst in (("serialnumber", "Serial Number"), ("custodian", "Custodian"),
                     ("lastcaldate", "Last Cal Date"), ("nextcaldue", "Next Cal Due"),
                     ("carrier", "Carrier"), ("retirementreason", "Retirement Reason"),
                     ("notes", "Notes")):
        if a[src]:
            r[dst] = a[src]
    for src, key in (("homeoffice", "_homeoffice"), ("currentlocation", "_currentlocation"),
                     ("currentproject", "_currentproject")):
        if a[src]:
            r[key] = a[src]
    # Parent Asset is a self-link, so it cannot be set on the create pass - the parent row
    # does not exist yet. It is applied afterwards from 08_asset_parents.json.
    if a["parentasset"]:
        parents.append({"Asset ID": a["assetid"], "_parentasset": a["parentasset"]})
    rows.append(r)
for i, b in enumerate(chunk(rows, 50), 1):
    write("07_assets_%d.json" % i, b)
write("08_asset_parents.json", parents)

print("\nexpected counts: 8 roots, 18 leaves, %d locations, %d projects, %d models, %d assets"
      % (len(locations), len(projects), len(models), len(assets)))
