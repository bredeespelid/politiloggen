import { useMemo } from "react";
import { BarList } from "../components/BarList";
import { LineChart } from "../components/LineChart";
import { Panel, Segmented } from "../components/ui";
import { tname } from "../data/dataset";
import { distribution, type DistMode } from "../lib/aggregate";
import { fmtNum, fmtPct, mlabel } from "../lib/format";
import type { ViewProps } from "./types";

const MODES = [["share", "Andel av egne hendelser"], ["abs", "Antall"]] as const;

export default function Fordeling({ ds, sel, state, update }: ViewProps) {
  const d = useMemo(() => distribution(sel, state.dmode), [sel, state.dmode]);
  const { level: L, mode } = d;
  const fmt = mode === "share" ? fmtPct : fmtNum;
  const multiples = d.items.filter((i) => i.known).slice(0, 12);
  const labels = d.months.map(mlabel);

  return (
    <div className="grid">
      <Panel span={5} id="f-title" title={L.title} lede={`${tname(ds, state.cls)}, ${sel.period.label}.`}>
        {state.cls !== "*" && (
          <Segmented<DistMode> label="Måltall" value={mode} options={MODES} onChange={(dmode) => update({ dmode })} />
        )}
        <BarList
          items={d.items} label={L.title} fmt={fmt}
          selectable={(i) => L.geo(i.k) != null}
          onSelect={(i) => { const g = L.geo(i.k); if (g) update({ geo: g }); }}
          tip={(i) => (
            <>
              <b>{i.label}</b><br />{fmtNum(i.n)} av {fmtNum(i.t)} hendelser<br />{fmtPct(i.t ? i.n / i.t : 0)}
              {L.geo(i.k) && <><br /><i>Klikk for å velge</i></>}
            </>
          )}
        />
        {L.note && <p className="note">{L.note}</p>}
      </Panel>
      <Panel span={7} id="mults-title" title="Utvikling" lede="Hver graf har sin egen skala. Sammenlign formen, ikke nivået.">
        {multiples.length ? (
          <div className="multiples">
            {multiples.map((i) => {
              const s = d.series.get(i.k) ?? new Array<number>(labels.length).fill(0);
              return (
                <div className="mult" key={i.k}>
                  <div className="t"><span>{i.label}</span><b>{fmtNum(i.n)}</b></div>
                  <LineChart
                    mini partialLast={d.partialLast}
                    pts={s.map((v, j) => ({ v, label: labels[j] }))}
                    ariaLabel={`${i.label}: ${tname(ds, state.cls)} per måned`}
                    tip={(pt) => <><b>{i.label} · {pt.label}</b><br />{fmtNum(pt.v)} hendelser</>}
                  />
                </div>
              );
            })}
          </div>
        ) : <p className="note">Ingen treff i utvalget.</p>}
      </Panel>
    </div>
  );
}
