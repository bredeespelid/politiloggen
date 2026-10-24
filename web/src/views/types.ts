import type { Dataset } from "../data/dataset";
import type { Selection } from "../lib/aggregate";
import type { Scheme } from "../lib/hooks";
import type { AppState } from "../state/appState";

/** Det hver fane får inn. sel er memoisert på (geo, cls, period). */
export interface ViewProps {
  ds: Dataset;
  state: AppState;
  update: (patch: Partial<AppState>) => void;
  sel: Selection;
  scheme: Scheme;
}

/** "Oslo, mar 25 – feb 26" */
export const ctx = (sel: Selection): string => `${sel.geo.label}, ${sel.period.label}`;
