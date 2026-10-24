import { useMemo } from "react";
import { BarList } from "../components/BarList";
import { LineChart } from "../components/LineChart";
import { PERSON_SERIES, PersonsChart } from "../components/PersonsChart";
import { KpiRow, Panel, type KpiItem } from "../components/ui";
import { childrenOf, tname, topOf } from "../data/dataset";
import { kpiStats, monthlyTrend, outcomeItems, personCounts, subClassItems, topClassItems } from "../lib/aggregate";
import { fmtNum, fmtPct, mlabel } from "../lib/format";
import { ctx, type ViewProps } from "./types";

export default function Oversikt({ ds, sel, state, update }: ViewProps) {
  const cls = state.cls, top = topOf(ds, cls);
  const k = useMemo(() => kpiStats(sel), [sel]);
  const trend = useMemo(() => monthlyTrend(sel), [sel]);
  const classes = useMemo(() => (top === "*" ? topClassItems(sel) : subClassItems(sel, top)), [sel, top]);
  const outcomes = useMemo(() => outcomeItems(sel), [sel]);
  const persons = useMemo(() => personCounts(sel), [sel]);

  const p = sel.period;
  const bigI = k.perTop.indexOf(Math.max(...k.perTop));
  const kpis: KpiItem[] = [
    { k: `${tname(ds, cls)} · ${p.label}`, v: fmtNum(k.n), d: sel.geo.label },
    {
      k: "Endring mot året før",
      v: k.change == null ? "–" : `${k.change > 0 ? "+" : ""}${fmtPct(k.change)}`,
      d: p.prev ? `${fmtNum(k.prev ?? 0)} i perioden før` : "Ingen hel sammenligningsperiode",
    },
    cls === "*"
      ? { k: "Største klasse", v: k.tot ? tname(ds, ds.app.tops[bigI]) : "–", d: k.tot ? `${fmtPct(k.perTop[bigI] / k.tot)} av hendelsene` : "" }
      : { k: "Andel av alle hendelser", v: k.tot ? fmtPct(k.n / k.tot) : "–", d: `av ${fmtNum(k.tot)} hendelser` },
    cls === "*"
      ? { k: "Hendelser per dag", v: fmtNum(Math.round((k.n / Math.max(1, k.months * 30.4)) * 10) / 10), d: "snitt i perioden" }
      : { k: `${tname(ds, top)} utenfor politiets kategori`, v: k.inTop ? fmtPct(k.outside / k.inTop) : "–", d: `${fmtNum(k.outside)} av ${fmtNum(k.inTop)} · ${ds.app.classifier}` },
  ];

  const pts = trend.pts.map((x) => ({ ...x, label: mlabel(x.m) }));
  const hasKids = top !== "*" && childrenOf(ds, top).length > 0;

  return (
    <div className="grid">
      <KpiRow items={kpis} label="Nøkkeltall" />
      <Panel span={8} id="trend-title" title={`${tname(ds, cls)} per måned`}
        lede={`${ctx(sel)}.${trend.partialLast ? " Siste måned er ikke komplett (stiplet)." : ""}`}>
        <LineChart
          pts={pts} partialLast={trend.partialLast}
          ariaLabel={`${tname(ds, cls)} per måned, ${ctx(sel)}`}
          tip={(pt) => (
            <>
              <b>{pt.label}</b><br />{fmtNum(pt.v)} hendelser
              {cls !== "*" && <><br />{fmtPct(pt.v / Math.max(1, pt.t))} av alle</>}
              {pt.m === ds.last && <><br /><i>delvis måned</i></>}
            </>
          )}
        />
      </Panel>
      <Panel span={4} id="sub-title"
        title={top === "*" ? "Klasser" : `Underklasser · ${tname(ds, top)}`}
        lede={top === "*" ? "Vår inndeling i overklasser. Klikk for å velge." : "Én hendelse kan få flere underklasser, f.eks. ran med kniv."}>
        {top !== "*" && !hasKids ? (
          <p className="note">{tname(ds, top)} har ingen underklasser ennå.</p>
        ) : (
          <BarList
            items={classes} label={top === "*" ? "Overklasser" : "Underklasser"}
            onSelect={(i) => update({ cls: top === "*" ? i.code : i.code === cls ? top : i.code })}
            tip={(i) => <><b>{i.label}</b><br />{fmtNum(i.v)}<br /><i>{i.sel ? "Klikk for å fjerne valget" : "Klikk for å velge"}</i></>}
          />
        )}
      </Panel>
      <Panel span={6} id="outcomes-title" title="Utfall" lede="Hentet fra teksten: hva politiet gjorde.">
        <BarList items={outcomes} label="Utfall"
          tip={(i) => <><b>{i.label}</b><br />{fmtNum(i.v)} hendelser · {tname(ds, cls)}</>} />
      </Panel>
      <Panel span={6} id="persons-title" title="Hvem er omtalt"
        lede="Kjønn og aldersgruppe der teksten nevner det, f.eks. «mann i 20-årene».">
        <div className="legend">
          {PERSON_SERIES.map((s) => <span key={s.name}><span className="sw" style={{ background: s.color }} />{s.name}</span>)}
        </div>
        <PersonsChart counts={persons} ages={ds.app.ages} />
        <p className="note">Aldersgruppe (10 = 10-årene). {ctx(sel)}.</p>
      </Panel>
    </div>
  );
}
