#!/usr/bin/env python3
"""Klassifiser hendelsene i Politiloggen én gang med en språkmodell (Claude Haiku 5.5) og lagre som parquet.

Kjør fra repo-roten. Krever ANTHROPIC_API_KEY (eller `ant auth login`) for submit/collect.

  # 1. Lag arbeidsmappe: inndata, systemprompt og JSON-skjema (hele databasen, eller --sample N for en pilot)
  python3 scripts/classify_llm.py prepare --db politiloggen.db --work llm_work [--sample 300]

  # 2. Send inn. Batch-API (standard) koster halv pris og ferdigstilles vanligvis på under en time.
  python3 scripts/classify_llm.py submit --work llm_work            # batch
  python3 scripts/classify_llm.py submit --work llm_work --direct --limit 200   # direkte, for små kjøringer/test
  python3 scripts/classify_llm.py collect --work llm_work           # kjør til alle batcher er ferdige

  # 3. Skriv parquet (kan kjøres underveis)
  python3 scripts/classify_llm.py parquet --work llm_work --out data/incident_llm_class.parquet

  # Sammenlign mot nøkkelordklassifiseringen (regex-v1)
  python3 scripts/classify_llm.py compare --work llm_work --db politiloggen.db

Kjøringen er gjenopptakbar: submit tar bare med hendelser som ikke har et gyldig svar i results.jsonl.
`import` leser svar fra en JSONL-fil som er laget på en annen måte, og kjører dem gjennom samme validering.
"""

import argparse
import hashlib
import json
import re
import sqlite3
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

CLASSIFIER_VERSION = "llm-v1"
DEFAULT_MODEL = "claude-haiku-5-5"
CHUNK = 20            # hendelser per forespørsel
MAX_TEXT = 1500       # tegn per hendelse; lengre tekster kuttes (sjelden)
MAX_TOKENS = 8000

WEAPON = ["ingen", "kniv", "skytevåpen", "øks", "slagvåpen", "annet", "ukjent"]
INJURY = ["ingen", "lettere", "alvorlig", "dødsfall", "ukjent"]
SEVERITY = ["lav", "middels", "høy"]
OUTCOME = ["pågrepet", "siktet", "anmeldt", "innbrakt", "bortvist", "førerkortbeslag", "forelegg", "funnet", "ingen"]
STATUS = ["pågår", "avsluttet", "ukjent"]
SENTIMENT = ["negativ", "nøytral", "positiv"]
CONFIDENCE = ["høy", "middels", "lav"]
GENDER = ["mann", "kvinne", "ukjent"]
AGE = ["barn", "10-årene", "20-årene", "30-årene", "40-årene", "50-årene", "60-årene", "70-årene", "80+", "ukjent"]

# Korte definisjoner som hjelper modellen å skille underklasser fra hverandre
HINTS = {
    "vold.kniv": "kniv, stikkvåpen eller stikkskade (IKKE «stukket av»)",
    "vold.skyting": "skytevåpen avfyrt eller truet med (IKKE luftvåpen/softgun, IKKE jakt)",
    "vold.slagsmal": "slagsmål, basketak, knuffing mellom flere",
    "vold.legeme": "legemsfornærmelse/-skade, slag, spark, banking",
    "vold.trusler": "trusler eller truende atferd mot person",
    "vold.ran": "ran (tyveri med vold/trussel)",
    "vold.naere": "vold i nære relasjoner, familievold, partnervold",
    "vold.seksuell": "voldtekt, seksuallovbrudd, blotting",
    "trafikk.rus": "promille eller ruspåvirket føring",
    "trafikk.fart": "råkjøring, fartsovertredelse, fartskontroll",
    "trafikk.vilt": "viltpåkjørsel (elg, hjort, rådyr, rein)",
    "trafikk.sparkesykkel": "el-sparkesykkel involvert",
    "trafikk.forerkort": "førerkortbeslag, kjøring uten førerkort",
    "trafikk.uhell": "trafikkuhell, kollisjon, utforkjøring",
    "ro.beruset": "beruset person som er til plage eller trenger hjelp",
    "ro.bortvist": "person bortvist",
    "ro.innbrakt": "person innbrakt/tatt med til arrest",
    "ro.stoy": "støy, bråk, fest",
    "brann.bygning": "brann i bolig, bygning, garasje, hytte",
    "brann.gress": "gress-, lyng-, skog- eller bålbrann",
    "brann.kjoretoy": "brann i kjøretøy",
    "vinning.butikk": "butikktyveri, naskeri",
    "vinning.innbrudd": "innbrudd",
    "vinning.kjoretoy": "tyveri av bil, sykkel, moped, båt",
    "ulykke.sjo": "ulykke eller nødsituasjon på sjø/i vann (båt, drukning)",
    "ulykke.fjell": "ulykke eller nødsituasjon i fjell/terreng",
}


