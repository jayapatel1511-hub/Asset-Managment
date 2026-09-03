"""
Emit an arbitrary row range of one logical table as a single bulk_create_records payload.

bulk_create_records accepts 100 rows per call but not 150, so batches are 100. This lets
the range be chosen after the fact - e.g. when an earlier probe already loaded rows 0-200 -
without re-chunking every file.

  python emit.py <kind> <start> <count> [--out NAME]
  kind: locations_top | locations_children | projects | models | assets | asset_parents

Writes zite/load/out/<kind>_<start>_<count>.json and prints it, ready to paste.
"""
import json, os, sys, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")


def parts(kind):
    """Rebuild the full ordered row list for a kind by concatenating its batch files."""
    files = sorted(
        (f for f in os.listdir(OUT) if f.startswith(PREFIX[kind]) and f.endswith(".json")
         and ".resolved" not in f),
        key=lambda f: int("".join(c for c in f[len(PREFIX[kind]):-5] if c.isdigit()) or 0),
    )
    rows = []
    for f in files:
        with open(os.path.join(OUT, f), encoding="utf-8") as fh:
            rows.extend(json.load(fh))
    return rows


PREFIX = {
    "locations_top": "03_locations_top_",
    "locations_children": "04_locations_children",
    "projects": "05_projects_",
    "models": "06_models",
    "assets": "07_assets_",
    "asset_parents": "08_asset_parents",
}

if __name__ == "__main__":
    kind, start, count = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    rows = parts(kind)
    sl = rows[start:start + count]
    name = "%s_%d_%d.json" % (kind, start, len(sl))
    if "--out" in sys.argv:
        name = sys.argv[sys.argv.index("--out") + 1]
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(sl, f, ensure_ascii=False, separators=(",", ":"))
    sys.stderr.write("%s: rows %d..%d of %d -> %s\n"
                     % (kind, start, start + len(sl), len(rows), name))
    sys.stdout.write(json.dumps(sl, ensure_ascii=False, separators=(",", ":")))
