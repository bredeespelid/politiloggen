#!/usr/bin/env python3
"""Engangslast: Politiloggen CSV-eksport -> strukturert SQLite + egen klassifisering.

Bruk:
    python3 scripts/build_db.py [--export messages.csv.gz] [--db politiloggen.db]

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

API = "https://api.politiloggen.politiet.no"
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
CREATE TABLE dim_area (
  municipality_id  TEXT NOT NULL,
  area_key         TEXT NOT NULL,              -- vasket nøkkel, f.eks. 'grünerløkka'
  name             TEXT NOT NULL,              -- vanligste skrivemåte
  area_type        TEXT NOT NULL,              -- strøk, sentrum, gate, vei, kollektiv, virksomhet, natur, kommune
  bydel            TEXT,                       -- Oslo/Bergen der entydig
  variants         INTEGER NOT NULL,           -- antall ulike råverdier
  classifier_version TEXT NOT NULL,
  PRIMARY KEY (municipality_id, area_key)
);
CREATE TABLE incident (
  thread_id        TEXT PRIMARY KEY,
  district_id      INTEGER NOT NULL REFERENCES dim_district,
  municipality_id  TEXT REFERENCES dim_municipality,
  municipality     TEXT,
  category         TEXT NOT NULL,             -- politiets kategori, uendret
  area             TEXT,                       -- råverdi
  area_key         TEXT,                       -- -> dim_area (med municipality_id)
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


# ---------- Område: vask + klassifisering (area-v1) ----------
AREA_CLASSIFIER = "area-v1"

AREA_TYPES = [  # rekkefølgen betyr noe: første treff vinner
    ("vei", r"^(e|rv|fv|riksvei|fylkesvei|europavei|kv)\s?-?\d+\b|^ring\s?\d|tunnel(en)?\b|\bbrua?\b|bru(a|en)$|bro(en|a)?$|avkjøring|rundkjøring|kryss(et)?\b|splitten$"),
    ("gate", r"(gata|gaten|gate|veien|vei|vegen|veg|allé|alle|plass|plassen|torg|torget|bakken|stien|svingen|brygge|brygga|kaia)(\s\d+\s?\w?)?$"),
    ("kollektiv", r"stasjon|t-?bane|jernbane|^oslo s$|terminal|lufthavn|flyplass|gardermoen|\bkai(a|en)?\b|ferje|holdeplass|busslomme"),
    ("virksomhet", r"senter(et)?\b|skole|\bvgs\b|barnehage|sykehus|legevakt|hotell|stadion|idrettsplass|\barena\b|kirke|fengsel|butikk|utested|kafe|restaurant|bensinstasjon|camping|marina|tollsted|asylmottak|kjøpesenter"),
    ("natur", r"fjell(et)?\b|vann(et)?\b|\bskog(en)?\b|marka\b|fjord(en)?\b|\bøy(a)?\b|elv(a|en)?\b|strand(a|en)?\b|\bholme(n)?\b|\bvik(a|en)?$"),
]
AREA_RX = [(t, re.compile(p)) for t, p in AREA_TYPES]

ALIASES = {"majorstuen": "majorstua", "oslo sentrum": "sentrum", "bergen sentrum": "sentrum",
           "trondheim sentrum": "sentrum", "sentrum nord": "sentrum", "sentrum sør": "sentrum",
           "kristiansand sentrum": "sentrum", "drammen sentrum": "sentrum", "tromsø sentrum": "sentrum",
           "stavanger sentrum": "sentrum", "midtbyen": "sentrum", "kvadraturen": "sentrum",
           "oslo sentralstasjon": "oslo s", "gamle oslo": "gamlebyen", "grunerløkka": "grünerløkka",
           "lokka": "grünerløkka", "løkka": "grünerløkka"}

# Strøk/gater -> bydel. Bare der tilhørigheten er entydig; resten avklares med koordinater (Kartverket) senere.
BYDELER = {
    "0301": {  # Oslo
        "Sentrum": "sentrum, oslo s, storgata, torggata, karl johans gate, karl johan, youngstorget, jernbanetorget, brugata, kirkeristen, rådhusplassen, aker brygge, tjuvholmen, vika, kvadraturen, egertorget, stortorvet",
        "Gamle Oslo": "grønland, tøyen, gamlebyen, kampen, vålerenga, ensjø, helsfyr, etterstad, kværner, bjørvika, vaterland, grønlandsleiret, galgeberg",
        "Grünerløkka": "grünerløkka, sofienberg, rodeløkka, carl berner, sinsen, hasle, løren, dælenenga, rosenhoff, schous plass, olaf ryes plass",
        "Sagene": "sagene, torshov, bjølsen, sandaker, iladalen, ila",
        "St. Hanshaugen": "st. hanshaugen, st.hanshaugen, bislett, fagerborg, adamstuen, bolteløkka, pilestredet, alexander kiellands plass",
        "Frogner": "frogner, majorstua, skillebekk, uranienborg, bygdøy, briskeby, solli, homansbyen, filipstad, hjortnes",
        "Ullern": "skøyen, ullern, lilleaker, montebello, smestad, bestum",
        "Vestre Aker": "røa, holmenkollen, vinderen, slemdal, hovseter, voksen, sørkedalen, huseby, bogstad",
        "Nordre Aker": "tåsen, nydalen, storo, grefsen, kjelsås, berg, korsvoll, blindern",
        "Bjerke": "økern, bjerke, veitvet, linderud, årvoll, risløkka, tonsenhagen, refstad, ulven",
        "Grorud": "grorud, romsås, ammerud, kalbakken, rødtvet, nordtvet",
        "Stovner": "stovner, vestli, haugenstua, rommen, fossum, høybråten, smedstua",
        "Alna": "furuset, alnabru, lindeberg, haugerud, trosterud, tveita, hellerud, teisen, ellingsrud, karihaugen, alfaset, alna",
        "Østensjø": "bryn, manglerud, oppsal, bøler, abildsø, skullerud, ulsrud, godlia, østensjø",
        "Nordstrand": "nordstrand, lambertseter, ekeberg, ljan, bekkelaget, simensbråten, munkerud, karlsrud",
        "Søndre Nordstrand": "holmlia, mortensrud, bjørndal, hauketo, prinsdal, klemetsrud, stensrud",
    },
    "4601": {  # Bergen
        "Bergenhus": "sentrum, torget, bryggen, torgallmenningen, torgalmenningen, torgallmenning, nordnes, sandviken, møhlenpris, engen, festplassen, ole bulls plass, øvre ole bulls plass, marken, vågsbunnen, strandgaten, olav kyrres gate, torggaten, nygårdsgaten, kong oscars gate, håkonsgaten, byparken, veiten, strandkaien, michael krohns gate, korskirken, christies gate, strømgaten, nøstet, zachariasbryggen, vaskerelven",
        "Årstad": "danmarksplass, gyldenpris, kronstad, minde, landås, solheimsviken, årstad, fjøsangerveien",
        "Fana": "fana, nesttun, paradis, skjold, hop, rådal, bønes, fanavegen",
        "Fyllingsdalen": "fyllingsdalen, oasen",
        "Laksevåg": "laksevåg, loddefjord, kjøkkelvik, olsvik, damsgård, damsgårdsveien, godvik",
        "Ytrebygda": "flesland, ytrebygda, sandsli, kokstad",
        "Arna": "arna, indre arna, ytre arna",
        "Åsane": "åsane, eidsvåg, nyborg, tertnes, ulset, åsane senter, åsaneveien",
    },
}
BYDEL_OF = {(m, name.strip()): bydel for m, d in BYDELER.items() for bydel, names in d.items()
            for name in names.split(",")}

def area_key(raw: str | None, municipality: str) -> str | None:
    if not raw:
        return None
    s = norm(raw).lower().rstrip(".")
    s = re.split(r"\s*[,/;]\s*|\s+-\s+", s)[0]                       # første ledd: "E6, Røssvoll" -> "e6"
    s = re.sub(r"\s+(ved|v/|utenfor|nær)\s.*$", "", s)                # "e39 ved x" -> "e39"
    s = re.sub(r"^(e|rv|fv|ring)\s*-?\s*(\d+).*$", r"\1\2", s)        # "rv 22 gansvika" -> "rv22", "ring 3" -> "ring3"
    s = re.sub(r"(?<=\D)\s+\d+\s?[a-z]?$", "", s)                      # husnummer
    s = s.replace("grunerløkka", "grünerløkka")
    if s == municipality.lower():
        return "(hele kommunen)"
    if s.startswith(municipality.lower() + " ") and s.endswith("sentrum"):
        s = "sentrum"
    return ALIASES.get(s, s) or None


def area_type(key: str | None, raw: str | None) -> str:
    if not key:
        return "mangler"
    if key == "(hele kommunen)":
        return "kommune"
    if key == "sentrum" or key.endswith(" sentrum"):
        return "sentrum"
    whole = (raw or "").lower()
    for t, rx in AREA_RX:
        if rx.search(key) or (t == "vei" and rx.search(whole)):
            return t
    return "strøk"

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
                              ["incident_class", "dim_taxonomy", "message_version", "message", "incident", "dim_area",
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

    areas = defaultdict(Counter)
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
        akey = area_key(h["Area"], h["Municipality"])
        if akey and mid:
            areas[(mid, akey)][norm(h["Area"])] += 1
        con.execute("INSERT INTO incident VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (tid, did, mid, h["Municipality"], h["Category"], norm(h["Area"]) or None, akey, int(is_active),
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
    for (mid, akey), raws in areas.items():
        name, _ = raws.most_common(1)[0]
        con.execute("INSERT INTO dim_area VALUES (?,?,?,?,?,?,?)",
                    (mid, akey, name, area_type(akey, name), BYDEL_OF.get((mid, akey)), len(raws), AREA_CLASSIFIER))
    con.commit()
    return con


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--export", help="Lokal CSV(.gz) fra /messages/export")
    ap.add_argument("--db", default="politiloggen.db")
    args = ap.parse_args()

    rows = load_export(args.export)
    print(f"{len(rows):,} meldinger lest")
    con = build(rows, load_districts(), args.db)
    for t in ["incident", "message", "incident_class"]:
        print(f"  {t}: {con.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]:,}")


if __name__ == "__main__":
    main()
