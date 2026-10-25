#!/usr/bin/env python3
"""Data til analyseappen: én kompakt rad per hendelse + oppslagstabeller, eksempler og kartgrenser.

Bruk (etter build_db.py og geocode.py):
    python3 scripts/build_app_data.py [--db politiloggen.db] [--out app.json]

Hver hendelse pakkes som 24 tegn base64 i feltet "rec", slik at appen kan filtrere fritt på
område, periode og klasse i nettleseren. Feltrekkefølge og bredder står i REC_FIELDS.
Grenser hentes fra Kartverket (kommuneinfo) og forenkles med Douglas–Peucker.
"""

import argparse
import json
import re
import sqlite3
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

KOMMUNEINFO = "https://api.kartverket.no/kommuneinfo/v1"
SSB_POPULATION = "https://data.ssb.no/api/v0/no/table/07459"
OSLO = ZoneInfo("Europe/Oslo")
B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

# (felt, antall tegn) – 6 bit per tegn
REC_FIELDS = [("month", 1), ("hourOfWeek", 2), ("district", 1), ("muni", 2), ("category", 1), ("tops", 2),
              ("subs", 5), ("outcomes", 1), ("persons", 3), ("area", 3), ("areaType", 1), ("bydel", 1), ("weapon", 1)]
AREA_TYPES = ["mangler", "strøk", "sentrum", "gate", "vei", "kollektiv", "virksomhet", "natur", "kommune"]
OUTCOMES = ["pågrepet", "anmeldt", "innbrakt", "bortvist", "førerkortbeslag", "forelegg"]
GENDER = {"mann": 0, "gutt": 0, "kvinne": 1, "jente": 1}
AGES = ["10-årene", "20-årene", "30-årene", "40-årene", "50-årene", "60-årene", "70-årene", "80-årene"]


def enc(value: int, width: int) -> str:
    assert 0 <= value < 64 ** width, (value, width)
    return "".join(B64[(value >> (6 * (width - 1 - i))) & 63] for i in range(width))


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


