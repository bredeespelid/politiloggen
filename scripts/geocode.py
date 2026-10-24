#!/usr/bin/env python3
"""Geokoding av områder i dim_area mot Kartverkets åpne API-er (inkrementell).

Bruk:
    python3 scripts/geocode.py [--db politiloggen.db] [--min-incidents 2] [--workers 4]

Gater slås opp i adresse-APIet (ws.geonorge.no/adresser), alt annet i stedsnavn-APIet
(api.kartverket.no/stedsnavn). Resultatet lagres i geo_area; områder som allerede er slått opp hoppes over.
Veier og tunneler geokodes ikke – de har ikke ett punkt.
"""

import argparse
import json
import sqlite3
import statistics
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

STEDSNAVN = "https://api.kartverket.no/stedsnavn/v1/navn"
ADRESSER = "https://ws.geonorge.no/adresser/v1/sok"

# Stedstyper som beskriver et område snarere enn et enkeltobjekt; foretrekkes ved flere treff.
AREA_KINDS = ["Bydel", "By", "Tettsted", "Tettbebyggelse", "Boligfelt", "Grend", "Bygdelag (bygd)",
              "Gard", "Nes", "Strand", "Kai", "Plass", "Holdeplass", "Stasjon", "Senter", "Skole"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS geo_area (
  municipality_id  TEXT NOT NULL,
  area_key         TEXT NOT NULL,
  lat              REAL,                       -- NULL = slått opp uten treff
  lon              REAL,
  source           TEXT,                       -- 'adresser' | 'stedsnavn'
  matched_name     TEXT,
  matched_kind     TEXT,
  geocoded_at      TEXT NOT NULL,
  PRIMARY KEY (municipality_id, area_key)
);
"""


def get(url: str, params: dict) -> dict:
    full = f"{url}?{urllib.parse.urlencode(params)}"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(full, timeout=30) as r:
                return json.load(r)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def by_address(name: str, kommune: str):
    res = get(ADRESSER, {"sok": name, "kommunenavn": kommune, "treffPerSide": 100, "utkoordsys": 4258})
    hits = [a for a in res.get("adresser", []) if a["adressenavn"].lower() == name.lower()]
    if not hits:
        return None
    # Midtpunktet (median) av adressene i gata
    lat = statistics.median(a["representasjonspunkt"]["lat"] for a in hits)
    lon = statistics.median(a["representasjonspunkt"]["lon"] for a in hits)
    return lat, lon, "adresser", hits[0]["adressenavn"], "Gate"


def by_place(name: str, kommune: str):
    res = get(STEDSNAVN, {"sok": name, "kommunenavn": kommune, "treffPerSide": 20, "utkoordsys": 4258})
    hits = [n for n in res.get("navn", []) if any(k["kommunenavn"].lower() == kommune.lower() for k in n.get("kommuner") or [])]
    if not hits:
        return None
    exact = [n for n in hits if n["skrivemåte"].lower() == name.lower()] or hits

    def rank(n):
        kind = n.get("navneobjekttype", "")
        return AREA_KINDS.index(kind) if kind in AREA_KINDS else len(AREA_KINDS)

    best = min(exact, key=rank)
    p = best["representasjonspunkt"]
    return p["nord"], p["øst"], "stedsnavn", best["skrivemåte"], best.get("navneobjekttype")


def geocode(mid: str, key: str, name: str, atype: str, kommune: str):
    query = kommune if key in ("sentrum", "(hele kommunen)") else key
    try:
        hit = by_address(query, kommune) if atype == "gate" else None
        hit = hit or by_place(query, kommune)
    except Exception as e:
        return mid, key, None, f"feil: {e}"
    return mid, key, hit, None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default="politiloggen.db")
    ap.add_argument("--min-incidents", type=int, default=2)
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    con = sqlite3.connect(args.db)
    con.executescript(SCHEMA)
    todo = con.execute("""
        SELECT a.municipality_id, a.area_key, a.name, a.area_type, m.name, COUNT(*) n
        FROM incident i
        JOIN dim_area a USING (municipality_id, area_key)
        JOIN dim_municipality m ON m.municipality_id = a.municipality_id
        LEFT JOIN geo_area g ON g.municipality_id = a.municipality_id AND g.area_key = a.area_key
        WHERE g.area_key IS NULL AND a.area_type NOT IN ('vei')
        GROUP BY 1, 2 HAVING n >= ? ORDER BY n DESC""", (args.min_incidents,)).fetchall()
    print(f"{len(todo):,} områder å slå opp")

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    done = found = 0
    with ThreadPoolExecutor(args.workers) as pool:
        futures = [pool.submit(geocode, mid, key, name, atype, kommune) for mid, key, name, atype, kommune, _ in todo]
        for f in as_completed(futures):
            mid, key, hit, err = f.result()
            done += 1
            if err:
                continue  # prøves igjen ved neste kjøring
            found += bool(hit)
            lat, lon, source, matched, kind = hit or (None, None, None, None, None)
            con.execute("INSERT OR REPLACE INTO geo_area VALUES (?,?,?,?,?,?,?,?)",
                        (mid, key, lat, lon, source, matched, kind, now))
            if done % 250 == 0:
                con.commit()
                print(f"  {done:,}/{len(todo):,} – {found:,} med treff", flush=True)
    con.commit()
    print(f"Ferdig: {found:,} av {done:,} geokodet")


if __name__ == "__main__":
    main()
