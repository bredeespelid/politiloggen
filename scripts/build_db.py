#!/usr/bin/env python3
"""Engangslast: Politiloggen CSV-eksport -> strukturert SQLite + egen klassifisering.

Bruk:
    python3 scripts/build_db.py [--export messages.csv.gz] [--db politiloggen.db] [--summary summary.json]

Uten --export lastes eksporten ned fra APIet (ca. 21 MB, generert én gang i døgnet).
Kun standardbibliotek. Data: Politiet, www.politiet.no/politiloggen (NLOD 2.0).
"""

import argparse
import csv
import gzip
import hashlib
import io
import json
import re
import sqlite3
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

API = "https://api.politiloggen.politiet.no"
OSLO = ZoneInfo("Europe/Oslo")
CLASSIFIER = "regex-v1"

SCHEMA = """
CREATE TABLE dim_district (
  district_id   INTEGER PRIMARY KEY,
  name          TEXT NOT NULL
);
CREATE TABLE dim_municipality (
  municipality_id TEXT PRIMARY KEY,           -- kommunenummer
  district_id     INTEGER NOT NULL REFERENCES dim_district,
  name            TEXT NOT NULL
);
CREATE TABLE incident (
  thread_id        TEXT PRIMARY KEY,
  district_id      INTEGER NOT NULL REFERENCES dim_district,
  municipality_id  TEXT REFERENCES dim_municipality,
  municipality     TEXT,
  category         TEXT NOT NULL,             -- politiets kategori, uendret
  area             TEXT,
  is_active        INTEGER NOT NULL,
  created_on       TEXT NOT NULL,
  last_message_on  TEXT NOT NULL,
  message_count    INTEGER NOT NULL,
  row_hash         TEXT NOT NULL,
  first_seen_at    TEXT NOT NULL,
  last_seen_at     TEXT NOT NULL
);
CREATE TABLE message (
  message_id    TEXT PRIMARY KEY,
  thread_id     TEXT NOT NULL REFERENCES incident,
  seq           INTEGER NOT NULL,
  text          TEXT NOT NULL,
  has_image     INTEGER NOT NULL,
  is_edited     INTEGER NOT NULL,
  is_removed    INTEGER NOT NULL DEFAULT 0,
  created_on    TEXT NOT NULL,
  updated_on    TEXT NOT NULL,
  content_hash  TEXT NOT NULL
);
CREATE TABLE message_version (
  message_id    TEXT REFERENCES message,
  content_hash  TEXT,
  text          TEXT NOT NULL,
  valid_from    TEXT NOT NULL,
  valid_to      TEXT,
  PRIMARY KEY (message_id, content_hash)
);
CREATE TABLE dim_taxonomy (
  code         TEXT PRIMARY KEY,
  parent_code  TEXT REFERENCES dim_taxonomy,
  name         TEXT NOT NULL
);
CREATE TABLE incident_class (
  thread_id           TEXT REFERENCES incident,
  taxonomy_code       TEXT REFERENCES dim_taxonomy,
  classifier_version  TEXT,
  input_hash          TEXT NOT NULL,
  confidence          REAL,
  weapon              TEXT,
  outcome             TEXT,                   -- JSON-liste
  persons             TEXT,                   -- JSON-liste
  classified_at       TEXT NOT NULL,
  PRIMARY KEY (thread_id, taxonomy_code, classifier_version)
);
CREATE INDEX ix_message_thread ON message(thread_id);
CREATE INDEX ix_incident_created ON incident(created_on);
CREATE INDEX ix_class_code ON incident_class(taxonomy_code);
"""

