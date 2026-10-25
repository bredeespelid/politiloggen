import { decodeRecords, type Columns } from "./decode";
import type { AppData, AreaRow } from "./types";

/** Data + utpakkede kolonner + oppslag. Bygges én gang etter lasting. */
export interface Dataset {
  app: AppData;
  n: number;
  col: Columns;
  months: string[];
  first: string;
  last: string;
  muniIdx: Map<string, number>;
  bydelIdx: Map<string, number>;
  distIdx: Map<string, number>;
  /** Bit for hver overklasse/underklasse i tops/subs-maskene. */
  topBit: Map<string, number>;
  subBit: Map<string, number>;
}

export function buildDataset(app: AppData): Dataset {
  const { n, col } = decodeRecords(app.rec, app.recFields);
  return {
    app, n, col,
    months: app.months,
    first: app.months[0],
    last: app.months[app.months.length - 1],
    muniIdx: new Map(app.munis.map((m, i) => [m[0], i + 1])),
    bydelIdx: new Map(app.bydeler.map((b, i) => [`${b[0]}|${b[1]}`, i + 1])),
    distIdx: new Map(app.districts.map((d, i) => [String(d[0]), i])),
    topBit: new Map(app.tops.map((t, i) => [t, 2 ** i])),
    subBit: new Map(app.subs.map((s, i) => [s, 2 ** i])),
  };
}

export const tname = (ds: Dataset, c: string): string =>
  c === "*" ? "Alle hendelser" : ds.app.taxonomy[c]?.name ?? c;

export const topOf = (ds: Dataset, c: string): string =>
  c === "*" ? "*" : ds.app.taxonomy[c]?.parent || c;

export const childrenOf = (ds: Dataset, top: string): string[] =>
  ds.app.subs.filter((c) => ds.app.taxonomy[c].parent === top);

export const dname = (ds: Dataset, i: number): string =>
  ds.app.districts[i][1].replace(/ politidistrikt$/i, "");

export const muniName = (ds: Dataset, k: number): string =>
  k ? ds.app.munis[k - 1][1] : "Ukjent kommune";

export const areaRow = (ds: Dataset, a: number): AreaRow => ds.app.areas[a - 1];

export const bydelName = (ds: Dataset, b: number): string => ds.app.bydeler[b - 1][1];

/** "Sentrum" finnes både som bydel og som oppgitt sted; skill dem i alle lister. */
export const areaLabel = (row: AreaRow): string => (row[1] === "sentrum" ? `${row[0]} (oppgitt sted)` : row[0]);

export const bydelLabel = (ds: Dataset, b: number): string => {
  if (!b) return "Uten bydel";
  const name = bydelName(ds, b);
  return name === "Sentrum" ? `${name} (bydel)` : name;
};

/** Månedens indeks, klemt inn i dataperioden. */
export function monthIndex(ds: Dataset, m: string): number {
  const i = ds.months.indexOf(m);
  if (i >= 0) return i;
  return m < ds.first ? 0 : ds.months.length - 1;
}
