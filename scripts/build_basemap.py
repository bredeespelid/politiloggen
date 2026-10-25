#!/usr/bin/env python3
"""Bakgrunnskart til byene i analyseappen: Kartverkets grå topografiske fliser, komprimert og innebygd.

Bruk (etter build_db.py og geocode.py):
    python3 scripts/build_basemap.py [--db politiloggen.db] [--out basemap.json] [--cities 8]

Artifact-sider kan ikke hente bilder fra andre verter, så fliser for utsnittet rundt hendelsene i hver by
lastes ned her, gjøres om til gråtone-WebP og legges i JSON som base64. Appen viser dem med et eget
Leaflet-lag. Kartdata: © Kartverket (CC BY 4.0).
"""

import argparse
import base64
import io
import json
import math
import sqlite3
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

TILE_URL = "https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png"
# Zoomnivå -> maks antall fliser per by. Fliser velges etter hvor mange hendelser som ligger i dem (tettest først),
# og alle overliggende fliser tas alltid med, slik at kartet aldri får hull når appen forstørrer en lavere flis.
LEVELS = {10: 6, 11: 14, 12: 26, 13: 40, 14: 28}
MIN_SHARE = 0.003  # en flis må ha minst 0,3 % av byens hendelser
MAX_ZOOM = {"0301": 14, "4601": 14}  # Oslo og Bergen får høyest oppløsning; øvrige byer stopper på 13 (og 12 etter rang 5)


def tile_xy(lat: float, lon: float, z: int) -> tuple[int, int]:
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def percentile(values: list, q: float) -> float:
    values = sorted(values)
    return values[min(len(values) - 1, int(len(values) * q))]


def fetch_tile(z: int, x: int, y: int, quality: int) -> str | None:
    url = TILE_URL.format(z=z, x=x, y=y)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                img = Image.open(io.BytesIO(r.read())).convert("L")
            break
        except Exception:
            if attempt == 2:
                return None
    # Færre gråtoner komprimerer bedre uten å skade lesbarheten
    img = img.point(lambda v: (v // 12) * 12 + 6)
    out = io.BytesIO()
    img.convert("RGB").save(out, "WEBP", quality=quality, method=6)
    return base64.b64encode(out.getvalue()).decode()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default="politiloggen.db")
    ap.add_argument("--out", default="basemap.json")
    ap.add_argument("--cities", type=int, default=8)
    ap.add_argument("--quality", type=int, default=38)
    args = ap.parse_args()
    con = sqlite3.connect(args.db)

    cities = con.execute("""
        SELECT i.municipality_id, m.name, COUNT(*) n FROM incident i JOIN dim_municipality m USING (municipality_id)
        GROUP BY 1 ORDER BY n DESC LIMIT ?""", (args.cities,)).fetchall()

    tiles, meta, wanted = {}, [], {}
    for rank, (mid, name, _) in enumerate(cities):
        pts = con.execute("""
            SELECT g.lat, g.lon, COUNT(*) FROM incident i JOIN geo_area g USING (municipality_id, area_key)
            WHERE i.municipality_id = ? AND g.lat IS NOT NULL GROUP BY 1, 2""", (mid,)).fetchall()
        total = sum(p[2] for p in pts)
        if total < 30:
            continue
        top_zoom = MAX_ZOOM.get(mid, 13 if rank < 5 else 12)
        chosen = {}
        for z, cap in LEVELS.items():
            if z > top_zoom:
                continue
            counts = {}
            for lat, lon, n in pts:
                k = tile_xy(lat, lon, z)
                counts[k] = counts.get(k, 0) + n
            best = sorted(counts.items(), key=lambda kv: -kv[1])[:cap]
            for (x, y), n in best:
                if n / total >= MIN_SHARE:
                    chosen[(z, x, y)] = True
        # Overliggende fliser ned til zoom 10 (forstørres når en finere flis mangler)
        for (z, x, y) in list(chosen):
            for d in range(1, z - 9):
                chosen[(z - d, x >> d, y >> d)] = True
        zooms = sorted({z for z, _, _ in chosen})
        for k in chosen:
            wanted.setdefault(k, name)
        lats = sorted(p[0] for p in pts for _ in range(min(p[2], 20)))
        lons = sorted(p[1] for p in pts for _ in range(min(p[2], 20)))
        s_, n_ = lats[int(len(lats) * .03)], lats[int(len(lats) * .97)]
        w_, e_ = lons[int(len(lons) * .03)], lons[int(len(lons) * .97)]
        meta.append({"id": mid, "name": name, "bounds": [round(s_, 4), round(w_, 4), round(n_, 4), round(e_, 4)], "zooms": zooms})
        print(f"{name}: zoom {zooms}, {sum(1 for k in chosen)} fliser")

    print(f"Henter {len(wanted)} fliser …")
    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(lambda k: (k, fetch_tile(*k, args.quality)), wanted))
    total = 0
    for (z, x, y), b64 in results:
        if b64:
            tiles[f"{z}/{x}/{y}"] = b64
            total += len(b64)
    print(f"{len(tiles)} av {len(wanted)} fliser, {total / 1e6:.2f} MB base64")
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"attribution": "© Kartverket", "cities": meta, "tiles": tiles}, f, separators=(",", ":"))


if __name__ == "__main__":
    main()
