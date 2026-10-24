import { useMemo } from "react";
import { BarList } from "../components/BarList";
import { LineChart } from "../components/LineChart";
import { Panel, RampLegend } from "../components/ui";
import { WeekHourHeatmap } from "../components/WeekHourHeatmap";
import { tname } from "../data/dataset";
import { weekHourGrid } from "../lib/aggregate";
import { fmtNum, fmtPct, pad2, WD } from "../lib/format";
import { ctx, type ViewProps } from "./types";

export default function Tidsmonster({ ds, sel, state }: ViewProps) {
  const { grid, tot } = useMemo(() => weekHourGrid(sel), [sel]);
  const max = Math.max(1, ...grid.flat());
  const days = WD.map((label, i) => ({ key: label, label, v: grid[i].reduce((a, b) => a + b, 0) }));
  const hours = Array.from({ length: 24 }, (_, h) => ({ h, v: grid.reduce((s, r) => s + r[h], 0), label: pad2(h) }));
  const share = (v: number) => fmtPct(tot ? v / tot : 0);

  return (
    <div className="grid">
      <Panel span={12} id="heat-title" title={`${tname(ds, state.cls)} · ukedag og klokkeslett`}
        lede={`${ctx(sel)}. Norsk tid, når hendelsen ble opprettet i loggen.`}>
        <RampLegend from="Få" to={`Mange (maks ${fmtNum(max)} per celle)`} />
        <WeekHourHeatmap grid={grid} tot={tot} />
      </Panel>
      <Panel span={6} id="wd-title" title="Per ukedag">
        <BarList items={days} label="Hendelser per ukedag" tip={(i) => <><b>{i.label}</b><br />{fmtNum(i.v)} hendelser · {share(i.v)}</>} />
      </Panel>
      <Panel span={6} id="hour-title" title="Per time">
        <LineChart pts={hours} height={200} ariaLabel="Hendelser per time på døgnet"
          tip={(p) => <><b>kl. {p.label}–{pad2(p.h + 1)}</b><br />{fmtNum(p.v)} hendelser · {share(p.v)}</>} />
      </Panel>
    </div>
  );
}