# ---------- Taksonomi, prompt og skjema ----------

def load_taxonomy(con):
    rows = con.execute("SELECT code, parent_code, name FROM dim_taxonomy ORDER BY rowid").fetchall()
    tops = [(c, n) for c, p, n in rows if not p]
    subs = [(c, n, p) for c, p, n in rows if p]
    return tops, subs


def build_system(tops, subs) -> str:
    sub_lines = "\n".join(f"  - {c}: {n}. {HINTS.get(c, '')}".rstrip() for c, n, _ in subs)
    top_lines = "\n".join(f"  - {c}: {n}" for c, n in tops)
    return f"""You classify incident reports from the Norwegian police operations log (Politiloggen). Each incident is one or more short messages in Norwegian, in chronological order, separated by " ||| ". Classify ONLY from the text. Do not guess facts that are not stated.

primary_type: the main nature of the incident, exactly one of
{top_lines}
Use "annet" only when none of the others fit. Weather, events (arrangement), animals, assistance and unclear cases are "annet".

subtypes: every specific type that applies, from this list (several may apply, e.g. a stabbing with threats is vold.kniv and vold.trusler; they need not belong to primary_type). Use an empty list when none apply.
{sub_lines}

Rules:
- is_exercise: true for exercises and drills (øvelse, PLIVO, demonstrasjon av beredskap). Exercises are NOT real incidents: leave subtypes empty and set weapon "ingen", severity "lav".
- weapon: the most dangerous weapon used or shown against someone: {", ".join(WEAPON)}. "ingen" if the text says no weapon or none is relevant; "ukjent" if the text does not say. Air weapons, soft guns and fireworks are "annet", not "skytevåpen".
- injury: the most serious injury to any person: {", ".join(INJURY)}. "ingen" if stated or clearly irrelevant, "ukjent" if the text does not say.
- severity: {", ".join(SEVERITY)}. lav = nuisance or minor, no one hurt; middels = a crime or accident with limited harm; høy = serious injury or death, weapon used against a person, fire in an occupied building, a vulnerable person missing.
- outcome: what the police did, as stated in the text: {", ".join(OUTCOME)} ("funnet" = missing person or item found). Use ["ingen"] when no outcome is stated.
- persons: people described by gender and age group, at most 6, from phrases like "mann i 30-årene". Gender: {", ".join(GENDER)}. age_group: {", ".join(AGE)}. Empty list when no person is described.
- status: "pågår" if the last message says the police are on scene, searching or the situation is ongoing; "avsluttet" if resolved; otherwise "ukjent".
- sentiment: the tone of the event for the people involved: negativ (harm, threat, danger, loss), positiv (resolved well, e.g. missing person found safe, fire put out without injuries), nøytral (routine or purely informational).
- confidence: your confidence in the classification: {", ".join(CONFIDENCE)}.

Return one object per incident, in the same order, with thread_id copied exactly from the input."""