# Egen taksonomi i to nivåer. Hver underklasse har et mønster mot hele trådens tekst (lowercase).
# "stukket av" og jakt-/salutt-skudd er bevisst ekskludert.
TAXONOMY = {
    "vold": ("Vold", {
        "vold.kniv": ("Kniv/stikkvåpen", r"\bkniv|stikkskad|knivstikk|stikkvåpen|stukket (ned|i (låret|magen|armen|ryggen|brystet))"),
        "vold.skyting": ("Skyting/skytevåpen", r"skytevåpen|\bskudd ble avfyrt|\bavfyrt|\bskutt\b|skyteepisode|skyting(?! ?bane)"),
        "vold.slagsmal": ("Slagsmål/basketak", r"slagsm[åa]l|slåss|basketak|knuffing"),
        "vold.legeme": ("Legemsfornærmelse/-skade", r"legemsbeskad|legemsfornærm|kroppsskade|\bslått\b|\bslag mot|\bsparket\b"),
        "vold.trusler": ("Trusler", r"\btrus(el|ler|selen|sler)|truet\b|truende"),
        "vold.ran": ("Ran", r"\bran\b|\branet\b|\branere?\b|ransforsøk"),
        "vold.naere": ("Vold i nære relasjoner", r"nære relasjon|familievold|partnervold"),
        "vold.seksuell": ("Seksuallovbrudd", r"voldtekt|seksuell|blotting|blottet seg"),
    }),
    "trafikk": ("Trafikk", {
        "trafikk.rus": ("Promille/ruspåvirket", r"promille|ruspåvirk|alkotest|alkometer|blodprøve|påvirket av"),
        "trafikk.fart": ("Fart", r"\bfart|km/t|hastighet"),
        "trafikk.vilt": ("Viltpåkjørsel", r"\belg\b|\bhjort|\brådyr|\brein\b|vilt(påkjørsel|et)?\b"),
        "trafikk.sparkesykkel": ("(El)sparkesykkel", r"sparkesykkel|el-?sparkesykkel"),
        "trafikk.forerkort": ("Uten/beslag førerkort", r"førerkortbeslag|uten førerkort|ikke førerkort|førerett"),
        "trafikk.uhell": ("Trafikkuhell", r"trafikkuhell|kollisjon|kolliderte|utforkjøring|kjørt av veien|påkjørt|velt"),
    }),
    "ro": ("Ro og orden", {
        "ro.beruset": ("Beruset person", r"beruse|overstadig|full\b"),
        "ro.bortvist": ("Bortvist", r"bortvist|bortvisning"),
        "ro.innbrakt": ("Innbrakt", r"innbrakt|innbringelse|arresten"),
        "ro.stoy": ("Støy/bråk", r"støy|bråk|høy musikk|fest\b|nachspiel"),
    }),
    "brann": ("Brann", {
        "brann.bygning": ("Brann i bygning", r"bolighus|enebolig|leilighet|bygning|hus\b|garasje|låve|hytte"),
        "brann.gress": ("Gress/skog/lyng", r"gress|lyng|skog|krattbrann|terrengbrann|bål"),
        "brann.kjoretoy": ("Brann i kjøretøy", r"bilbrann|brann i (en )?bil|brennende bil|kjøretøy"),
    }),
    "vinning": ("Vinning", {
        "vinning.butikk": ("Butikktyveri", r"butikktyv|naskeri|butikk"),
        "vinning.innbrudd": ("Innbrudd", r"innbrudd|brutt seg inn|brukket opp"),
        "vinning.kjoretoy": ("Tyveri av kjøretøy/sykkel", r"(bil|sykkel|moped|båt)tyveri|stjålet (bil|sykkel)"),
    }),
    "ulykke": ("Ulykke/redning", {
        "ulykke.sjo": ("Sjø/drukning", r"\bbåt|\bsjø|drukn|kantret"),
        "ulykke.fjell": ("Fjell/terreng", r"fjell|turgåer|skred|ras\b"),
    }),
    "savnet": ("Savnet", {}),
    "annet": ("Annet", {}),
}