def population() -> tuple[dict, dict, str]:
    """Folketall per kommune (siste år) fra SSB, nøklet på kommunenummer og på normalisert navn.

    Politiloggen bruker delvis kommunenumre fra før 2024; da faller oppslaget tilbake på navn."""
    body = json.dumps({"query": [
        {"code": "Region", "selection": {"filter": "all", "values": ["*"]}},
        {"code": "ContentsCode", "selection": {"filter": "item", "values": ["Personer1"]}},
        {"code": "Tid", "selection": {"filter": "top", "values": ["1"]}}],
        "response": {"format": "json-stat2"}}).encode()
    req = urllib.request.Request(SSB_POPULATION, data=body, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.load(r)
    cat, values = d["dimension"]["Region"]["category"], d["value"]
    year = next(iter(d["dimension"]["Tid"]["category"]["label"].values()))
    pop, by_code = {}, {}
    for code, i in cat["index"].items():
        if len(code) != 4 or not values[i]:
            continue
        by_code[code] = values[i]
        # "Guovdageaidnu - Kautokeino", "Herøy (Nordland)", "Drammen (2020-2023)": alle navnevarianter blir nøkler
        label = re.sub(r"\s*\(\d{4}-\d{4}\)$", "", cat["label"][code]).lower()
        names = {label, re.sub(r"\s*\(.*\)$", "", label)} | {part.strip() for part in re.sub(r"\s*\(.*\)$", "", label).split(" - ")}
        for name in names:
            pop[name] = max(pop.get(name, 0), values[i])
    return by_code, pop, year


def boundaries(q, n_kommuner: int):
    print("Henter grenser …")
    fylker = []
    for f in fetch("/fylker"):
        g = fetch(f"/fylker/{f['fylkesnummer']}/omrade")["omrade"]
        fylker.append({"name": f["fylkesnavn"], "rings": rings(g, 0.004, 3)})
    # Kommunenumrene i Politiloggen er delvis fra før 2024, så grensene slås opp på navn.
    current = {k["kommunenavnNorsk"].lower(): k["kommunenummer"] for k in fetch("/kommuner")}
    kommuner = []
    for mid, name, _ in q("""SELECT i.municipality_id, m.name, COUNT(*) FROM incident i
                             JOIN dim_municipality m USING (municipality_id) GROUP BY 1 ORDER BY 3 DESC LIMIT ?""", n_kommuner):
        nr = current.get(name.lower())
        if not nr:
            continue
        bbox = fetch(f"/kommuner/{nr}")["avgrensningsboks"]["coordinates"][0]
        g = fetch(f"/kommuner/{nr}/omrade")["omrade"]
        kommuner.append({"id": mid, "name": name, "rings": rings(g, 0.0015, 4),
                         "bbox": [min(p[0] for p in bbox), min(p[1] for p in bbox), max(p[0] for p in bbox), max(p[1] for p in bbox)]})
    return fylker, kommuner


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default="politiloggen.db")
    ap.add_argument("--out", default="app.json")
    ap.add_argument("--kommuner", type=int, default=24, help="Antall kommuner (etter volum) som får egne grenser")
    ap.add_argument("--basemap", help="basemap.json fra build_basemap.py (innebygde kartfliser)")
    ap.add_argument("--bydel-geo", default="prototype/data/bydeler.json", help="Bydelsgrenser fra fetch_bydel_geo.py")
    args = ap.parse_args()
    con = sqlite3.connect(args.db)
    q = lambda sql, *a: con.execute(sql, a).fetchall()
    local = lambda iso: datetime.fromisoformat(iso[:19] + "+00:00").astimezone(OSLO)

    tax = {c: (p, n) for c, p, n in q("SELECT code, parent_code, name FROM dim_taxonomy ORDER BY rowid")}
    tops = [c for c, (p, _) in tax.items() if not p]
    subs = [c for c, (p, _) in tax.items() if p]
    districts = dict(q("SELECT district_id, name FROM dim_district ORDER BY district_id"))
    d_idx = {d: i for i, d in enumerate(districts)}
    munis = q("""SELECT m.municipality_id, m.name, m.district_id, COUNT(i.thread_id) FROM dim_municipality m
                 LEFT JOIN incident i USING (municipality_id) GROUP BY 1 ORDER BY 4 DESC, 2""")
    m_idx = {m[0]: i + 1 for i, m in enumerate(munis)}  # 0 = ukjent
    pop_code, pop_name, pop_year = population()
    pop_of = lambda mid, name: pop_code.get(mid) or pop_name.get(name.lower()) or pop_name.get(re.sub(r" herad$", "", name.lower()))
    categories = sorted({c for (c,) in q("SELECT DISTINCT category FROM incident")})
    c_idx = {c: i for i, c in enumerate(categories)}
    category_names = ["Ukjent kategori" if re.fullmatch(r"[0-9a-f-]{36}", c) else c for c in categories]

    # Områder: alle som er geokodet eller har minst 2 hendelser får en indeks (0 = ingen/øvrige).
    area_rows = q("""SELECT a.municipality_id, a.area_key, a.name, a.area_type, a.bydel, g.lat, g.lon, COUNT(i.thread_id) n
                     FROM dim_area a JOIN incident i USING (municipality_id, area_key)
                     LEFT JOIN geo_area g USING (municipality_id, area_key)
                     GROUP BY 1, 2 HAVING n >= 2 OR g.lat IS NOT NULL ORDER BY n DESC""")
    a_idx = {(r[0], r[1]): i + 1 for i, r in enumerate(area_rows)}
    area_type_of = {(m, k): t for m, k, t in q("SELECT municipality_id, area_key, area_type FROM dim_area")}
    bydel_of = {(m, k): b for m, k, b in q("SELECT municipality_id, area_key, bydel FROM dim_area WHERE bydel IS NOT NULL")}
    bydeler = sorted({(m, b) for (m, _), b in bydel_of.items()})
    b_idx = {mb: i + 1 for i, mb in enumerate(bydeler)}
    weapons = [w for (w,) in q("SELECT DISTINCT weapon FROM incident_class WHERE weapon IS NOT NULL ORDER BY 1")]
    w_idx = {w: i + 1 for i, w in enumerate(weapons)}

    classes = defaultdict(list)
    for tid, code, weapon, outcome, persons in q(
            "SELECT thread_id, taxonomy_code, weapon, outcome, persons FROM incident_class"):
        classes[tid].append((code, weapon, json.loads(outcome), json.loads(persons)))

    rows = q("SELECT thread_id, district_id, municipality_id, category, area_key, created_on FROM incident ORDER BY created_on")
    months = sorted({local(r[5]).strftime("%Y-%m") for r in rows})
    mo_idx = {m: i for i, m in enumerate(months)}
    rec = []
    for tid, did, mid, cat, akey, created in rows:
        dt = local(created)
        cl = classes[tid]
        top_mask = sub_mask = 0
        for code, *_ in cl:
            parent = tax[code][0]
            top_mask |= 1 << tops.index(parent or code)
            if parent:
                sub_mask |= 1 << subs.index(code)
        _, weapon, outcome, persons = cl[0]
        out_mask = sum(1 << OUTCOMES.index(o) for o in outcome if o in OUTCOMES)
        pcode, n = 0, 0
        for p in persons:
            if p["kjønn"] in GENDER and p["alder"] in AGES and n < 3:
                pcode = pcode * 32 + 1 + GENDER[p["kjønn"]] * 8 + AGES.index(p["alder"])
                n += 1
        values = {"month": mo_idx[dt.strftime("%Y-%m")], "hourOfWeek": dt.weekday() * 24 + dt.hour,
                  "district": d_idx[did], "muni": m_idx.get(mid, 0), "category": c_idx[cat], "tops": top_mask,
                  "subs": sub_mask, "outcomes": out_mask, "persons": pcode, "area": a_idx.get((mid, akey), 0),
                  "areaType": AREA_TYPES.index(area_type_of.get((mid, akey), "mangler")),
                  "bydel": b_idx.get((mid, bydel_of.get((mid, akey))), 0), "weapon": w_idx.get(weapon, 0)}
        rec.append("".join(enc(values[f], w) for f, w in REC_FIELDS))

    # Siste hendelser: generelt + per stor kommune, så hendelseslisten har innhold uansett valgt område.
    sample_ids = [t for (t,) in q("SELECT thread_id FROM incident ORDER BY created_on DESC LIMIT 300")]
    for m in munis[:24]:
        sample_ids += [t for (t,) in q("""SELECT thread_id FROM incident WHERE municipality_id = ?
                                          ORDER BY created_on DESC LIMIT 80""", m[0])]
    # De nyeste hendelsene for hvert av de 150 mest omtalte stedene, så et valgt sted (f.eks. Grønland) har innhold
    for r in area_rows[:150]:
        sample_ids += [t for (t,) in q("""SELECT thread_id FROM incident WHERE municipality_id = ? AND area_key = ?
                                          ORDER BY created_on DESC LIMIT 12""", r[0], r[1])]
    samples = []
    for tid in dict.fromkeys(sample_ids):
        (cat, mid, did, akey, area, created, n, active, first, last), = q("""
            SELECT category, municipality_id, district_id, area_key, area, created_on, message_count, is_active,
                   (SELECT text FROM message m WHERE m.thread_id = i.thread_id ORDER BY created_on LIMIT 1),
                   (SELECT text FROM message m WHERE m.thread_id = i.thread_id ORDER BY created_on DESC LIMIT 1)
            FROM incident i WHERE thread_id = ?""", tid)
        clip = lambda t: t if len(t) <= 500 else t[:497] + "…"
        cl = classes[tid]
        samples.append({"id": tid, "category": cat, "municipality": next((x[1] for x in munis if x[0] == mid), ""),
                        "area": area, "created": created[:19] + "Z", "messages": n, "active": bool(active),
                        "text": clip(first), "update": clip(last) if n > 1 and last != first else None, "classes": [c[0] for c in cl],
                        "weapon": cl[0][1], "outcome": cl[0][2], "persons": cl[0][3],
                        "d": d_idx[did], "k": m_idx.get(mid, 0), "b": b_idx.get((mid, bydel_of.get((mid, akey))), 0), "a": a_idx.get((mid, akey), 0)})
    samples.sort(key=lambda s: s["created"], reverse=True)

    # Eksempler på vask: per stor kommune, nøkler med flest ulike skrivemåter.
    variants = {}
    for m in munis[:24]:
        keys = q("""SELECT area_key, COUNT(DISTINCT area) v FROM incident WHERE municipality_id = ? AND area_key IS NOT NULL
                    GROUP BY 1 HAVING v > 1 ORDER BY COUNT(*) DESC LIMIT 6""", m[0])
        variants[m[0]] = [[k, [r for (r,) in q("""SELECT area FROM incident WHERE municipality_id = ? AND area_key = ?
                                                   GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 8""", m[0], k)]] for k, _ in keys]

    counts = {t: q(f"SELECT COUNT(*) FROM {t}")[0][0] for t in
              ["incident", "message", "message_version", "incident_class", "dim_taxonomy", "dim_district",
               "dim_municipality", "dim_area", "geo_area"]}
    example = {
        "incident": q("SELECT * FROM incident WHERE message_count > 2 ORDER BY created_on DESC LIMIT 1"),
        "message": q("""SELECT message_id, thread_id, seq, substr(text,1,80), has_image, is_edited, is_removed,
                               created_on, updated_on, content_hash FROM message ORDER BY created_on DESC LIMIT 2"""),
        "incident_class": q("SELECT * FROM incident_class WHERE weapon IS NOT NULL ORDER BY classified_at DESC LIMIT 2"),
        "dim_area": q("SELECT * FROM dim_area WHERE municipality_id = '0301' AND area_key IN ('grønland', 'storgata', 'oslo s')"),
        "geo_area": q("SELECT * FROM geo_area WHERE municipality_id = '0301' AND area_key IN ('grønland', 'storgata', 'oslo s')"),
    }
    fylker, kommuner = boundaries(q, args.kommuner)

    out = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "span": q("SELECT MIN(created_on), MAX(created_on) FROM incident")[0],
        "classifier": "regex-v1", "areaClassifier": "area-v1",
        "recFields": REC_FIELDS, "rec": "".join(rec),
        "months": months, "tops": tops, "subs": subs,
        "taxonomy": {c: {"parent": p, "name": n} for c, (p, n) in tax.items()},
        "districts": [[d, n] for d, n in districts.items()],
        "munis": [[m, n, d, c, pop_of(m, n)] for m, n, d, c in munis],
        "populationYear": pop_year,
        "categories": category_names, "areaTypes": AREA_TYPES, "outcomes": OUTCOMES, "ages": AGES,
        "weapons": weapons,
        "bydeler": [[m, b] for m, b in bydeler],
        "areas": [[r[2], r[3], r[4], r[5] and round(r[5], 5), r[6] and round(r[6], 5), m_idx.get(r[0], 0), r[1], r[7]] for r in area_rows],
        "distinctAreas": {"raw": q("SELECT COUNT(DISTINCT area) FROM incident")[0][0], "keys": counts["dim_area"]},
        "samples": samples, "variants": variants, "counts": counts,
        "example": {k: [list(r) for r in v] for k, v in example.items()},
        "fylker": fylker, "kommuner": kommuner,
    }
    if args.basemap:
        with open(args.basemap, encoding="utf-8") as f:
            out["basemap"] = json.load(f)
    try:
        with open(args.bydel_geo, encoding="utf-8") as f:
            out["bydelGeo"] = json.load(f)
    except FileNotFoundError:
        out["bydelGeo"] = {}
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(rec):,} hendelser, {len(area_rows):,} områder, {len(samples):,} eksempler -> {args.out}")


if __name__ == "__main__":
    main()
