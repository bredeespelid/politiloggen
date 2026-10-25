import { useMemo } from "react";
import { BarList } from "../components/BarList";
import { CrossTable } from "../components/CrossTable";
import { Panel, RampLegend } from "../components/ui";
import { childrenOf, muniName, tname, topOf } from "../data/dataset";
import { crossTab, taxonomyCounts } from "../lib/aggregate";
import { fmtNum } from "../lib/format";
import { ctx, type ViewProps } from "./types";

export default function Klassifisering({ ds, sel, state, scheme }: ViewProps) {
  const cross = useMemo(() => crossTab(sel), [sel]);
  const tax = useMemo(() => taxonomyCounts(sel), [sel]);
  const selTop = topOf(ds, state.cls);
  const columns = ds.app.tops.map((code) => ({ code, name: tname(ds, code) }));
  const g = sel.geo;
  const variantMuni = g.id && ds.app.variants[g.id] ? g.id : "0301";
  const variants = ds.app.variants[variantMuni] ?? [];

  return (
    <div className="grid">
      <Panel span={12} id="cross-title" title="Politiets kategori sammenlignet med vår inndeling"
        lede={`Rader er politiets kategorier, kolonner er overklassene i vår taksonomi. Fargen viser andelen av radens hendelser. ${ctx(sel)}.`}>
        <RampLegend from="0 %" to="100 % av raden" extra="Én hendelse kan havne i flere kolonner." />
        <CrossTable data={cross} categories={ds.app.categories} columns={columns} selected={selTop} scheme={scheme} />
      </Panel>
      <Panel span={7} id="tree-title" title="Taksonomi" lede={`To nivåer, med antall hendelser. ${ctx(sel)}.`}>
        <div className="tree">
          {ds.app.tops.map((t, k) => {
            const kids = childrenOf(ds, t).map((c) => ({ c, v: tax.subs[ds.app.subs.indexOf(c)] })).sort((a, b) => b.v - a.v);
            return (
              <details key={`${t}-${t === selTop}`} open={t === selTop}>
                <summary><span>{tname(ds, t)}</span><span>{fmtNum(tax.tops[k])}</span></summary>
                {kids.length > 0 && (
                  <ul>
                    {kids.map((x) => (
                      <li key={x.c}><span>{tname(ds, x.c)}</span><span className="num">{fmtNum(x.v)}</span></li>
                    ))}
                  </ul>
                )}
              </details>
            );
          })}
        </div>
      </Panel>
      <Panel span={5} id="weapons-title" title="Våpen nevnt" lede={`${tname(ds, state.cls)}, ${ctx(sel)}.`}>
        <BarList items={tax.weapons} label="Våpen nevnt" />
        <p className="note">Klassifisert automatisk med nøkkelord (versjon regex-v1). En språkmodell vil skille bedre, f.eks. «stukket av» fra knivstikking.</p>
      </Panel>
      <Panel span={12} id="variants-title" title="Slik vaskes stedsnavn"
        lede={`Politiet skriver stedet som fritekst. ${fmtNum(ds.app.distinctAreas.raw)} ulike skrivemåter blir ${fmtNum(ds.app.distinctAreas.keys)} steder etter vasking (hele landet). Eksempler fra ${muniName(ds, ds.muniIdx.get(variantMuni) ?? 0)}:`}>
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