# Fallback når ingen underklasse treffer: politiets kategori -> vår overklasse.
CATEGORY_TO_TOP = {
    "Voldshendelse": "vold", "Trafikk": "trafikk", "Ro og orden": "ro", "Brann": "brann",
    "Tyveri": "vinning", "Innbrudd": "vinning", "Skadeverk": "vinning",
    "Ulykke": "ulykke", "Redning": "ulykke", "Sjø": "ulykke", "Savnet": "savnet",
}

WEAPONS = [("skytevåpen", r"skytevåpen|pistol|gevær|hagle|revolver"), ("kniv", r"\bkniv|stikkvåpen"),
           ("øks", r"\bøks"), ("slagvåpen", r"balltre|jernrør|slagvåpen|kølle")]
OUTCOMES = [("pågrepet", r"pågrep"), ("anmeldt", r"anmeld"), ("innbrakt", r"innbrakt|innbringelse"),
            ("bortvist", r"bortvis"), ("førerkortbeslag", r"førerkortbeslag|beslag(lagt)? (av )?førerkort"),
            ("forelegg", r"forelegg")]
PERSON = re.compile(r"\b(mann|kvinne|gutt|jente|ungdom)(?:en)? i (\d0)-?årene")

COMPILED = {code: re.compile(p) for _, (_, subs) in TAXONOMY.items() for code, (_, p) in subs.items()}
SUB_TOP = {code: top for top, (_, subs) in TAXONOMY.items() for code in subs}


def sha(*parts) -> str:
    return hashlib.sha256("|".join("" if p is None else str(p) for p in parts).encode()).hexdigest()


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def classify(category: str, text: str):
    t = text.lower()
    codes = [code for code, rx in COMPILED.items() if rx.search(t)]
    # Underklasser fra andre overklasser enn politiets kategori teller bare for vold (den kryssklassifiseres),
    # ellers holdes vi innenfor den overklassen politiet har valgt.
    home = CATEGORY_TO_TOP.get(category, "annet")
    codes = [c for c in codes if SUB_TOP[c] in (home, "vold")]
    if not codes:
        codes = [home]
    weapon = next((w for w, p in WEAPONS if re.search(p, t)), None)
    outcome = [o for o, p in OUTCOMES if re.search(p, t)]
    persons = [{"kjønn": m.group(1), "alder": f"{m.group(2)}-årene"} for m in PERSON.finditer(t)][:5]
    return codes, weapon, outcome, persons


def load_export(path: str | None) -> list[dict]:
    if path:
        raw = open(path, "rb").read()
    else:
        print("Laster ned eksport …")
        with urllib.request.urlopen(f"{API}/messages/export", timeout=300) as r:
            raw = r.read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))


def load_districts() -> list[dict]:
    with urllib.request.urlopen(f"{API}/districts/extended", timeout=60) as r:
        return json.load(r)


def key(s: str) -> str:
    return re.sub(r"[\s-]", "", s.lower()).replace("politidistrikt", "")


