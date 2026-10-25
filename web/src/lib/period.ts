import { mlabel } from "./format";

export type PeriodKey = "12m" | "2025" | "2024" | "alle";

export const PERIOD_KEYS: PeriodKey[] = ["12m", "2025", "2024", "alle"];
export const PERIOD_LABEL: Record<PeriodKey, string> = { "12m": "Siste 12 hele mnd", "2025": "2025", "2024": "2024", alle: "Alt" };

export interface PeriodInfo {
  key: PeriodKey;
  from: string;
  to: string;
  /** Sammenligningsperioden året før, hvis den er komplett i dataene. */
  prev: [string, string] | null;
  /** Forklaring når det ikke finnes noen sammenligningsperiode. */
  noPrev?: string;
  label: string;
}

/** Flytter "YYYY-MM" n måneder. */
export function shiftMonth(m: string, n: number): string {
  const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** first/last er første og siste måned i dataene. Siste måned er normalt ikke komplett. */
export function periodInfo(key: PeriodKey, first: string, last: string): PeriodInfo {
  switch (key) {
    case "12m": {
      const to = shiftMonth(last, -1);
      const from = shiftMonth(to, -11);
      return { key, from, to, prev: [shiftMonth(from, -12), shiftMonth(to, -12)], label: `${mlabel(from)} – ${mlabel(to)}` };
    }
    case "2025":
      return { key, from: "2025-01", to: "2025-12", prev: ["2024-01", "2024-12"], label: "2025" };
    case "2024":
      return { key, from: "2024-01", to: "2024-12", prev: null, noPrev: "Data starter i mai 2023", label: "2024" };
    case "alle":
      return { key, from: first, to: last, prev: null, label: `${mlabel(first)} – ${mlabel(last)}` };
  }
}

/**
 * Faktisk antall dager i perioden. Første og siste måned i datasettet er delvise,
 * så perioden klippes mot datasettets start og slutt (span).
 */
export function periodDays(p: PeriodInfo, span: [string, string]): number {
  const start = Math.max(Date.parse(`${p.from}-01T00:00:00Z`), Date.parse(span[0]));
  const end = Math.min(Date.parse(`${shiftMonth(p.to, 1)}-01T00:00:00Z`), Date.parse(span[1]));
  return Math.max(1, (end - start) / 864e5);
}

export const periodYears = (p: PeriodInfo, span: [string, string]): number => periodDays(p, span) / 365.25;

export const isPeriodKey = (v: unknown): v is PeriodKey => typeof v === "string" && (PERIOD_KEYS as string[]).includes(v);
