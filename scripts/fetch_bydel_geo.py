#!/usr/bin/env python3
"""Henter bydelsgrenser for Oslo og Bergen fra OpenStreetMap (Nominatim) til prototype/data/bydeler.json.

Bruk:
    python3 scripts/fetch_bydel_geo.py [--out prototype/data/bydeler.json]

Kjøres sjelden (grensene endres knapt). Nominatim krever maks én forespørsel i sekundet og en identifiserende
User-Agent. Data: © OpenStreetMap-bidragsytere (ODbL). «Sentrum» i Oslo er vår egen samling steder og har ikke
en offisiell grense, så den hoppes over.
"""

import argparse
import json
import time
import urllib.parse
import urllib.request

UA = "politiloggen-analyse/0.1 (https://github.com/bredeespelid/politiloggen)"
BYDELER = {
    "0301": ("Oslo", ["Gamle Oslo", "Grünerløkka", "Sagene", "St. Hanshaugen", "Frogner", "Ullern", "Vestre Aker",
                       "Nordre Aker", "Bjerke", "Grorud", "Stovner", "Alna", "Østensjø", "Nordstrand", "Søndre Nordstrand"]),
    "4601": ("Bergen", ["Bergenhus", "Årstad", "Fana", "Fyllingsdalen", "Laksevåg", "Ytrebygda", "Arna", "Åsane"]),
}


def search(q: str):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": q, "format": "jsonv2", "polygon_geojson": 1, "polygon_threshold": 0.0003, "limit": 5, "countrycodes": "no"})
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
        return json.load(r)


def rings(geom: dict) -> list:
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    return [[[round(x, 4), round(y, 4)] for x, y in poly[0]] for poly in polys]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="prototype/data/bydeler.json")
    args = ap.parse_args()
    out = {}
    for mid, (city, names) in BYDELER.items():
        out[mid] = {}
        for name in names:
            time.sleep(1.1)
            hits = [h for h in search(f"{name}, {city}") if h.get("category") == "boundary" and h.get("geojson", {}).get("type") in ("Polygon", "MultiPolygon")
                    and city.lower() in h["display_name"].lower()]
            if not hits:
                print(f"  mangler: {name}, {city}")
                continue
            out[mid][name] = rings(hits[0]["geojson"])
            print(f"  {name}: {sum(len(r) for r in out[mid][name])} punkter")
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Skrev {args.out}")


if __name__ == "__main__":
    main()
