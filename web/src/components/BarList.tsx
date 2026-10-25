import type { ReactNode } from "react";
import type { BarItem } from "../lib/aggregate";
import { fmtNum } from "../lib/format";
import { tipHandlers, useTip } from "./Tooltip";

interface Props<T extends BarItem> {
  items: T[];
  label: string;
  fmt?: (v: number) => string;
  tip?: (item: T) => ReactNode;
  onSelect?: (item: T) => void;
  /** Om en rad kan velges (standard: alle når onSelect er satt). */
  selectable?: (item: T) => boolean;
  empty?: ReactNode;
}

/** Horisontale søyler. Valgbare rader er knapper, så de kan brukes med tastatur. */
export function BarList<T extends BarItem>({ items, label, fmt = fmtNum, tip, onSelect, selectable, empty }: Props<T>) {
  const tipApi = useTip();
  if (!items.length) return <p className="note">{empty ?? "Ingen treff i utvalget."}</p>;
  const max = Math.max(1, ...items.map((i) => i.v));
  const anySel = items.some((i) => i.sel);
  return (
    <ul className="bars" aria-label={label}>
      {items.map((i) => {
        const cls = `bar-row${i.sel ? " sel" : ""}${anySel || i.dim ? " dim" : ""}`;
        const content = () => tip?.(i) ?? <><b>{i.label}</b><br />{fmt(i.v)}</>;
        const handlers = tipHandlers(tipApi, content);
        const inner = (
          <>
            <span className="name" title={i.label}>{i.label}</span>
            <span className="bar-track" aria-hidden="true">
              <span className="bar-fill" style={{ width: `${((i.v / max) * 100).toFixed(1)}%` }} />
            </span>
            <span className="val">{fmt(i.v)}</span>
          </>
        );
        const canSelect = onSelect && (selectable ? selectable(i) : true);
        return (
          <li key={i.key}>
            {canSelect ? (
              <button type="button" className={cls} aria-pressed={i.sel ? true : undefined} onClick={() => onSelect(i)} {...handlers}>
                {inner}
              </button>
            ) : (
              <div className={cls} onPointerMove={handlers.onPointerMove} onPointerLeave={handlers.onPointerLeave}>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
