#!/usr/bin/env python3
"""Kartdata til heatmap: geokodede områder med antall per periode og klasse, pluss forenklede grenser.

Bruk (etter build_db.py og geocode.py):
    python3 scripts/build_map.py [--db politiloggen.db] [--out map.json]

Grenser hentes fra Kartverket (kommuneinfo) og forenkles med Douglas–Peucker.
"""

import argparse
import json
import sqlite3
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

KOMMUNEINFO = "https://api.kartverket.no/kommuneinfo/v1"
OSLO = ZoneInfo("Europe/Oslo")


def fetch(path: str):
    with urllib.request.urlopen(f"{KOMMUNEINFO}{path}", timeout=60) as r:
        return json.load(r)


def simplify(points: list, tol: float) -> list:
    """Douglas–Peucker uten rekursjon."""
    if len(points) < 4:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = points[a], points[b]
        dx, dy = x2 - x1, y2 - y1
        norm = (dx * dx + dy * dy) ** 0.5 or 1e-12
        best, idx = 0.0, None
        for i in range(a + 1, b):
            x, y = points[i]
            d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / norm
            if d > best:
                best, idx = d, i
        if idx is not None and best > tol:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(points, keep) if k]


def rings(geom: dict, tol: float, digits: int, min_points: int = 4) -> list:
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    out = []
    for poly in polys:
        outer = poly[0]  # bare ytre ring; holl er uten betydning her
        mid = len(outer) // 2  # lukket ring: forenkle to halvdeler, ellers faller alt bort
        ring = simplify(outer[:mid + 1], tol) + simplify(outer[mid:], tol)[1:]
        if len(ring) >= min_points:
            out.append([[round(x, digits), round(y, digits)] for x, y in ring])
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default="politiloggen.db")
    ap.add_argument("--out", default="map.json")
    ap.add_argument("--kommuner", type=int, default=16, help="Antall kommuner (etter volum) som får egne grenser")
    args = ap.parse_args()
    con = sqlite3.connect(args.db)
    q = lambda sql, *a: con.execute(sql, a).fetchall()

    # Perioder relativt til siste måned i datasettet (som er ufullstendig).
    last = q("SELECT MAX(created_on) FROM incident")[0][0]
    last_dt = datetime.fromisoformat(last[:19] + "+00:00").astimezone(OSLO)
    end_y, end_m = (last_dt.year, last_dt.month - 1) if last_dt.month > 1 else (last_dt.year - 1, 12)
    start_y, start_m = (end_y - 1, end_m + 1) if end_m < 12 else (end_y, 1)
    p12 = (f"{start_y}-{start_m:02d}", f"{end_y}-{end_m:02d}")
    periods = ["12m", "2025", "2024", "alle"]

    def period_ids(month: str):
        ids = [3]
        if p12[0] <= month <= p12[1]:
            ids.append(0)
        if month.startswith("2025"):
            ids.append(1)
        if month.startswith("2024"):
            ids.append(2)
        return ids

    tax = {c: p or c for c, p in q("SELECT code, parent_code FROM dim_taxonomy")}
    tops = sorted({t for t in tax.values()})
    top_idx = {t: i for i, t in enumerate(tops)}
    tops_of = defaultdict(set)
    for tid, code in q("SELECT thread_id, taxonomy_code FROM incident_class"):
        tops_of[tid].add(tax[code])

    geo = {(m, k): (lat, lon, mn) for m, k, lat, lon, mn in
           q("SELECT municipality_id, area_key, lat, lon, matched_name FROM geo_area WHERE lat IS NOT NULL")}
    meta = {(m, k): (n, t, b) for m, k, n, t, b in q("SELECT municipality_id, area_key, name, area_type, bydel FROM dim_area")}
    muni_names = dict(q("SELECT municipality_id, name FROM dim_municipality"))

    pidx, points, cube = {}, [], Counter()
    located = Counter()
    for tid, mid, akey, created in q("SELECT thread_id, municipality_id, area_key, created_on FROM incident"):
        month = datetime.fromisoformat(created[:19] + "+00:00").astimezone(OSLO).strftime("%Y-%m")
        hit = geo.get((mid, akey))
        for p in period_ids(month):
            located[(p, bool(hit))] += 1
        if not hit:
            continue
        if (mid, akey) not in pidx:
            name, atype, bydel = meta[(mid, akey)]
            pidx[(mid, akey)] = len(points)
            points.append([round(hit[0], 5), round(hit[1], 5), name, atype, bydel, mid])
        i = pidx[(mid, akey)]
        for p in period_ids(month):
            cube[(i, p, len(tops))] += 1  # alle klasser
            for t in tops_of[tid]:
                cube[(i, p, top_idx[t])] += 1

    # Grenser: fylker (grovt) + de største kommunene (finere), slått opp på navn siden kommunenumre er endret.
    print("Henter grenser …")
    fylker = []
    for f in fetch("/fylker"):
        g = fetch(f"/fylker/{f['fylkesnummer']}/omrade")["omrade"]
        fylker.append({"name": f["fylkesnavn"], "rings": rings(g, 0.004, 3)})
    current = {k["kommunenavnNorsk"].lower(): k["kommunenummer"] for k in fetch("/kommuner")}
    kommuner = []
    for mid, name, _ in q("""SELECT i.municipality_id, m.name, COUNT(*) FROM incident i
                             JOIN dim_municipality m USING (municipality_id) GROUP BY 1 ORDER BY 3 DESC LIMIT ?""", args.kommuner):
        nr = current.get(name.lower())
        if not nr:
            continue
        info = fetch(f"/kommuner/{nr}")
        g = fetch(f"/kommuner/{nr}/omrade")["omrade"]
        bbox = info["avgrensningsboks"]["coordinates"][0]
        kommuner.append({"id": mid, "name": name, "rings": rings(g, 0.0015, 4),
                         "bbox": [min(p[0] for p in bbox), min(p[1] for p in bbox), max(p[0] for p in bbox), max(p[1] for p in bbox)]})

    out = {
        "periods": periods, "period12m": p12, "tops": tops + ["*"],
        "points": points,
        "munis": {p[5]: muni_names.get(p[5], "") for p in points},
        "cube": [[i, p, t, v] for (i, p, t), v in cube.items()],
        "coverage": {periods[p]: {"located": located[(p, True)], "total": located[(p, True)] + located[(p, False)]} for p in range(4)},
        "fylker": fylker, "kommuner": kommuner,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(points):,} punkter, {len(out['cube']):,} celler, {len(kommuner)} kommunegrenser -> {args.out}")


if __name__ == "__main__":
    main()