def build(rows: list[dict], districts: list[dict], db_path: str):
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    con = sqlite3.connect(db_path)
    con.executescript("".join(f"DROP TABLE IF EXISTS {t};" for t in
                              ["incident_class", "dim_taxonomy", "message_version", "message", "incident",
                               "dim_municipality", "dim_district"]) + SCHEMA)

    district_by_key, muni_by_key = {}, {}
    for d in districts:
        did = d["district"]["id"]
        district_by_key[key(d["district"]["name"])] = did
        con.execute("INSERT INTO dim_district VALUES (?,?)", (did, d["district"]["name"]))
        for m in d["municipalities"]:
            muni_by_key[(did, m["name"].lower())] = m["id"]
            con.execute("INSERT OR IGNORE INTO dim_municipality VALUES (?,?,?)", (m["id"], did, m["name"]))

    for top, (name, subs) in TAXONOMY.items():
        con.execute("INSERT INTO dim_taxonomy VALUES (?,?,?)", (top, None, name))
        for code, (sub_name, _) in subs.items():
            con.execute("INSERT INTO dim_taxonomy VALUES (?,?,?)", (code, top, sub_name))

    threads = defaultdict(list)
    for r in rows:
        threads[r["ThreadId"]].append(r)

    for tid, msgs in threads.items():
        msgs.sort(key=lambda r: r["CreatedOn"])
        h = msgs[0]
        did = district_by_key.get(key(h["District"]))
        mid = muni_by_key.get((did, h["Municipality"].split(" (")[0].lower()))
        last = max(r["CreatedOn"] for r in msgs)
        is_active = h["IsActive"] == "True"
        row_hash = sha(h["Category"], did, mid, norm(h["Area"]), is_active, last)
        con.execute("INSERT INTO incident VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (tid, did, mid, h["Municipality"], h["Category"], norm(h["Area"]) or None, int(is_active),
                     h["CreatedOn"], last, len(msgs), row_hash, now, now))
        hashes = []
        for r in msgs:
            text = norm(r["Text"])
            has_image = bool(r["ImageUrl"])
            ch = sha(text, has_image)
            hashes.append((int(r["Id"].rsplit("-", 1)[1]), ch))
            con.execute("INSERT INTO message VALUES (?,?,?,?,?,?,0,?,?,?)",
                        (r["Id"], tid, int(r["Id"].rsplit("-", 1)[1]), text, int(has_image),
                         int(r["IsEdited"] == "True"), r["CreatedOn"], r["UpdatedOn"], ch))
            con.execute("INSERT INTO message_version VALUES (?,?,?,?,NULL)", (r["Id"], ch, text, r["UpdatedOn"]))

        input_hash = sha(*[c for _, c in sorted(hashes)])
        codes, weapon, outcome, persons = classify(h["Category"], " ".join(r["Text"] for r in msgs))
        for code in codes:
            con.execute("INSERT INTO incident_class VALUES (?,?,?,?,?,?,?,?,?)",
                        (tid, code, CLASSIFIER, input_hash, None, weapon,
                         json.dumps(outcome, ensure_ascii=False), json.dumps(persons, ensure_ascii=False), now))
    con.commit()
    return con


