import { useEffect, useMemo, useState } from "react";
import { childrenOf, dname, muniName, tname, type Dataset } from "../data/dataset";
import { placeOptions, resolvePlace, type GeoInfo } from "../lib/geo";
import { PERIOD_KEYS, PERIOD_LABEL, type PeriodKey } from "../lib/period";
import type { AppState } from "../state/appState";
import { Segmented } from "./ui";
import { DEFAULT_GEO, isDefaultFilter } from "../state/appState";

interface Props {
  ds: Dataset;
  state: AppState;
  geo: GeoInfo;
  update: (p: Partial<AppState>) => void;
}

/** Kommuner med minst så mange hendelser står i områdelisten. */
const MIN_MUNI = 300;

/** «Finn sted»: søk i de mest brukte stedsnavnene (strøk, gater, sentrum) og velg ett enkelt sted. */
function FindPlace({ ds, geo, update }: Pick<Props, "ds" | "geo" | "update">) {
  const options = useMemo(() => placeOptions(ds), [ds]);
  const [text, setText] = useState(geo.kind === "a" ? geo.label : "");
  const [bad, setBad] = useState(false);
  // Feltet viser stedet som er valgt, og tømmes når et annet område velges.
  useEffect(() => { setText(geo.kind === "a" ? geo.label : ""); setBad(false); }, [geo.kind, geo.label]);

  const pick = (value: string) => {
    if (!value.trim()) return;
    const a = resolvePlace(options, value);
    setBad(a == null);
    if (a != null) update({ geo: `a:${a}` });
  };
  return (
    <label className="search place-search">Finn sted
      <input
        type="search" list="places" value={text} placeholder="F.eks. Grønland" autoComplete="off"
        aria-invalid={bad || undefined} aria-describedby={bad ? "place-err" : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setBad(false);
          // Et valg i listen gir eksakt treff med en gang.
          const exact = options.find((o) => o.value === e.target.value);
          if (exact) update({ geo: `a:${exact.a}` });
        }}
        onKeyDown={(e) => { if (e.key === "Enter") pick(text); }}
        onBlur={() => { if (text !== geo.label) pick(text); }}
      />
      <datalist id="places">{options.map((o) => <option key={o.value} value={o.value} />)}</datalist>
      {bad && <span id="place-err" className="field-error" role="alert">Fant ikke stedet. Velg fra listen.</span>}
    </label>
  );
}

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
    if (g.startsWith("a:")) return false;
    const m = ds.app.munis[(ds.muniIdx.get(g.slice(2)) ?? 0) - 1];
    return !!m && m[3] >= MIN_MUNI;
  }, [ds, state.geo]);

  const clsOptions = useMemo(() => (
    <>
      <option value="*">Alle hendelser</option>
      {ds.app.tops.map((t) => {
        const kids = childrenOf(ds, t);
        return [
          <option key={t} value={t}>{tname(ds, t)}{kids.length ? " – alle" : ""}</option>,
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
      <FindPlace ds={ds} geo={geo} update={update} />
      <label>Type hendelse
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
      {!isDefaultFilter(state) && (
        <button type="button" className="reset" onClick={() => update({ geo: DEFAULT_GEO, cls: "*", period: "12m" })}>
          Tilbake til Oslo, alle hendelser
        </button>
      )}
    </div>
  );
}
