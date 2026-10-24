import { useMemo } from "react";
import { Panel } from "../components/ui";
import { tname } from "../data/dataset";
import { filterSamples } from "../lib/aggregate";
import { fmtDate } from "../lib/format";
import type { ViewProps } from "./types";

const SHOW = 60;

export default function Hendelser({ ds, sel, state }: ViewProps) {
  const items = useMemo(() => filterSamples(ds, sel.geo, state.cls), [ds, sel.geo, state.cls]);
  return (
    <div className="grid">
      <Panel span={12} id="feed-title" title="Siste hendelser"
        lede={`${items.length} hendelser i utvalget (${tname(ds, state.cls)}, ${sel.geo.label}). Prototypen har med de siste hendelsene nasjonalt og de siste 80 per stor kommune.`}>
        {items.length ? (
          <div className="feed">
            {items.slice(0, SHOW).map((s) => (
              <article className="item" key={s.id} aria-label={[s.area, s.municipality].filter(Boolean).join(", ") || s.category}>
                <div className="meta">
                  <span className="where">{[s.area, s.municipality].filter(Boolean).join(", ")}</span>
                  <span>{s.category}</span>
                  <time dateTime={s.created}>{fmtDate(s.created)}</time>
                  <span className="mono">{s.id}</span>
                  {s.messages > 1 && <span>{s.messages} meldinger</span>}
                  {s.active && <span className="live">Pågår</span>}
                </div>
                <p>{s.text}</p>
                <div className="tags">
                  {s.classes.map((x) => <span key={x} className="tag c">{tname(ds, x)}</span>)}
                  {s.weapon && <span className="tag">våpen: {s.weapon}</span>}
                  {s.outcome.map((o) => <span key={o} className="tag">{o}</span>)}
                  {s.persons.map((pp, i) => <span key={i} className="tag p">{pp.kjønn} · {pp.alder}</span>)}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="note">Ingen av hendelsene i prototypen passer filteret. Prøv en bredere klasse eller et større område.</p>
        )}
      </Panel>
    </div>
  );
}
