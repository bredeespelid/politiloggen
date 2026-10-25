import { useCallback, useEffect, useState } from "react";
import type { Dataset } from "../data/dataset";
import { DIST_MODES, type DistMode } from "../lib/aggregate";
import { isValidGeo } from "../lib/geo";
import { isPeriodKey, type PeriodKey } from "../lib/period";

export type Tab = "oversikt" | "kart" | "fordeling" | "tidsmonster" | "omrader" | "hendelser" | "klassifisering" | "datamodell";

export const TABS: readonly { id: Tab; label: string; meta?: boolean }[] = [
  { id: "oversikt", label: "Oversikt" },
  { id: "kart", label: "Kart" },
  { id: "fordeling", label: "Fordeling" },
  { id: "tidsmonster", label: "Når" },
  { id: "omrader", label: "Steder" },
  { id: "hendelser", label: "Hendelser" },
  { id: "klassifisering", label: "Om klassifiseringen", meta: true },
  { id: "datamodell", label: "Datamodell" },
];

export type MapView = "geo" | "norge";
export type MapKind = "heat" | "dots";

export interface AppState {
  geo: string;
  cls: string;
  period: PeriodKey;
  dmode: DistMode;
  tab: Tab;
  mview: MapView;
  mkind: MapKind;
  /** søk i hendelseslisten (ikke lagret i localStorage) */
  q: string;
}

export const STORE_KEY = "pl-state-v2";
export const DEFAULT_GEO = "m:0301";
export const DEFAULT_STATE: AppState = { geo: DEFAULT_GEO, cls: "*", period: "12m", dmode: "pop", tab: "oversikt", mview: "geo", mkind: "heat", q: "" };

const isTab = (v: unknown): v is Tab => TABS.some((t) => t.id === v);

/** Er filtrene (område, type, periode) uendret fra standardvalget? */
export const isDefaultFilter = (s: AppState): boolean =>
  s.geo === DEFAULT_STATE.geo && s.cls === DEFAULT_STATE.cls && s.period === DEFAULT_STATE.period;

/** Retter opp ugyldige verdier (f.eks. lagret tilstand eller lenke fra en eldre datafil). */
export function sanitize(ds: Dataset, s: Partial<AppState>): AppState {
  return {
    geo: typeof s.geo === "string" && isValidGeo(ds, s.geo) ? s.geo : DEFAULT_GEO,
    cls: s.cls === "*" || (typeof s.cls === "string" && ds.app.taxonomy[s.cls]) ? s.cls : "*",
    period: isPeriodKey(s.period) ? s.period : DEFAULT_STATE.period,
    dmode: DIST_MODES.includes(s.dmode as DistMode) ? (s.dmode as DistMode) : DEFAULT_STATE.dmode,
    tab: isTab(s.tab) ? s.tab : DEFAULT_STATE.tab,
    mview: s.mview === "norge" ? "norge" : "geo",
    mkind: s.mkind === "dots" ? "dots" : "heat",
    q: typeof s.q === "string" ? s.q.slice(0, 100) : "",
  };
}

/** Filtre i adressen: ?geo=m:0301&cls=vold&p=12m (dm, mv, mk og q er valgfrie). */
export function stateToQuery(s: AppState): string {
  const p = new URLSearchParams({ geo: s.geo, cls: s.cls, p: s.period });
  if (s.dmode !== DEFAULT_STATE.dmode) p.set("dm", s.dmode);
  if (s.mview !== DEFAULT_STATE.mview) p.set("mv", s.mview);
  if (s.mkind !== DEFAULT_STATE.mkind) p.set("mk", s.mkind);
  if (s.q) p.set("q", s.q);
  return p.toString();
}

export function queryToState(search: string): Partial<AppState> {
  const p = new URLSearchParams(search), out: Record<string, string> = {};
  for (const [param, key] of [["geo", "geo"], ["cls", "cls"], ["p", "period"], ["dm", "dmode"], ["mv", "mview"], ["mk", "mkind"], ["q", "q"]] as const) {
    const v = p.get(param);
    if (v != null) out[key] = v;
  }
  return out as Partial<AppState>;
}

const PERSISTED = ["geo", "cls", "period", "dmode", "mview", "mkind"] as const;

function load(): Partial<AppState> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") as Partial<AppState>;
  } catch {
    return {};
  }
}

function save(s: AppState): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(PERSISTED.map((k) => [k, s[k]]))));
  } catch {
    /* privat modus o.l. – appen virker uten lagring */
  }
}

const hashTab = (): Tab | null => {
  const h = location.hash.slice(1);
  return isTab(h) ? h : null;
};

/**
 * Filtertilstand. Adressen (?geo=…&cls=…&p=…) går foran localStorage («pl-state-v2»),
 * som går foran standardvalgene. Fanen følger #hash.
 */
export function useAppState(ds: Dataset): [AppState, (patch: Partial<AppState>) => void] {
  const [state, setState] = useState<AppState>(() =>
    sanitize(ds, { ...load(), ...queryToState(location.search), tab: hashTab() ?? "oversikt" }));

  const update = useCallback(
    (patch: Partial<AppState>) => setState((s) => sanitize(ds, { ...s, ...patch })),
    [ds],
  );

  useEffect(() => {
    save(state);
    try {
      history.replaceState(null, "", `${location.pathname}?${stateToQuery(state)}#${state.tab}`);
    } catch {
      /* ignorer */
    }
  }, [state]);

  useEffect(() => {
    const onHash = () => {
      const t = hashTab();
      if (t) update({ tab: t });
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, [update]);

  return [state, update];
}
