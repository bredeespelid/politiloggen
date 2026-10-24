import { useState, type KeyboardEvent } from "react";
import { fmtNum, fmtPct, pad2, WD } from "../lib/format";
import { RAMP_VARS, useWidth } from "../lib/hooks";
import { useTip } from "./Tooltip";

interface Props {
  grid: number[][];
  tot: number;
}

/** Trinn i fargeskalaen (kvadratrot, så få hendelser fortsatt synes). */
export const heatStep = (v: number, max: number): number => (v === 0 ? 0 : Math.min(7, 1 + Math.floor(Math.sqrt(v / max) * 6.999)));

/** Varmekart ukedag × time. Piltaster flytter mellom cellene. */
export function WeekHourHeatmap({ grid, tot }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>(800);
  const [active, setActive] = useState<[number, number] | null>(null);
  const tipApi = useTip();
  const max = Math.max(1, ...grid.flat());
  const W = Math.max(320, width), narrow = W < 520;
  const lw = narrow ? 34 : 70, cw = (W - lw - 4) / 24, ch = Math.max(16, Math.min(30, cw * 1.1)), H = ch * 7 + 22;

  const content = (wd: number, h: number) => (
    <><b>{WD[wd]} kl. {pad2(h)}–{pad2(h + 1)}</b><br />{fmtNum(grid[wd][h])} hendelser · {fmtPct(tot ? grid[wd][h] / tot : 0)}</>
  );
  const showFocus = (wd: number, h: number, svg: SVGSVGElement) => {
    setActive([wd, h]);
    const r = svg.getBoundingClientRect();
    tipApi.show(content(wd, h), r.left + ((lw + (h + 0.5) * cw) * r.width) / W, r.top + ((wd + 1) * ch * r.height) / H);
  };
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const [wd, h] = active ?? [0, 0];
    const moves: Record<string, [number, number]> = {
      ArrowRight: [wd, h + 1], ArrowLeft: [wd, h - 1], ArrowDown: [wd + 1, h], ArrowUp: [wd - 1, h], Home: [wd, 0], End: [wd, 23],
    };
    const next = moves[e.key];
    if (!next) return;
    e.preventDefault();
    showFocus(Math.max(0, Math.min(6, next[0])), Math.max(0, Math.min(23, next[1])), e.currentTarget);
  };

  return (
    <div className="chart" ref={ref}>
      <svg
        viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" tabIndex={0}
        aria-label={`Varmekart over hendelser per ukedag og time, maks ${fmtNum(max)} i én celle. Bruk piltastene for verdier.`}
        onKeyDown={onKeyDown}
        onFocus={(e) => { if (e.currentTarget.matches(":focus-visible")) showFocus(active?.[0] ?? 0, active?.[1] ?? 0, e.currentTarget); }}
        onBlur={() => { setActive(null); tipApi.hide(); }}
        onPointerLeave={() => tipApi.hide()}
      >
        {grid.map((row, wd) => (
          <g key={wd}>
            <text className="lbl" x={lw - 8} y={wd * ch + ch / 2 + 4} textAnchor="end">{narrow ? WD[wd].slice(0, 2) : WD[wd]}</text>
            {row.map((v, h) => (
              <rect
                key={h} x={lw + h * cw + 1} y={wd * ch + 1} width={Math.max(0, cw - 2)} height={ch - 2} rx={3}
                style={{ fill: RAMP_VARS[heatStep(v, max)], stroke: active?.[0] === wd && active?.[1] === h ? "var(--ink)" : "none" }}
                strokeWidth={2}
                onPointerMove={(e) => tipApi.show(content(wd, h), e.clientX, e.clientY)}
              />
            ))}
          </g>
        ))}
        {Array.from({ length: 24 }, (_, h) => h).filter((h) => h % (narrow ? 6 : 3) === 0).map((h) => (
          <text key={h} className="lbl" x={lw + h * cw + cw / 2} y={7 * ch + 15} textAnchor="middle">{pad2(h)}</text>
        ))}
      </svg>
    </div>
  );
}