def item_schema(tops, subs) -> dict:
    enum = lambda vals: {"type": "string", "enum": list(vals)}
    return {
        "type": "object",
        "properties": {
            "thread_id": {"type": "string"},
            "primary_type": enum(c for c, _ in tops),
            "subtypes": {"type": "array", "items": enum(c for c, _, _ in subs)},
            "is_exercise": {"type": "boolean"},
            "weapon": enum(WEAPON),
            "injury": enum(INJURY),
            "severity": enum(SEVERITY),
            "outcome": {"type": "array", "items": enum(OUTCOME)},
            "persons": {"type": "array", "items": {
                "type": "object",
                "properties": {"gender": enum(GENDER), "age_group": enum(AGE)},
                "required": ["gender", "age_group"], "additionalProperties": False}},
            "status": enum(STATUS),
            "sentiment": enum(SENTIMENT),
            "confidence": enum(CONFIDENCE),
        },
        "required": ["thread_id", "primary_type", "subtypes", "is_exercise", "weapon", "injury", "severity",
                     "outcome", "persons", "status", "sentiment", "confidence"],
        "additionalProperties": False,
    }


def response_schema(item) -> dict:
    return {"type": "object", "properties": {"results": {"type": "array", "items": item}},
            "required": ["results"], "additionalProperties": False}


def validate_item(it: dict, item) -> list[str]:
    """Lett validering mot skjemaet (enum, type, påkrevde felt). Strukturert utdata skal gi dette, men vi sjekker likevel."""
    errs = []
    for key in item["required"]:
        if key not in it:
            errs.append(f"mangler {key}")
    for key, spec in item["properties"].items():
        if key not in it:
            continue
        v = it[key]
        t = spec["type"]
        if t == "string":
            if not isinstance(v, str) or ("enum" in spec and v not in spec["enum"]):
                errs.append(f"{key}={v!r}")
        elif t == "boolean":
            if not isinstance(v, bool):
                errs.append(f"{key}={v!r}")
        elif t == "array":
            if not isinstance(v, list):
                errs.append(f"{key} er ikke liste")
            elif "enum" in spec["items"]:
                errs += [f"{key}: {x!r}" for x in v if x not in spec["items"]["enum"]]
            elif spec["items"]["type"] == "object":
                for p in v:
                    if not isinstance(p, dict) or any(p.get(k) not in spec["items"]["properties"][k]["enum"] for k in spec["items"]["required"]):
                        errs.append(f"{key}: {p!r}")
    if set(it) - set(item["properties"]):
        errs.append(f"ukjente felt {sorted(set(it) - set(item['properties']))}")
    return errs


# ---------- Inndata ----------

def incident_texts(con, thread_ids=None) -> dict[str, str]:
    q = "SELECT thread_id, text FROM message ORDER BY thread_id, created_on"
    out: dict[str, list[str]] = {}
    for tid, text in con.execute(q):
        if thread_ids is None or tid in thread_ids:
            out.setdefault(tid, []).append(re.sub(r"\s+", " ", text or "").strip())
    return {t: " ||| ".join(p for p in parts if p)[:MAX_TEXT] for t, parts in out.items()}


