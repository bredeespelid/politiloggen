import { useMemo } from "react";
import { BarList } from "../components/BarList";
import { tipHandlers, useTip } from "../components/Tooltip";
import { KpiRow, Panel, type KpiItem } from "../components/ui";
import { muniName, tname } from "../data/dataset";
import { areaStats } from "../lib/aggregate";
import { ATYPE_NAME, fmtNum, fmtPct } from "../lib/format";
import { ctx, type ViewProps } from "./types";

export default function Omrader({ ds, sel, state, update }: ViewProps) {
  const tipApi = useTip();
  const a = useMemo(() => areaStats(sel), [sel]);
  const g = sel.geo, cls = tname(ds, state.cls);

  const kpis: KpiItem[] = [
    { k: `${cls} · ${g.label}`, v: fmtNum(a.n), d: sel.period.label },
    { k: "Med område", v: a.n ? fmtPct((a.n - a.missing) / a.n) : "–", d: `${fmtNum(a.n - a.missing)} av ${fmtNum(a.n)}` },
    {
      k: "Koblet til bydel",
      v: g.hasBydel ? (a.n ? fmtPct(a.mapped / a.n) : "–") : "–",
      d: g.hasBydel ? `${fmtNum(a.mapped)} hendelser` : "Bydeler finnes for Oslo og Bergen",
    },
    { k: "Råverdier → nøkler", v: fmtNum(ds.app.distinctAreas.raw), d: `blir ${fmtNum(ds.app.distinctAreas.keys)} nøkler i dim_area (hele landet)` },
  ];

  const types = a.types.map((t) => ({ ...t, label: ATYPE_NAME[t.label] ?? t.label }));
  const showMuni = g.kind === "all" || g.kind === "d";
  const maxTop = Math.max(1, ...a.top.map((t) => t.v));
  const variantMuni = g.id && ds.app.variants[g.id] ? g.id : "0301";
  const variants = ds.app.variants[variantMuni] ?? [];

  return (
    <div className="grid">
      <KpiRow items={kpis} label="Nøkkeltall for områder" />
      <Panel span={5} id="a-type-title" title="Områdetype" lede={`${cls}, ${ctx(sel)}.`}>
        <BarList items={types} label="Områdetype"
          tip={(i) => <><b>{i.label}</b><br />{fmtNum(i.v)} hendelser · {fmtPct(a.n ? i.v / a.n : 0)}</>} />
        <p className="note">Typen settes ut fra teksten: veinummer og tunneler blir «vei», navn som slutter på -gata/-veien blir «gate», stasjoner blir «kollektiv» osv. Alt annet med stedsnavn blir «strøk».</p>
      </Panel>
      <Panel span={7} id="a-bydel-title" title={g.hasBydel ? `Bydeler i ${muniName(ds, g.k ?? 0)}` : "Bydeler"}
        lede={g.hasBydel ? `${cls}, ${sel.period.label}. Hold over en søyle for andelen av bydelens hendelser.` : undefined}>
        {g.hasBydel ? (
          <BarList
            items={a.bydeler} label="Bydeler"
            selectable={(i) => i.k > 0}
            onSelect={(i) => update({ geo: g.kind === "b" && i.k === g.b ? `m:${g.id}` : `b:${ds.app.bydeler[i.k - 1].join("|")}` })}
            tip={(i) => (
              <><b>{i.label}</b><br />{fmtNum(i.v)} av {fmtNum(i.all)} hendelser · {fmtPct(i.all ? i.v / i.all : 0)}
                {i.k > 0 && <><br /><i>{i.sel ? "Klikk for hele kommunen" : "Klikk for å velge"}</i></>}</>
            )}
          />
        ) : (
          <p className="note">Velg Oslo eller Bergen (eller en bydel der) for bydelsfordeling. Andre kommuner kobles til bydel/grunnkrets via koordinatene i neste versjon.</p>
        )}
      </Panel>
      <Panel span={7} id="a-top-title" title="Mest brukte områder" lede={`${cls}, ${ctx(sel)}.`}>
        {a.top.length ? (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Område</th><th scope="col">Type</th>
                  {showMuni ? <th scope="col">Kommune</th> : g.hasBydel ? <th scope="col">Bydel</th> : null}
                  <th scope="col" className="r">Hendelser</th><th scope="col"><span className="sr-only">Søyle</span></th><th scope="col" className="r">Andel</th>
                </tr>
              </thead>
              <tbody>
                {a.top.map(({ a: id, row, v, all }) => {
                  const h = tipHandlers(tipApi, () => <><b>{row[0]}</b><br />nøkkel: {row[6]}<br />{fmtNum(v)} av {fmtNum(all)} hendelser i området</>);
                  return (
                  <tr key={id} onPointerMove={h.onPointerMove} onPointerLeave={h.onPointerLeave}>
                    <td>{row[0]}</td>
                    <td><span className="atype">{ATYPE_NAME[row[1]] ?? row[1]}</span></td>
                    {showMuni ? <td>{muniName(ds, row[5])}</td> : g.hasBydel ? <td>{row[2] || "–"}</td> : null}
                    <td className="n">{fmtNum(v)}</td>
                    <td className="bar-cell" aria-hidden="true"><span style={{ width: `${((v / maxTop) * 100).toFixed(1)}%` }} /></td>
                    <td className="n" title="Andel av alle hendelser i området">{fmtPct(all ? v / all : 0)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="note">Ingen treff i utvalget.</p>}
      </Panel>
      <Panel span={5} id="a-variants-title" title="Slik vaskes feltet" lede="Råverdier fra politiet → én nøkkel per sted. Ulike skrivemåter av samme sted samles.">
        <div className="tbl-wrap">
          {variantMuni !== g.id && <p className="note">Eksempler fra Oslo. Velg en av de 24 største kommunene for lokale eksempler.</p>}
          <table>
            <thead><tr><th scope="col">Råverdier</th><th scope="col">Nøkkel</th></tr></thead>
            <tbody>
              {variants.map(([key, raws]) => (
                <tr key={key}>
                  <td className="wrap">{raws.map((r) => <span key={r} className="tag p raw">{r}</span>)}</td>
                  <td className="mono">{key}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
