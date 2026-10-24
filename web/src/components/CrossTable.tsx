import type { CrossTab } from "../lib/aggregate";
import { fmtNum, fmtPct } from "../lib/format";
import { RAMP_VARS, type Scheme } from "../lib/hooks";
import { tipHandlers, useTip } from "./Tooltip";

interface Props {
  data: CrossTab;
  categories: string[];
  columns: { code: string; name: string }[];
  selected: string;
  scheme: Scheme;
}

/** Politiets kategori (rader) mot våre overklasser (kolonner), farget etter andel av raden. */
export function CrossTable({ data, categories, columns, selected, scheme }: Props) {
  const tipApi = useTip();
  return (
    <div className="tbl-wrap">
      <table>
        <caption className="sr-only">Politiets kategori mot vår overklasse. Cellene viser antall hendelser, fargen viser andelen av raden.</caption>
        <thead>
          <tr>
            <th scope="col">Politiets kategori</th>
            <th scope="col" className="r">Hendelser</th>
            {columns.map((c) => (
              <th scope="col" key={c.code} className="r" style={c.code === selected ? { color: "var(--ink)" } : undefined}>{c.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.order.map((ci) => {
            const tot = data.rowTot[ci];
            return (
              <tr key={ci}>
                <th scope="row">{categories[ci]}</th>
                <td className="n">{fmtNum(tot)}</td>
                {columns.map((c, k) => {
                  const v = data.cells[ci][k], sh = tot ? v / tot : 0, st = v === 0 ? 0 : Math.min(7, 1 + Math.floor(sh * 6.999));
                  const ink = scheme === "dark" ? (st >= 6 ? "#0d1218" : "var(--ink)") : st >= 5 ? "var(--surface)" : "var(--ink)";
                  const h = tipHandlers(tipApi, () => <><b>{categories[ci]} → {c.name}</b><br />{fmtNum(v)} hendelser · {fmtPct(sh)} av raden</>);
                  return (
                    <td key={c.code} className="cell" style={{ background: RAMP_VARS[st], color: ink }}
                      onPointerMove={h.onPointerMove} onPointerLeave={h.onPointerLeave}>
                      {v ? fmtNum(v) : ""}
                      {v > 0 && <span className="sr-only"> ({fmtPct(sh)} av raden)</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
