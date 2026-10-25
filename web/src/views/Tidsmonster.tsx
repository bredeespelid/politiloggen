import { useMemo } from "react";
import { BarList } from "../components/BarList";
import { LineChart } from "../components/LineChart";
import { Panel, RampLegend } from "../components/ui";
import { WeekHourHeatmap } from "../components/WeekHourHeatmap";
import { tname } from "../data/dataset";
import { inGeoText, seasonStats, weekHourGrid } from "../lib/aggregate";
import { MON, MONTH_FULL, fmtNum, fmtPct, pad2, WD } from "../lib/format";
import { ctx, type ViewProps } from "./types";

export default function Tidsmonster({ ds, sel, state }: ViewProps) {
  const { grid, tot } = useMemo(() => weekHourGrid(sel), [sel]);
  const season = useMemo(() => seasonStats(sel), [sel]);
  const max = Math.max(1, ...grid.flat());
  const days = WD.map((label, i) => ({ key: label, label, v: grid[i].reduce((a, b) => a + b, 0) }));
  const hours = Array.from({ length: 24 }, (_, h) => ({ h, v: grid.reduce((s, r) => s + r[h], 0), label: pad2(h) }));
  const share = (v: number) => fmtPct(tot ? v / tot : 0);
  const months = season.avg.map((v, i) => ({ v: Math.round(v * 10) / 10, label: MON[i], i }));
  const cls = tname(ds, state.cls).toLowerCase();

  return (
    <div className="grid">
      <Panel span={12} id="heat-title" title={`${tname(ds, state.cls)} · ukedag og klokkeslett`}
        lede={`${ctx(sel)}. Sum for hele perioden, norsk tid, når hendelsen ble opprettet i loggen.`}>
        <RampLegend from="Få" to={`Mange (maks ${fmtNum(max)} per celle)`} />
        <WeekHourHeatmap grid={grid} tot={tot} />
      </Panel>
      <Panel span={6} id="wd-title" title="Per ukedag">
        <BarList items={days} label="Hendelser per ukedag" tip={(i) => <><b>{i.label}</b><br />{fmtNum(i.v)} hendelser · {share(i.v)}</>} />
      </Panel>
      <Panel span={6} id="hour-title" title="Per time">
        <LineChart pts={hours} height={200} endDot={false} ariaLabel="Hendelser per time på døgnet"
          tip={(p) => <><b>kl. {p.label}–{pad2(p.h + 1)}</b><br />{fmtNum(p.v)} hendelser · {share(p.v)}</>} />
      </Panel>
      <Panel span={12} id="season-title" title="Sesong"
        lede={`Gjennomsnitt per måned for ${cls} ${inGeoText(sel.geo)}, ${season.fromYear}–${season.toYear}. ${season.mean ? `Flest i ${MONTH_FULL[season.hi]} (${fmtPct(season.avg[season.hi] / season.mean - 1)} over snittet), færrest i ${MONTH_FULL[season.lo]}.` : ""} Følger ikke periodevalget.`}>
        <LineChart pts={months} height={200} endDot={false} ariaLabel={`Gjennomsnitt per kalendermåned for ${cls}`}
          tip={(p) => <><b>{MONTH_FULL[p.i]}</b><br />{fmtNum(p.v)} i snitt per år<br />{season.cnt[p.i]} år med data</>} />
      </Panel>
    </div>
  );
}
