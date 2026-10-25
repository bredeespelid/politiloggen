import { Panel } from "../components/ui";
import { fmtNum } from "../lib/format";
import type { ViewProps } from "./types";

type Key = "PK" | "FK" | "HASH";
type Ent = [name: string, desc: string, cols: [string, string, Key?][]];

const ENT: Ent[] = [
  ["incident", "Hendelse (tråd). Felt som er felles for hele tråden.", [["thread_id", "text", "PK"], ["district_id", "int", "FK"], ["municipality_id", "text", "FK"], ["municipality", "text"], ["category", "text"], ["area", "text"], ["area_key", "text", "FK"], ["is_active", "bool"], ["created_on", "timestamptz"], ["last_message_on", "timestamptz"], ["message_count", "int"], ["row_hash", "char(64)", "HASH"], ["first_seen_at", "timestamptz"], ["last_seen_at", "timestamptz"]]],
  ["message", "Én oppdatering. Gjeldende versjon.", [["message_id", "text", "PK"], ["thread_id", "text", "FK"], ["seq", "int"], ["text", "text"], ["has_image", "bool"], ["is_edited", "bool"], ["is_removed", "bool"], ["created_on", "timestamptz"], ["updated_on", "timestamptz"], ["content_hash", "char(64)", "HASH"]]],
  ["message_version", "Historikk (SCD2): én rad per faktisk innholdsendring.", [["message_id", "text", "PK"], ["content_hash", "char(64)", "PK"], ["text", "text"], ["valid_from", "timestamptz"], ["valid_to", "timestamptz"]]],
  ["incident_class", "Nøkkelordklassifisering (regex-v1), beholdt som reserve og til sammenligning. Flere koder per hendelse.", [["thread_id", "text", "PK"], ["taxonomy_code", "text", "PK"], ["classifier_version", "text", "PK"], ["input_hash", "char(64)", "HASH"], ["confidence", "real"], ["weapon", "text"], ["outcome", "json"], ["persons", "json"], ["classified_at", "timestamptz"]]],
  ["incident_llm_class", "Språkmodellens klassifisering (parquet-fil, data/incident_llm_class.parquet). Én rad per hendelse.", [["thread_id", "text", "PK"], ["classifier_version", "text"], ["model", "text"], ["classified_at", "timestamptz"], ["input_hash", "char(64)", "HASH"], ["primary_type", "text"], ["subtypes", "list"], ["is_exercise", "bool"], ["weapon", "text"], ["injury", "text"], ["severity", "text"], ["outcome", "list"], ["persons", "list"], ["status", "text"], ["sentiment", "text"], ["confidence", "text"]]],
  ["dim_taxonomy", "Egen taksonomi i to nivåer.", [["code", "text", "PK"], ["parent_code", "text", "FK"], ["name", "text"]]],
  ["dim_area", "Vasket og klassifisert område per kommune (area-v1).", [["municipality_id", "text", "PK"], ["area_key", "text", "PK"], ["name", "text"], ["area_type", "text"], ["bydel", "text"], ["variants", "int"], ["classifier_version", "text"]]],
  ["geo_area", "Koordinater fra Kartverket per område (inkrementell).", [["municipality_id", "text", "PK"], ["area_key", "text", "PK"], ["lat", "real"], ["lon", "real"], ["source", "text"], ["matched_name", "text"], ["matched_kind", "text"], ["geocoded_at", "timestamptz"]]],
  ["dim_district", "Politidistrikter.", [["district_id", "int", "PK"], ["name", "text"]]],
  ["dim_municipality", "Kommuner med kommunenummer.", [["municipality_id", "text", "PK"], ["district_id", "int", "FK"], ["name", "text"]]],
];

const EXAMPLES = ["incident", "message", "incident_llm_class", "dim_area", "geo_area"];
const KEY_CLASS: Record<Key, string> = { PK: "pk", FK: "fk", HASH: "h" };

const short = (v: unknown): string => {
  const s = v == null ? "NULL" : String(v);
  return /^[0-9a-f]{64}$/.test(s) ? `${s.slice(0, 10)}…` : s.length > 60 ? `${s.slice(0, 57)}…` : s;
};

export default function Datamodell({ ds }: ViewProps) {
  return (
    <div className="grid">
      <Panel span={12} id="erd-title" title="Tabeller"
        lede={<>Bygget fra CSV-eksporten med <span className="mono">scripts/build_db.py</span> og <span className="mono">scripts/geocode.py</span>. Antall rader er faktiske tall fra lastingen.</>}>
        <div className="legend">
          <span><span className="k pk">PK</span> primærnøkkel</span>
          <span><span className="k fk">FK</span> fremmednøkkel</span>
          <span><span className="k h">HASH</span> endringsdeteksjon</span>
        </div>
        <div className="erd">
          {ENT.map(([name, desc, cols]) => (
            <div className="ent" key={name}>
              <div className="ent-head"><b>{name}</b><span>{fmtNum(ds.app.counts[name] ?? 0)} rader</span></div>
              <div className="cols">
                {cols.map(([c, t, k]) => (
                  <div className="col" key={c}>
                    <span>{c}</span><span className="ty">{t}</span>
                    {k ? <span className={`k ${KEY_CLASS[k]}`}>{k}</span> : <span />}
                  </div>
                ))}
              </div>
              <p className="desc">{desc}</p>
            </div>
          ))}
        </div>
      </Panel>
      <Panel span={6} id="hash-title" title="Hash-definisjoner">
        <pre className="code">{`content_hash = sha256(trim(text) | has_image)
row_hash     = sha256(category | district_id | municipality_id
                      | area | is_active | last_message_on)
input_hash   = sha256(content_hash for hver melding,
                      sortert på seq)`}</pre>
        <p className="note"><span className="mono">updated_on</span> og lastetidspunkt holdes utenfor. Ellers ville hver innlasting sett ut som en endring.</p>
      </Panel>
      <Panel span={6} id="flow-title" title="Inkrementell lasting">
        <ol className="flow">
          <li><b>Første lasting:</b> CSV-eksporten (alt fra mai 2023).</li>
          <li><b>Hvert 5.–10. minutt:</b> hent <span className="mono">/messagethreads</span> for siste time og beregn hashene.</li>
          <li><b>Lik content_hash:</b> oppdater bare <span className="mono">last_seen_at</span>.</li>
          <li><b>Ny content_hash:</b> lukk forrige versjon i <span className="mono">message_version</span> og skriv en ny.</li>
          <li><b>Ny input_hash:</b> klassifiser hendelsen på nytt. Ellers hoppes den over.</li>
          <li><b>Nytt område:</b> vask til <span className="mono">dim_area</span> og slå opp koordinater i <span className="mono">geo_area</span>.</li>
          <li><b>Hver natt:</b> sammenlign mot ny eksport. Det som mangler, får <span className="mono">is_removed = 1</span>.</li>
        </ol>
      </Panel>
      <Panel span={12} id="examples-title" title="Eksempelrader">
        <div className="tbl-wrap">
          {EXAMPLES.map((name) => {
            const cols = ENT.find((e) => e[0] === name)![2];
            const rows = ds.app.example[name] ?? [];
            return (
              <div key={name}>
                <h3 className="mono example-title">{name}</h3>
                <table>
                  <thead><tr>{cols.map((c) => <th scope="col" key={c[0]}>{c[0]}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>{r.map((v, j) => <td key={j} className="mono example-cell">{short(v)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
