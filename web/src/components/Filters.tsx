import { useMemo } from "react";
import { childrenOf, dname, muniName, tname, type Dataset } from "../data/dataset";
import type { GeoInfo } from "../lib/geo";
import { PERIOD_KEYS, PERIOD_LABEL, type PeriodKey } from "../lib/period";
import type { AppState } from "../state/appState";
import { Segmented } from "./ui";

interface Props {
  ds: Dataset;
  state: AppState;
  geo: GeoInfo;
  update: (p: Partial<AppState>) => void;
}

/** Kommuner med minst så mange hendelser står i områdelisten. */
const MIN_MUNI = 300;

export function Filters({ ds, state, geo, update }: Props) {
  const geoOptions = useMemo(() => {
    const { app } = ds;
    const byMuni = new Map<string, string[]>();
    for (const [mid, b] of app.bydeler) byMuni.set(mid, [...(byMuni.get(mid) ?? []), b]);
    const munis = app.munis.filter((m) => m[3] >= MIN_MUNI).sort((a, b) => a[1].localeCompare(b[1], "nb"));
    const districts = app.districts.map((d, i) => ({ id: d[0], i })).sort((a, b) => dname(ds, a.i).localeCompare(dname(ds, b.i), "nb"));
    return (
      <>
        <option value="all">Hele landet</option>
        {[...byMuni].map(([mid, bs]) => (
          <optgroup key={mid} label={`Bydeler i ${muniName(ds, ds.muniIdx.get(mid) ?? 0)}`}>
            {bs.map((b) => <option key={b} value={`b:${mid}|${b}`}>{b}</option>)}
          </optgroup>
        ))}
        <optgroup label={`Kommuner (minst ${MIN_MUNI} hendelser)`}>
          {munis.map((m) => <option key={m[0]} value={`m:${m[0]}`}>{m[1]}</option>)}
        </optgroup>
        <optgroup label="Politidistrikter">
          {districts.map((d) => <option key={d.id} value={`d:${d.id}`}>{dname(ds, d.i)} politidistrikt</option>)}
        </optgroup>
      </>
    );
  }, [ds]);

  const geoListed = useMemo(() => {
    const g = state.geo;
    if (g === "all" || g.startsWith("b:") || g.startsWith("d:")) return true;
    const m = ds.app.munis[(ds.muniIdx.get(g.slice(2)) ?? 0) - 1];
    return !!m && m[3] >= MIN_MUNI;
  }, [ds, state.geo]);

  const clsOptions = useMemo(() => (
    <>
      <option value="*">Alle hendelser</option>
      {ds.app.tops.map((t) => {
        const kids = childrenOf(ds, t);
        return [
          <option key={t} value={t}>{tname(ds, t)} (alle)</option>,
          kids.length ? (
            <optgroup key={`${t}-g`} label={tname(ds, t)}>
              {kids.map((c) => <option key={c} value={c}>{tname(ds, c)}</option>)}
            </optgroup>
          ) : null,
        ];
      })}
    </>
  ), [ds]);

  return (
    <div className="filters" role="search" aria-label="Filtre">
      <label>Område
        <select value={state.geo} onChange={(e) => update({ geo: e.target.value })}>
          {geoOptions}
          {!geoListed && <option value={state.geo}>{geo.label}</option>}
        </select>
      </label>
      <label>Klasse
        <select value={state.cls} onChange={(e) => update({ cls: e.target.value })}>{clsOptions}</select>
      </label>
      <div className="field">
        <span className="field-label" id="period-label">Periode</span>
        <Segmented<PeriodKey>
          label="Periode" value={state.period}
          options={PERIOD_KEYS.map((k) => [k, PERIOD_LABEL[k]] as const)}
          onChange={(period) => update({ period })}
        />
      </div>
    </div>
  );
}
