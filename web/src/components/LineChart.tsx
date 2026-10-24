import { useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { fmtNum, nice } from "../lib/format";
import { useWidth } from "../lib/hooks";
import { useTip } from "./Tooltip";

export interface LinePoint {
  label: string;
  v: number;
}

interface Props<P extends LinePoint> {
  pts: P[];
  ariaLabel: string;
  height?: number;
  /** Siste punkt er en ufullstendig periode og tegnes stiplet. */
  partialLast?: boolean;
  /** Liten variant uten akser (small multiples). */
  mini?: boolean;
  tip?: (p: P, i: number) => ReactNode;
}

/** Linjediagram med flate, trådkors og tooltip (mus og piltaster). */
export function LineChart<P extends LinePoint>({ pts, ariaLabel, height = 240, partialLast = false, mini = false, tip }: Props<P>) {
  const [ref, width] = useWidth<HTMLDivElement>(mini ? 200 : 600);
  const [active, setActive] = useState<number | null>(null);
  const tipApi = useTip();

  const W = Math.max(mini ? 120 : 260, width), H = mini ? 54 : height;
  const m = mini ? { l: 2, r: 6, t: 6, b: 4 } : { l: 44, r: 14, t: 12, b: 26 };
  const max = nice(Math.max(1, ...pts.map((p) => p.v)));
  const span = W - m.l - m.r;
  const x = (i: number) => m.l + (pts.length < 2 ? 0 : (i * span) / (pts.length - 1));
  const y = (v: number) => m.t + (H - m.t - m.b) * (1 - v / max);

  const solid = partialLast ? pts.slice(0, -1) : pts;
  const line = solid.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const area = solid.length ? `${line}L${x(solid.length - 1)},${y(0)}L${x(0)},${y(0)}Z` : "";
  const li = solid.length - 1;

  const ticks: ReactNode[] = [];
  if (!mini) {
    for (let k = 0; k <= 4; k++) {
      const v = (max * k) / 4;
      ticks.push(
        <g key={`y${k}`}>
          <line className="grid-line" x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} />
          <text className="lbl" x={m.l - 8} y={y(v) + 4} textAnchor="end">{fmtNum(v)}</text>
        </g>,
      );
    }
    const step = Math.max(1, Math.ceil(pts.length / Math.max(2, Math.floor(span / 64))));
    pts.forEach((p, i) => {
      if (i % step === 0) ticks.push(<text key={`x${i}`} className="lbl" x={x(i)} y={H - 6} textAnchor="middle">{p.label}</text>);
    });
  }

  const showAt = (i: number, svg: SVGSVGElement, cx?: number, cy?: number) => {
    setActive(i);
    if (!tip) return;
    const r = svg.getBoundingClientRect();
    tipApi.show(tip(pts[i], i), cx ?? r.left + (x(i) * r.width) / W, cy ?? r.top + (y(pts[i].v) * r.height) / H);
  };
  const clear = () => { setActive(null); tipApi.hide(); };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!pts.length) return;
    const r = e.currentTarget.getBoundingClientRect(), px = ((e.clientX - r.left) * W) / r.width;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round((px - m.l) / (span / Math.max(1, pts.length - 1)))));
    showAt(i, e.currentTarget, e.clientX, e.clientY);
  };
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!pts.length) return;
    const cur = active ?? pts.length - 1;
    const next = e.key === "ArrowLeft" ? cur - 1 : e.key === "ArrowRight" ? cur + 1 : e.key === "Home" ? 0 : e.key === "End" ? pts.length - 1 : null;
    if (next == null) return;
    e.preventDefault();
    showAt(Math.max(0, Math.min(pts.length - 1, next)), e.currentTarget);
  };

  return (
    <div className="chart" ref={ref}>
      <svg
        viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
        aria-label={tip ? `${ariaLabel}. Bruk piltastene for verdier.` : ariaLabel}
        tabIndex={tip ? 0 : undefined}
        onPointerMove={tip ? onPointerMove : undefined}
        onPointerLeave={tip ? clear : undefined}
        onKeyDown={tip ? onKeyDown : undefined}
        onFocus={tip ? (e) => { if (e.currentTarget.matches(":focus-visible")) showAt(active ?? pts.length - 1, e.currentTarget); } : undefined}
        onBlur={tip ? clear : undefined}
      >
        {ticks}
        <path d={area} style={{ fill: "var(--series-fill)" }} />
        <path d={line} fill="none" style={{ stroke: "var(--series)" }} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {partialLast && pts.length > 1 && (
          <path
            d={`M${x(pts.length - 2)},${y(pts[pts.length - 2].v)}L${x(pts.length - 1)},${y(pts[pts.length - 1].v)}`}
            style={{ stroke: "var(--series)" }} strokeWidth={2} strokeDasharray="3 3" fill="none"
          />
        )}
        {li >= 0 && <circle cx={x(li)} cy={y(solid[li].v)} r={mini ? 3 : 4} style={{ fill: "var(--series)", stroke: "var(--surface)" }} strokeWidth={2} />}
        {active != null && pts[active] && (
          <g pointerEvents="none">
            <line x1={x(active)} x2={x(active)} y1={m.t} y2={H - m.b} style={{ stroke: "var(--muted)" }} strokeWidth={1} strokeDasharray="2 3" />
            <circle cx={x(active)} cy={y(pts[active].v)} r={4} style={{ fill: "var(--series)", stroke: "var(--surface)" }} strokeWidth={2} />
          </g>
        )}
        <rect x={m.l} y={0} width={Math.max(0, span)} height={H} fill="transparent" />
      </svg>
    </div>
  );
}
