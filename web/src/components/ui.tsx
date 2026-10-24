import type { ReactNode } from "react";
import { RAMP_VARS } from "../lib/hooks";

export interface KpiItem {
  k: string;
  v: string;
  d: string;
}

export function KpiRow({ items, label }: { items: KpiItem[]; label: string }) {
  return (
    <div className="kpis span-12" role="group" aria-label={label}>
      {items.map((x) => (
        <div className="kpi" key={x.k}>
          <span className="k">{x.k}</span>
          <span className="v">{x.v}</span>
          <span className="d">{x.d}</span>
        </div>
      ))}
    </div>
  );
}

interface SegProps<T extends string> {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}

/** Segmentert knappegruppe (ett valg). */
export function Segmented<T extends string>({ label, value, options, onChange }: SegProps<T>) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

export function Panel({ span, title, lede, children, className, id }: {
  span: 4 | 5 | 6 | 7 | 8 | 12; title: ReactNode; lede?: ReactNode; children?: ReactNode; className?: string; id?: string;
}) {
  return (
    <section className={`panel span-${span}${className ? ` ${className}` : ""}`} aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {lede ? <p className="lede">{lede}</p> : null}
      {children}
    </section>
  );
}

/** Fargeskala-forklaring. */
export function RampLegend({ from, to, steps = RAMP_VARS, extra }: { from: string; to: string; steps?: string[]; extra?: string }) {
  return (
    <div className="legend">
      <span>{from}</span>
      <span className="ramp" aria-hidden="true">{steps.map((c) => <i key={c} style={{ background: c }} />)}</span>
      <span>{to}</span>
      {extra ? <span>{extra}</span> : null}
    </div>
  );
}
