"""
Id-map helper for the Zite load.

Zite's linked_record fields take record UUIDs and validate them - a primary-field value
like "Acoustics" is rejected, so nothing is ever silently auto-created. That means every
child batch needs its parents' ids first, and this keeps them.

bulk_create_records returns recordIds IN INPUT ORDER, so ids can be zipped positionally
against the payload file that produced them - no read-back required for small tables.
For big ones (Locations, Projects) it is cheaper to pull just the needed names back with
one execute_sql and feed them in via "pairs".

Modes:
  python idmap.py record <Table> <payload.json> <key> <id,id,id...>
      zip ids positionally onto payload rows, keyed by <key> (a field name in the row)
  python idmap.py pairs <Table> <name=id> [<name=id> ...]
      record explicit name -> id pairs (paste from execute_sql)
  python idmap.py pairsjson <Table> <file.json>
      record from a JSON array of {"Name":..., "id":...} rows
  python idmap.py resolve <payload.json> <_key>:<Table>:<Field Name> [...] [--out FILE]
      replace name-reference keys with linked-record id arrays and emit loadable JSON
  python idmap.py show [Table]
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
MAP = os.path.join(OUT, "idmap.json")


def read_map():
    if not os.path.exists(MAP):
        return {}
    with open(MAP, encoding="utf-8") as f:
        return json.load(f)


def write_map(m):
    with open(MAP, "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False, indent=1, sort_keys=True)


def load_payload(path):
    p = path if os.path.isabs(path) else os.path.join(OUT, path)
    with open(p, encoding="utf-8") as f:
        return json.load(f), p


def cmd_record(table, payload, key, ids):
    rows, _ = load_payload(payload)
    ids = [i.strip() for i in ids.split(",") if i.strip()]
    if len(ids) != len(rows):
        sys.exit("REFUSED: %d ids for %d rows in %s - positional zip would be wrong"
                 % (len(ids), len(rows), payload))
    m = read_map()
    t = m.setdefault(table, {})
    for row, rid in zip(rows, ids):
        name = row[key]
        if name in t and t[name] != rid:
            sys.exit("REFUSED: %s %r already mapped to %s (now %s) - duplicate name"
                     % (table, name, t[name], rid))
        t[name] = rid
    write_map(m)
    print("%s: recorded %d ids (%d total)" % (table, len(ids), len(t)))


def cmd_pairs(table, pairs):
    m = read_map()
    t = m.setdefault(table, {})
    for p in pairs:
        name, _, rid = p.partition("=")
        t[name] = rid
    write_map(m)
    print("%s: %d total" % (table, len(t)))


def cmd_pairsjson(table, path):
    rows, _ = load_payload(path)
    m = read_map()
    t = m.setdefault(table, {})
    for r in rows:
        t[r["Name"] if "Name" in r else r["name"]] = r["id"]
    write_map(m)
    print("%s: %d total" % (table, len(t)))


def cmd_resolve(payload, specs, out):
    rows, path = load_payload(payload)
    m = read_map()
    parsed = []
    for s in specs:
        key, table, field = s.split(":", 2)
        parsed.append((key, table, field))
    missing = set()
    for row in rows:
        for key, table, field in parsed:
            if key not in row:
                continue
            name = row.pop(key)
            rid = m.get(table, {}).get(name)
            if rid is None:
                missing.add("%s/%s" % (table, name))
                continue
            row[field] = [rid]
    if missing:
        sys.exit("REFUSED: %d unresolved references, e.g. %s"
                 % (len(missing), sorted(missing)[:5]))
    leftover = {k for row in rows for k in row if k.startswith("_")}
    if leftover:
        sys.exit("REFUSED: unhandled name-reference keys remain: %s" % sorted(leftover))
    dest = out or path.replace(".json", ".resolved.json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
    print("%s: %d rows -> %s (%d bytes)" % (payload, len(rows), os.path.basename(dest),
                                            os.path.getsize(dest)))


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    if a[0] == "record":
        cmd_record(a[1], a[2], a[3], a[4])
    elif a[0] == "pairs":
        cmd_pairs(a[1], a[2:])
    elif a[0] == "pairsjson":
        cmd_pairsjson(a[1], a[2])
    elif a[0] == "resolve":
        out = None
        rest = a[2:]
        if "--out" in rest:
            i = rest.index("--out")
            out = os.path.join(OUT, rest[i + 1])
            rest = rest[:i] + rest[i + 2:]
        cmd_resolve(a[1], rest, out)
    elif a[0] == "show":
        m = read_map()
        if len(a) > 1:
            print(json.dumps(m.get(a[1], {}), indent=1, ensure_ascii=False))
        else:
            print({k: len(v) for k, v in m.items()})
    else:
        sys.exit(__doc__)
