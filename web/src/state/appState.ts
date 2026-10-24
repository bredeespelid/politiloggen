import { useCallback, useEffect, useState } from "react";
import type { Dataset } from "../data/dataset";
import type { DistMode } from "../lib/aggregate";
import { isValidGeo } from "../lib/geo";
import { isPeriodKey, type PeriodKey } from "../lib/period";

export const TABS = [
  ["oversikt", "Oversikt"],
  ["kart", "Kart"],
  ["fordeling", "Fordeling"],
  ["omrader", "Områder"],
  ["tidsmonster", "Tidsmønster"],
  ["klassifisering", "Klassifisering"],
  ["hendelser", "Hendelser"],
  ["datamodell", "Datamodell"],
] as const;

export type Tab = (typeof TABS)[number][0];
export type MapView = "geo" | "norge";

export interface AppState {
  geo: string;
  cls: string;
  period: PeriodKey;
  dmode: DistMode;
  tab: Tab;
  mview: MapView;
}

export const STORE_KEY = "pl-state-v2";
export const DEFAULT_STATE: AppState = { geo: "m:0301", cls: "*", period: "12m", dmode: "share", tab: "oversikt", mview: "geo" };

const isTab = (v: unknown): v is Tab => TABS.some(([t]) => t === v);

/** Retter opp ugyldige verdier (f.eks. lagret tilstand fra en eldre datafil). */
export function sanitize(ds: Dataset, s: Partial<AppState>): AppState {
  return {
    geo: typeof s.geo === "string" && isValidGeo(ds, s.geo) ? s.geo : DEFAULT_STATE.geo,
    cls: s.cls === "*" || (typeof s.cls === "string" && ds.app.taxonomy[s.cls]) ? s.cls : "*",
    period: isPeriodKey(s.period) ? s.period : DEFAULT_STATE.period,
    dmode: s.dmode === "abs" ? "abs" : "share",
    tab: isTab(s.tab) ? s.tab : DEFAULT_STATE.tab,
    mview: s.mview === "norge" ? "norge" : "geo",
  };
}

function load(): Partial<AppState> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") as Partial<AppState>;
  } catch {
    return {};
  }
}

function save(s: AppState): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* privat modus o.l. – appen virker uten lagring */
  }
}

const hashTab = (): Tab | null => {
  const h = location.hash.slice(1);
  return isTab(h) ? h : null;
};

/** Filtertilstand: lagres i localStorage, fanen følger også #hash i adressen. */
export function useAppState(ds: Dataset): [AppState, (patch: Partial<AppState>) => void] {
  const [state, setState] = useState<AppState>(() => {
    const stored = load();
    return sanitize(ds, { ...stored, tab: hashTab() ?? stored.tab });
  });

  const update = useCallback(
    (patch: Partial<AppState>) => setState((s) => sanitize(ds, { ...s, ...patch })),
    [ds],
  );

  useEffect(() => save(state), [state]);

  useEffect(() => {
    const want = `#${state.tab}`;
    if (location.hash !== want) {
      try {
        history.replaceState(null, "", want);
      } catch {
        /* ignorer */
      }
    }
  }, [state.tab]);

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
