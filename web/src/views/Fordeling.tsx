import { useMemo } from "react";
import { BarList } from "../components/BarList";
import { LineChart } from "../components/LineChart";
import { Panel, Segmented } from "../components/ui";
import { tname } from "../data/dataset";
import { distribution, MIN_SAMPLE, nationalRate, type DistMode, type FLevel } from "../lib/aggregate";
import { fmt1, fmtNum, fmtPct, mlabel } from "../lib/format";
import type { ViewProps } from "./types";

const LEVEL_OPTIONS = [["bydel", "Bydeler"], ["sted", "Steder (Grønland osv.)"]] as const;
const MODE_LABEL: Record<DistMode, string> = { pop: "Per 1 000 innbyggere", share: "Andel av områdets hendelser", abs: "Antall" };

export default function Fordeling({ ds, sel, state, update }: ViewProps) {
  const d = useMemo(() => distribution(sel, state.dmode), [sel, state.dmode]);
  const natRate = useMemo(() => (d.mode === "pop" ? nationalRate(sel) : 0), [sel, d.mode]);
  const { level: L, mode } = d;
  const fmt = mode === "share" ? fmtPct : mode === "pop" ? fmt1 : fmtNum;
  const multiples = d.items.filter((i) => !i.none).slice(0, 12);
  const labels = d.months.map(mlabel);

  const note = [
    L.note,
    d.unplaced != null && d.total ? `${fmtNum(d.unplaced)} hendelser (${fmtPct(d.unplaced / d.total)}) er ${L.places ? "uten oppgitt sted" : "uten bydel"}.` : "",
    mode === "pop"
      ? `Per innbygger: hendelser per år delt på folketall (SSB ${ds.app.populationYear}). Snittet for hele landet er ${fmt1(natRate)}. Kommuner med mange besøkende, som byer med uteliv, får høye tall.`
      : "",
    d.hasLow ? `Lysere søyler bygger på under ${MIN_SAMPLE} hendelser og er usikre.` : "",
  ].filter(Boolean).join(" ");

  return (
    <div className="grid">
      <Panel span={5} id="f-title" title={L.title} lede={`${tname(ds, state.cls)}, ${sel.period.label}.`}>
        {sel.geo.kind === "m" && sel.geo.hasBydel && (
          <Segmented<FLevel> label="Nivå" value={state.flevel} options={LEVEL_OPTIONS} onChange={(flevel) => update({ flevel })} />
        )}
        {d.modes.length > 1 && (
          <Segmented<DistMode> label="Måltall" value={mode} options={d.modes.map((m) => [m, MODE_LABEL[m]] as const)} onChange={(dmode) => update({ dmode })} />
        )}
        <BarList
          items={d.items} label={L.title} fmt={fmt}
          selectable={(i) => L.geo(i.k) != null}
          onSelect={(i) => { const g = L.geo(i.k); if (g) update({ geo: g }); }}
          tip={(i) => (
            <>
              <b>{i.label}</b><br />{fmtNum(i.n)} hendelser{state.cls !== "*" && ` av ${fmtNum(i.t)} totalt (${fmtPct(i.t ? i.n / i.t : 0)})`}
              {i.pop ? <><br />{fmt1((i.n / d.years / i.pop) * 1000)} per 1 000 innbyggere per år</> : null}
              {i.low && <><br /><i>Lite grunnlag – under {MIN_SAMPLE} hendelser</i></>}
              {L.geo(i.k) && <><br /><i>Klikk for å velge</i></>}
            </>
          )}
        />
        {note && <p className="note">{note}</p>}
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