def stratified_sample(con, n: int, seed: int = 7) -> list[str]:
    """Utvalg til pilot: minst 20 per politikategori, pluss hendelser som nøkkelordene setter som vold utenfor «Voldshendelse»."""
    import random
    rnd = random.Random(seed)
    per_cat: dict[str, list[str]] = {}
    for tid, cat in con.execute("SELECT thread_id, category FROM incident"):
        per_cat.setdefault(cat, []).append(tid)
    pick = set()
    per = max(10, n // (len(per_cat) + 2))
    for cat, ids in per_cat.items():
        pick.update(rnd.sample(ids, min(per, len(ids))))
    vold_outside = [r[0] for r in con.execute("""
        SELECT DISTINCT c.thread_id FROM incident_class c JOIN incident i USING (thread_id)
        WHERE c.taxonomy_code LIKE 'vold.%' AND i.category <> 'Voldshendelse'""")]
    pick.update(rnd.sample(vold_outside, min(n // 5, len(vold_outside))))
    exercises = [r[0] for r in con.execute("SELECT DISTINCT thread_id FROM message WHERE lower(text) LIKE '%øvelse%' LIMIT 200")]
    pick.update(rnd.sample(exercises, min(8, len(exercises))))
    return sorted(pick)[:n] if len(pick) > n else sorted(pick)


# ---------- Arbeidsmappe ----------

class Work:
    def __init__(self, path):
        self.dir = Path(path)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.inputs = self.dir / "inputs.jsonl"
        self.results = self.dir / "results.jsonl"
        self.system = self.dir / "system_prompt.txt"
        self.schema = self.dir / "schema.json"
        self.batches = self.dir / "batches.json"
        self.manifest = self.dir / "manifest.json"

    def load_inputs(self) -> dict[str, str]:
        return {r["thread_id"]: r["text"] for r in map(json.loads, self.inputs.read_text(encoding="utf-8").splitlines())}

    def load_results(self) -> dict[str, dict]:
        if not self.results.exists():
            return {}
        out = {}
        for line in self.results.read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            out[r["thread_id"]] = r
        return out

    def append_results(self, rows: list[dict]):
        with self.results.open("a", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")

    def prompt_and_schema(self):
        return self.system.read_text(encoding="utf-8"), json.loads(self.schema.read_text(encoding="utf-8"))


def input_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def user_message(chunk: dict[str, str]) -> str:
    lines = "\n".join(json.dumps({"thread_id": t, "text": x}, ensure_ascii=False) for t, x in chunk.items())
    return f"Classify these {len(chunk)} incidents. Return the results in the same order.\n\n{lines}"


def accept(parsed_results, chunk_ids: list[str], item, model: str, texts: dict[str, str]):
    """Returnerer (gyldige rader, id-er som må prøves på nytt, feilmeldinger)."""
    ok, errors, seen = [], [], set()
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for it in parsed_results:
        if not isinstance(it, dict) or it.get("thread_id") not in chunk_ids or it["thread_id"] in seen:
            errors.append(f"uventet svar {str(it)[:80]}")
            continue
        errs = validate_item(it, item)
        if errs:
            errors.append(f"{it['thread_id']}: {errs}")
            continue
        seen.add(it["thread_id"])
        ok.append({**it, "input_hash": input_hash(texts[it["thread_id"]]), "classifier_version": CLASSIFIER_VERSION,
                   "model": model, "classified_at": now})
    return ok, [t for t in chunk_ids if t not in seen], errors


# ---------- Kommandoer ----------

def cmd_prepare(a):
    con = sqlite3.connect(a.db)
    w = Work(a.work)
    tops, subs = load_taxonomy(con)
    ids = stratified_sample(con, a.sample) if a.sample else None
    texts = incident_texts(con, set(ids) if ids else None)
    with w.inputs.open("w", encoding="utf-8") as f:
        for tid in sorted(texts):
            f.write(json.dumps({"thread_id": tid, "text": texts[tid]}, ensure_ascii=False) + "\n")
    item = item_schema(tops, subs)
    w.system.write_text(build_system(tops, subs), encoding="utf-8")
    w.schema.write_text(json.dumps(item, ensure_ascii=False, indent=1), encoding="utf-8")
    chars = sum(len(t) for t in texts.values())
    print(f"{len(texts):,} hendelser -> {w.inputs} (≈{chars / 3.5 / 1e6:.1f} M tokens tekst)")


def pending_chunks(w: Work, limit=None):
    texts, done = w.load_inputs(), w.load_results()
    todo = [t for t in texts if t not in done]
    if limit:
        todo = todo[:limit]
    return texts, [dict((t, texts[t]) for t in todo[i:i + CHUNK]) for i in range(0, len(todo), CHUNK)]


def client_and_types():
    import anthropic
    from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
    from anthropic.types.messages.batch_create_params import Request
    return anthropic.Anthropic(), MessageCreateParamsNonStreaming, Request


def request_params(system, item, model, chunk):
    return dict(
        model=model, max_tokens=MAX_TOKENS,
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user_message(chunk)}],
        thinking={"type": "disabled"},          # klassifisering trenger ikke tenking; Haiku 5.5 tillater det ved effort ≤ high
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": response_schema(item)}},
    )


def parse_text(message) -> list:
    text = next((b.text for b in message.content if b.type == "text"), "")
    return json.loads(text)["results"]


def cmd_submit(a):
    w = Work(a.work)
    system, item = w.prompt_and_schema()
    texts, chunks = pending_chunks(w, a.limit)
    if not chunks:
        print("Ingenting å sende inn: alle hendelser har svar.")
        return
    client, Params, Request = client_and_types()
    if a.direct:
        def one(chunk):
            ids = list(chunk)
            for attempt in range(3):
                try:
                    msg = client.messages.create(**request_params(system, item, a.model, chunk))
                    if msg.stop_reason == "refusal":
                        return [], ids, ["refusal"], msg.usage
                    ok, retry, errs = accept(parse_text(msg), ids, item, a.model, texts)
                    if not retry:
                        return ok, [], errs, msg.usage
                    chunk = {t: texts[t] for t in retry}
                    ids = retry
                    last = (ok, retry, errs, msg.usage)
                except (ValueError, KeyError, json.JSONDecodeError) as e:
                    last = ([], ids, [repr(e)], None)
                time.sleep(2 ** attempt)
            return last
        done = failed = 0
        with ThreadPoolExecutor(a.workers) as pool:
            for fut in as_completed([pool.submit(one, c) for c in chunks]):
                ok, retry, errs, usage = fut.result()
                w.append_results(ok)
                done += len(ok)
                failed += len(retry)
                if errs:
                    print("  advarsel:", errs[:2])
        print(f"Direkte: {done:,} klassifisert, {failed:,} uten gyldig svar (kjør submit igjen for å prøve på nytt).")
        return
    manifest = json.loads(w.manifest.read_text()) if w.manifest.exists() else {}
    batches = json.loads(w.batches.read_text()) if w.batches.exists() else []
    base = len(manifest)
    requests = []
    for i, chunk in enumerate(chunks):
        cid = f"c{base + i:06d}"
        manifest[cid] = list(chunk)
        requests.append(Request(custom_id=cid, params=Params(**request_params(system, item, a.model, chunk))))
    for i in range(0, len(requests), a.per_batch):
        part = requests[i:i + a.per_batch]
        b = client.messages.batches.create(requests=part)
        batches.append({"id": b.id, "chunks": [r["custom_id"] for r in part], "model": a.model, "collected": False,
                        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
        print(f"Batch {b.id}: {len(part):,} forespørsler, {sum(len(manifest[r['custom_id']]) for r in part):,} hendelser")
    w.manifest.write_text(json.dumps(manifest), encoding="utf-8")
    w.batches.write_text(json.dumps(batches, indent=1), encoding="utf-8")
    print("Kjør `collect` til alle batcher er ferdige (vanligvis under en time).")


def cmd_collect(a):
    w = Work(a.work)
    _, item = w.prompt_and_schema()
    texts = w.load_inputs()
    client, _, _ = client_and_types()
    manifest = json.loads(w.manifest.read_text())
    batches = json.loads(w.batches.read_text())
    tokens = Counter()
    for b in batches:
        if b["collected"]:
            continue
        st = client.messages.batches.retrieve(b["id"])
        c = st.request_counts
        if st.processing_status != "ended":
            print(f"{b['id']}: {st.processing_status} (under arbeid {c.processing:,}, ferdig {c.succeeded:,}, feil {c.errored:,})")
            continue
        good = bad = 0
        for r in client.messages.batches.results(b["id"]):
            ids = manifest[r.custom_id]
            if r.result.type != "succeeded":
                bad += len(ids)
                continue
            msg = r.result.message
            tokens.update(input=msg.usage.input_tokens, output=msg.usage.output_tokens,
                          cache_read=msg.usage.cache_read_input_tokens or 0, cache_write=msg.usage.cache_creation_input_tokens or 0)
            try:
                ok, retry, errs = accept(parse_text(msg), ids, item, b["model"], texts)
            except (ValueError, KeyError, json.JSONDecodeError):
                ok, retry = [], ids
            w.append_results(ok)
            good += len(ok)
            bad += len(retry)
        b["collected"] = True
        print(f"{b['id']}: {good:,} gyldige, {bad:,} må prøves på nytt (kjør submit igjen)")
    w.batches.write_text(json.dumps(batches, indent=1), encoding="utf-8")
    if tokens:
        cost = (tokens["input"] * 0.10 + tokens["cache_write"] * 0.125 + tokens["cache_read"] * 0.01 + tokens["output"] * 0.50) / 1e6 * 0.5
        print(f"Tokens: {dict(tokens)} ≈ ${cost:.2f} med batch-rabatt")


def cmd_import(a):
    w = Work(a.work)
    _, item = w.prompt_and_schema()
    texts = w.load_inputs()
    rows = [json.loads(l) for l in Path(a.jsonl).read_text(encoding="utf-8").splitlines() if l.strip()]
    ok, retry, errs = accept(rows, list(texts), item, a.model_label, texts)
    w.append_results(ok)
    print(f"{len(ok):,} gyldige av {len(rows):,}; {len(errs)} avvist")
    for e in errs[:10]:
        print("  ", e)


PARQUET_FIELDS = None


def cmd_parquet(a):
    import pyarrow as pa
    import pyarrow.parquet as pq
    w = Work(a.work)
    res = w.load_results()
    rows = [res[t] for t in sorted(res)]
    schema = pa.schema([
        ("thread_id", pa.string()), ("classifier_version", pa.string()), ("model", pa.string()),
        ("classified_at", pa.timestamp("s", tz="UTC")), ("input_hash", pa.string()),
        ("primary_type", pa.string()), ("subtypes", pa.list_(pa.string())), ("is_exercise", pa.bool_()),
        ("weapon", pa.string()), ("injury", pa.string()), ("severity", pa.string()),
        ("outcome", pa.list_(pa.string())),
        ("persons", pa.list_(pa.struct([("gender", pa.string()), ("age_group", pa.string())]))),
        ("status", pa.string()), ("sentiment", pa.string()), ("confidence", pa.string()),
    ])
    cols = {f.name: [r[f.name] if f.name != "classified_at" else datetime.fromisoformat(r[f.name]) for r in rows] for f in schema}
    table = pa.Table.from_pydict(cols, schema=schema.with_metadata({
        "source": "Politiloggen (politiet.no/politiloggen, NLOD 2.0)", "classifier_version": CLASSIFIER_VERSION,
        "note": "En rad per hendelse (thread_id). Se scripts/classify_llm.py for prompt og skjema."}))
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, out, compression="zstd")
    back = pq.read_table(out)
    assert back.num_rows == len(rows)
    print(f"{back.num_rows:,} rader, {len(back.schema)} kolonner -> {out} ({out.stat().st_size / 1e3:.0f} kB)")
    print(Counter(r["model"] for r in rows))


def cmd_compare(a):
    """Sammenligner språkmodellen med nøkkelordklassifiseringen (regex-v1) på hendelsene som har svar."""
    con = sqlite3.connect(a.db)
    res = Work(a.work).load_results()
    regex = {}
    for tid, code, parent in con.execute("""SELECT c.thread_id, c.taxonomy_code, t.parent_code FROM incident_class c
                                            JOIN dim_taxonomy t ON t.code = c.taxonomy_code"""):
        r = regex.setdefault(tid, {"subs": set(), "tops": set()})
        (r["subs"].add(code) if parent else r["tops"].add(code))
        if parent:
            r["tops"].add(parent)
    cat = dict(con.execute("SELECT thread_id, category FROM incident"))
    n = len(res)
    same_primary = sum(1 for t, r in res.items() if r["primary_type"] in regex.get(t, {"tops": set()})["tops"])
    print(f"{n} hendelser. Primærtype finnes blant regex-toppklassene: {same_primary / n:.1%}")
    # Vold: modell vs nøkkelord
    llm_vold = {t for t, r in res.items() if not r["is_exercise"] and (r["primary_type"] == "vold" or any(s.startswith("vold.") for s in r["subtypes"]))}
    rx_vold = {t for t in res if "vold" in regex.get(t, {"tops": set()})["tops"]}
    both, only_llm, only_rx = llm_vold & rx_vold, llm_vold - rx_vold, rx_vold - llm_vold
    print(f"Vold: begge {len(both)}, bare språkmodell {len(only_llm)}, bare nøkkelord {len(only_rx)}")
    print("Underklasser (språkmodell | nøkkelord | begge):")
    for code in sorted({s for r in res.values() for s in r["subtypes"]} | {s for r in regex.values() for s in r["subs"] if s.startswith("vold.")}):
        l = {t for t, r in res.items() if code in r["subtypes"]}
        x = {t for t in res if code in regex.get(t, {"subs": set()})["subs"]}
        print(f"  {code:22} {len(l):4} | {len(x):4} | {len(l & x):4}")
    wl = Counter(r["weapon"] for r in res.values())
    print("Våpen (språkmodell):", dict(wl))
    print("Øvelser:", sum(r["is_exercise"] for r in res.values()), "| sentiment:", dict(Counter(r["sentiment"] for r in res.values())))
    print("\nEksempler på uenighet om vold:")
    texts = Work(a.work).load_inputs()
    for label, ids in (("Bare språkmodell", only_llm), ("Bare nøkkelord", only_rx)):
        print(f"- {label}:")
        for t in sorted(ids)[:6]:
            print(f"    [{cat.get(t)}] {res[t]['primary_type']}/{res[t]['subtypes']} :: {texts[t][:170]}")


def cmd_prompt(a):
    w = Work(a.work)
    print(w.system.read_text(encoding="utf-8"))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare"); p.add_argument("--db", default="politiloggen.db"); p.add_argument("--work", default="llm_work"); p.add_argument("--sample", type=int); p.set_defaults(fn=cmd_prepare)
    p = sub.add_parser("submit"); p.add_argument("--work", default="llm_work"); p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--direct", action="store_true"); p.add_argument("--limit", type=int); p.add_argument("--workers", type=int, default=8)
    p.add_argument("--per-batch", type=int, default=5000, help="forespørsler per batch"); p.set_defaults(fn=cmd_submit)
    p = sub.add_parser("collect"); p.add_argument("--work", default="llm_work"); p.set_defaults(fn=cmd_collect)
    p = sub.add_parser("import"); p.add_argument("--work", default="llm_work"); p.add_argument("--jsonl", required=True); p.add_argument("--model-label", required=True); p.set_defaults(fn=cmd_import)
    p = sub.add_parser("parquet"); p.add_argument("--work", default="llm_work"); p.add_argument("--out", default="data/incident_llm_class.parquet"); p.set_defaults(fn=cmd_parquet)
    p = sub.add_parser("compare"); p.add_argument("--work", default="llm_work"); p.add_argument("--db", default="politiloggen.db"); p.set_defaults(fn=cmd_compare)
    p = sub.add_parser("prompt"); p.add_argument("--work", default="llm_work"); p.set_defaults(fn=cmd_prompt)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
