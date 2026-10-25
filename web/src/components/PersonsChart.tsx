import { useState, type KeyboardEvent } from "react";
import { ageLabel, fmtNum, nice } from "../lib/format";
import { useWidth } from "../lib/hooks";
import { useTip } from "./Tooltip";

export const PERSON_SERIES = [
  { name: "Menn/gutter", color: "var(--series)" },
  { name: "Kvinner/jenter", color: "var(--series-2)" },
] as const;

interface Props {
  /** [menn, kvinner], hver med én verdi per aldersgruppe */
  counts: [number[], number[]];
  ages: string[];
}

/** Grupperte søyler: kjønn per aldersgruppe. Piltaster flytter mellom søylene. */
export function PersonsChart({ counts, ages }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>(500);
  const [active, setActive] = useState<[number, number] | null>(null);
  const tipApi = useTip();
  const W = Math.max(260, width), H = 200, m = { l: 40, r: 8, t: 10, b: 24 };
  const max = nice(Math.max(1, ...counts[0], ...counts[1]));
  const bw = (W - m.l - m.r) / ages.length, b = Math.max(4, Math.min(18, (bw - 10) / 2));
  const y = (v: number) => m.t + (H - m.t - m.b) * (1 - v / max);
  const x0 = (i: number, j: number) => m.l + bw * i + bw / 2 - b - 1 + j * (b + 2);

  const content = (i: number, j: number) => <><b>{PERSON_SERIES[j].name}, {ages[i] === "barn" ? "under 10 år" : ages[i]}</b><br />{fmtNum(counts[j][i])} omtalt</>;
  const showFocus = (i: number, j: number, svg: SVGSVGElement) => {
    setActive([i, j]);
    const r = svg.getBoundingClientRect();
    tipApi.show(content(i, j), r.left + ((x0(i, j) + b / 2) * r.width) / W, r.top + (y(counts[j][i]) * r.height) / H);
  };
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const flat = (active ? active[0] * 2 + active[1] : -1);
    const n = ages.length * 2;
    const next = e.key === "ArrowRight" ? flat + 1 : e.key === "ArrowLeft" ? flat - 1 : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (next == null) return;
    e.preventDefault();
    const f = Math.max(0, Math.min(n - 1, next));
    showFocus(Math.floor(f / 2), f % 2, e.currentTarget);
  };

  const total = counts[0].reduce((s, v) => s + v, 0) + counts[1].reduce((s, v) => s + v, 0);
  return (
    <div className="chart" ref={ref}>
      <svg
        viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" tabIndex={0}
        aria-label={`Omtalte personer etter alder og kjønn, ${fmtNum(total)} totalt. Bruk piltastene for verdier.`}
        onKeyDown={onKeyDown}
        onFocus={(e) => { if (e.currentTarget.matches(":focus-visible")) showFocus(active?.[0] ?? 1, active?.[1] ?? 0, e.currentTarget); }}
        onBlur={() => { setActive(null); tipApi.hide(); }}
        onPointerLeave={() => tipApi.hide()}
      >
        {[0, 1, 2, 3, 4].map((k) => {
          const v = (max * k) / 4;
          return (
            <g key={k}>
              <line className="grid-line" x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} />
              <text className="lbl" x={m.l - 8} y={y(v) + 4} textAnchor="end">{fmtNum(v)}</text>
            </g>
          );
        })}
        {ages.map((a, i) => (
          <g key={a}>
            {PERSON_SERIES.map((s, j) => {
              const v = counts[j][i], x = x0(i, j), top = y(v), h = Math.max(0, y(0) - top), rr = Math.min(4, h, b / 2);
              const isActive = active?.[0] === i && active?.[1] === j;
              return (
                <g key={s.name}>
                  <path
                    d={`M${x},${y(0)}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + b - rr}Q${x + b},${top} ${x + b},${top + rr}V${y(0)}Z`}
                    style={{ fill: s.color, stroke: isActive ? "var(--ink)" : "none" }} strokeWidth={1.5}
                  />
                  <rect
                    x={x - 1} y={m.t} width={b + 2} height={H - m.t - m.b} fill="transparent"
                    onPointerMove={(e) => tipApi.show(content(i, j), e.clientX, e.clientY)}
                  />
                </g>
              );
            })}
            <text className="lbl" x={m.l + bw * i + bw / 2} y={H - 6} textAnchor="middle">{ageLabel(a)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
