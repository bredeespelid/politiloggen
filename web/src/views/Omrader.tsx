import { useMemo } from "react";
import { BarList } from "../components/BarList";
import { tipHandlers, useTip } from "../components/Tooltip";
import { KpiRow, Panel, type KpiItem } from "../components/ui";
import { areaLabel, muniName, tname } from "../data/dataset";
import { areaStats } from "../lib/aggregate";
import { ATYPE_NAME, fmtNum, fmtPct } from "../lib/format";
import { ctx, type ViewProps } from "./types";

export default function Omrader({ ds, sel, state, update }: ViewProps) {
  const tipApi = useTip();
  const a = useMemo(() => areaStats(sel), [sel]);
  const g = sel.geo, cls = tname(ds, state.cls), withCls = state.cls !== "*";

  const kpis: KpiItem[] = [
    { k: `${cls} · ${g.label}`, v: fmtNum(a.n), d: sel.period.label },
    { k: "Med oppgitt sted", v: a.n ? fmtPct((a.n - a.missing) / a.n) : "–", d: `${fmtNum(a.n - a.missing)} av ${fmtNum(a.n)}` },
    {
      k: "Plassert i bydel",
      v: g.hasBydel && g.kind === "m" ? (a.n ? fmtPct(a.mapped / a.n) : "–") : "–",
      d: g.hasBydel ? (g.kind === "m" ? `${fmtNum(a.mapped)} hendelser` : "valgt område er én bydel") : "Bydeler finnes for Oslo og Bergen",
    },
    { k: "Plassert på kartet", v: a.n ? fmtPct(a.located / a.n) : "–", d: `${fmtNum(a.located)} hendelser med kjent sted` },
  ];

  const types = a.types.map((t) => ({ ...t, label: ATYPE_NAME[t.label] ?? t.label }));
  const showMuni = g.kind === "all" || g.kind === "d";
  const maxTop = Math.max(1, ...a.top.map((t) => t.v));

  /** Leser hendelsene på et sted: åpner Hendelser med stedsnavnet som søk. */
  const openFeed = (name: string) => {
    update({ tab: "hendelser", q: name === "Sentrum" ? "" : name });
    scrollTo({ top: 0 });
  };

  return (
    <div className="grid">
      <KpiRow items={kpis} label="Nøkkeltall for steder" />
      <Panel span={5} id="a-type-title" title="Områdetype" lede={`${cls}, ${ctx(sel)}.`}>
        <BarList items={types} label="Områdetype"
          tip={(i) => <><b>{i.label}</b><br />{fmtNum(i.v)} hendelser · {fmtPct(a.n ? i.v / a.n : 0)}</>} />
        <p className="note">Typen settes ut fra teksten: veinummer og tunneler blir «vei», navn som slutter på -gata/-veien blir «gate», stasjoner blir «kollektiv» osv. Alt annet med stedsnavn blir «strøk».</p>
      </Panel>
      <Panel span={7} id="a-bydel-title" title={g.hasBydel ? `Bydeler i ${muniName(ds, g.k ?? 0)}` : "Bydeler"}
        lede={g.hasBydel ? `${cls}, ${sel.period.label}. Hold over en søyle for andelen av bydelens hendelser. Klikk for å velge bydel.` : undefined}>
        {g.hasBydel ? (
          <BarList
            items={a.bydeler} label="Bydeler"
            selectable={(i) => i.k > 0}
            onSelect={(i) => update({ geo: g.kind === "b" && i.k === g.b ? `m:${g.id}` : `b:${ds.app.bydeler[i.k - 1].join("|")}` })}
            tip={(i) => (
              <><b>{i.label}</b><br />{fmtNum(i.v)} av {fmtNum(i.all)} hendelser · {fmtPct(i.all ? i.v / i.all : 0)}
                {i.k > 0 && <><br /><i>Klikk for å velge</i></>}</>
            )}
          />
        ) : (
          <p className="note">Velg Oslo eller Bergen (eller en bydel der) for bydelsfordeling. Andre kommuner kobles til bydel/grunnkrets via koordinatene i neste versjon.</p>
        )}
      </Panel>
      <Panel span={12} id="a-top-title" title="Steder med flest hendelser" lede={`${cls}, ${ctx(sel)}. Klikk på et sted for å lese hendelsene.`}>
        {a.top.length ? (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Sted</th><th scope="col" className="hide-sm">Type</th>
                  {showMuni ? <th scope="col" className="hide-sm">Kommune</th> : g.hasBydel ? <th scope="col" className="hide-sm">Bydel</th> : null}
                  <th scope="col" className="r">Hendelser</th>
                  <th scope="col" className="hide-sm"><span className="sr-only">Søyle</span></th>
                  {withCls && <th scope="col" className="r">Andel av stedets hendelser</th>}
                </tr>
              </thead>
              <tbody>
                {a.top.map(({ a: id, row, v, all }) => {
                  const h = tipHandlers(tipApi, () => <><b>{row[0]}</b><br />{fmtNum(v)} av {fmtNum(all)} hendelser på stedet<br /><i>Klikk for å lese hendelsene</i></>);
                  return (
                    <tr key={id} className="drill" tabIndex={0} onClick={() => openFeed(row[0])}
                      onKeyDown={(e) => { if (e.key === "Enter") openFeed(row[0]); }}
                      onPointerMove={h.onPointerMove} onPointerLeave={h.onPointerLeave} onFocus={h.onFocus} onBlur={h.onBlur}>
                      <td>{areaLabel(row)}</td>
                      <td className="hide-sm"><span className="atype">{ATYPE_NAME[row[1]] ?? row[1]}</span></td>
                      {showMuni ? <td className="hide-sm">{muniName(ds, row[5])}</td> : g.hasBydel ? <td className="hide-sm">{row[2] || "–"}</td> : null}
                      <td className="n">{fmtNum(v)}</td>
                      <td className="bar-cell hide-sm" aria-hidden="true"><span style={{ width: `${((v / maxTop) * 100).toFixed(1)}%` }} /></td>
                      {withCls && <td className="n">{fmtPct(all ? v / all : 0)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="note">Ingen treff i utvalget.</p>}
      </Panel>
    </div>
  );
}
