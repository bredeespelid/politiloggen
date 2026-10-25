import { useMemo } from "react";
import { Panel } from "../components/ui";
import { bydelName, tname } from "../data/dataset";
import { eventCount, filterSamples } from "../lib/aggregate";
import { fmtDate, fmtNum } from "../lib/format";
import type { ViewProps } from "./types";

const SHOW = 60;

export default function Hendelser({ ds, sel, state, update }: ViewProps) {
  const { geo, period: p } = sel;
  const items = useMemo(() => filterSamples(ds, geo, state.cls, state.q, p), [ds, geo, state.cls, state.q, p]);
  const q = state.q.trim().toLowerCase();
  const all = useMemo(() => eventCount(sel), [sel]);
  return (
    <div className="grid">
      <Panel span={12} id="feed-title" title="Siste hendelser (utvalg)"
        lede={`Viser ${fmtNum(items.length)} av ${fmtNum(all)} hendelser (${tname(ds, state.cls)}, ${geo.label}, ${p.label}${q ? `, søk «${q}»` : ""}). Utvalget er de nyeste hendelsene per kommune og sted, så eldre hendelser mangler. Tallene i de andre fanene bygger på alle hendelser.`}>
        <label className="search">Søk i teksten
          <input type="search" value={state.q} placeholder="F.eks. kniv, Grønland, promille" autoComplete="off"
            onChange={(e) => update({ q: e.target.value })} />
        </label>
        {items.length ? (
          <div className="feed">
            {items.slice(0, SHOW).map((s) => {
              const where = [s.area, s.b ? bydelName(ds, s.b) : null, s.municipality].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(", ");
              return (
                <article className="item" key={s.id} aria-label={where || s.category}>
                  <div className="meta">
                    <span className="where">{where}</span>
                    <span>{s.category}</span>
                    <time dateTime={s.created}>{fmtDate(s.created)}</time>
                    <span className="mono">{s.id}</span>
                    {s.messages > 1 && <span>{s.messages} meldinger</span>}
                    {s.active && <span className="live">Pågår</span>}
                  </div>
                  <p>{s.text}</p>
                  {s.update && <p className="update"><b>Siste oppdatering:</b> {s.update}</p>}
                  <div className="tags">
                    {s.classes.map((x) => <span key={x} className="tag c">{tname(ds, x)}</span>)}
                    {s.weapon && <span className="tag">våpen: {s.weapon}</span>}
                    {s.outcome.filter((o) => !s.classes.some((x) => tname(ds, x).toLowerCase() === o)).map((o) => <span key={o} className="tag">{o}</span>)}
                    {s.persons.map((pp, i) => <span key={i} className="tag p">{pp.kjønn} · {pp.alder}</span>)}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="note">Ingen av hendelsene i prototypen passer filteret. Prøv en bredere type, et større område eller en lengre periode.</p>
        )}
      </Panel>
    </div>
  );
}