def summarize(con: sqlite3.Connection) -> dict:
    q = lambda sql, *a: con.execute(sql, a).fetchall()
    local = lambda iso: datetime.fromisoformat(iso[:19] + "+00:00").astimezone(OSLO)

    inc = {r[0]: r for r in q("""SELECT thread_id, district_id, municipality, category, area, created_on,
                                        message_count, is_active FROM incident""")}
    classes = defaultdict(list)
    for tid, code, weapon, outcome, persons in q(
            "SELECT thread_id, taxonomy_code, weapon, outcome, persons FROM incident_class"):
        classes[tid].append((code, weapon, json.loads(outcome), json.loads(persons)))

    tax = {code: (parent, name) for code, parent, name in q("SELECT code, parent_code, name FROM dim_taxonomy")}
    districts = dict(q("SELECT district_id, name FROM dim_district"))

    # Per måned × underklasse × distrikt (kompakt kube til appen)
    cube = Counter()            # underklasser (en hendelse kan ha flere)
    cube_top = Counter()        # unike hendelser per overklasse
    cube_all = Counter()        # alle hendelser, for normalisering
    hour_wd = defaultdict(Counter)
    cross = Counter()           # politiets kategori × vår overklasse (for vold-underklasser)
    weapons, outcomes, ages = Counter(), Counter(), Counter()
    for tid, (_, did, muni, cat, area, created, n, active) in inc.items():
        dt = local(created)
        month = dt.strftime("%Y-%m")
        tops = set()
        for code, weapon, outcome, persons in classes[tid]:
            top = tax[code][0] or code
            tops.add(top)
            if tax[code][0]:
                cube[(month, did, code)] += 1
                hour_wd[code][(dt.weekday(), dt.hour)] += 1
        cube_all[(month, did)] += 1
        for top in tops:
            cube_top[(month, did, top)] += 1
            cross[(cat, top)] += 1
            hour_wd[top][(dt.weekday(), dt.hour)] += 1
        c0 = classes[tid][0]
        if c0[1]:
            weapons[c0[1]] += 1
        for o in c0[2]:
            outcomes[(tax[c0[0]][0] or c0[0], o)] += 1
        for p in c0[3]:
            ages[(tax[c0[0]][0] or c0[0], p["kjønn"], p["alder"])] += 1

    recent = q("""SELECT i.thread_id, i.category, i.municipality, i.area, i.created_on, i.message_count, i.is_active,
                         (SELECT text FROM message m WHERE m.thread_id = i.thread_id ORDER BY seq DESC LIMIT 1)
                  FROM incident i ORDER BY i.created_on DESC LIMIT 200""")
    samples = []
    for tid, cat, muni, area, created, n, active, text in recent:
        cl = classes[tid]
        samples.append({"id": tid, "category": cat, "municipality": muni, "area": area,
                        "created": created[:19] + "Z", "messages": n, "active": bool(active), "text": text,
                        "classes": [c[0] for c in cl], "weapon": cl[0][1], "outcome": cl[0][2],
                        "persons": cl[0][3], "district": districts.get(inc[tid][1])})

    counts = {t: q(f"SELECT COUNT(*) FROM {t}")[0][0] for t in
              ["incident", "message", "message_version", "incident_class", "dim_taxonomy", "dim_district",
               "dim_municipality"]}
    example = {
        "incident": q("SELECT * FROM incident WHERE message_count > 2 ORDER BY created_on DESC LIMIT 1"),
        "message": q("""SELECT message_id, thread_id, seq, substr(text,1,80), has_image, is_edited, is_removed,
                               created_on, updated_on, content_hash FROM message ORDER BY created_on DESC LIMIT 2"""),
        "incident_class": q("""SELECT * FROM incident_class WHERE weapon IS NOT NULL
                               ORDER BY classified_at DESC LIMIT 2"""),
    }
    span = q("SELECT MIN(created_on), MAX(created_on) FROM incident")[0]
    return {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "span": span, "counts": counts, "classifier": CLASSIFIER,
        "districts": districts,
        "taxonomy": {code: {"parent": p, "name": n} for code, (p, n) in tax.items()},
        "cube": [[m, d, c, v] for (m, d, c), v in sorted(cube.items())],
        "cubeTop": [[m, d, c, v] for (m, d, c), v in sorted(cube_top.items())],
        "cubeAll": [[m, d, v] for (m, d), v in sorted(cube_all.items())],
        "hourWeekday": {code: [[wd, h, v] for (wd, h), v in c.items()] for code, c in hour_wd.items()},
        "cross": [[cat, top, v] for (cat, top), v in cross.items()],
        "weapons": weapons.most_common(),
        "outcomes": [[t, o, v] for (t, o), v in outcomes.most_common()],
        "persons": [[t, g, a, v] for (t, g, a), v in ages.most_common(60)],
        "samples": samples,
        "example": {k: [list(r) for r in v] for k, v in example.items()},
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--export", help="Lokal CSV(.gz) fra /messages/export")
    ap.add_argument("--db", default="politiloggen.db")
    ap.add_argument("--summary", help="Skriv sammendrag (JSON) for dashbordet hit")
    args = ap.parse_args()

    rows = load_export(args.export)
    print(f"{len(rows):,} meldinger lest")
    con = build(rows, load_districts(), args.db)
    for t in ["incident", "message", "incident_class"]:
        print(f"  {t}: {con.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]:,}")
    if args.summary:
        with open(args.summary, "w", encoding="utf-8") as f:
            json.dump(summarize(con), f, ensure_ascii=False, separators=(",", ":"))
        print(f"Sammendrag skrevet til {args.summary}")


if __name__ == "__main__":
    main()
