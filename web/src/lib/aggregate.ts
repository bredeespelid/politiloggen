/**
 * Alle aggregeringer som rene funksjoner over en Selection (datasett + filter).
 * Ingen DOM og ingen React her, så alt kan testes direkte.
 */
import {
  areaRow, bydelName, childrenOf, dname, monthIndex, muniName, tname, topOf, type Dataset,
} from "../data/dataset";
import type { AreaRow, Sample } from "../data/types";
import { CAT_TO_TOP } from "./format";
import type { GeoInfo } from "./geo";
import type { PeriodInfo } from "./period";

export type RowTest = (r: number) => boolean;

export interface Selection {
  ds: Dataset;
  geo: GeoInfo;
  /** Geo-maske (1 = i området), se geoMask(). */
  mask: Uint8Array;
  cls: string;
  period: PeriodInfo;
  test: RowTest;
}

export function clsTest(ds: Dataset, c: string): RowTest {
  if (c === "*" || !ds.app.taxonomy[c]) return () => true;
  if (ds.app.taxonomy[c].parent) {
    const bit = ds.subBit.get(c) ?? 0;
    const S = ds.col.subs;
    return (r) => (S[r] & bit) !== 0;
  }
  const bit = ds.topBit.get(c) ?? 0;
  const T = ds.col.tops;
  return (r) => (T[r] & bit) !== 0;
}

export function makeSelection(ds: Dataset, geo: GeoInfo, mask: Uint8Array, cls: string, period: PeriodInfo): Selection {
  return { ds, geo, mask, cls, period, test: clsTest(ds, cls) };
}

/** Går gjennom hendelsene i valgt område og månedsintervall (inkludert begge ender). */
export function scan(sel: Selection, fn: (r: number) => void, from = sel.period.from, to = sel.period.to): void {
  const { ds, mask } = sel;
  if (from > ds.last || to < ds.first) return;
  const a = monthIndex(ds, from), b = monthIndex(ds, to), M = ds.col.month;
  for (let r = 0; r < ds.n; r++) if (mask[r] && M[r] >= a && M[r] <= b) fn(r);
}

const countBits = (mask: number, bits: number, into: number[]) => {
  for (let k = 0; k < bits; k++) if (mask & (1 << k)) into[k]++;
};

// ---------- Oversikt ----------

export interface KpiStats {
  /** treff på klassen i perioden */
  n: number;
  /** alle hendelser i området og perioden */
  tot: number;
  /** treff i sammenligningsperioden, null hvis ingen */
  prev: number | null;
  /** endring mot perioden før */
  change: number | null;
  /** hendelser i valgt overklasse, og hvor mange av dem politiet satte i en annen kategori */
  inTop: number;
  outside: number;
  perTop: number[];
  /** antall måneder i perioden (for snitt per dag) */
  months: number;
}

export function kpiStats(sel: Selection): KpiStats {
  const { ds, period: p, test } = sel;
  const top = topOf(ds, sel.cls);
  const topBit = top === "*" ? 0 : ds.topBit.get(top) ?? 0;
  const T = ds.col.tops, C = ds.col.category, cats = ds.app.categories, nTops = ds.app.tops.length;
  const perTop = new Array<number>(nTops).fill(0);
  let n = 0, tot = 0, inTop = 0, outside = 0;
  scan(sel, (r) => {
    tot++;
    if (test(r)) n++;
    if (topBit) {
      if (T[r] & topBit) {
        inTop++;
        if (CAT_TO_TOP[cats[C[r]]] !== top) outside++;
      }
    } else countBits(T[r], nTops, perTop);
  });
  let prev: number | null = null;
  if (p.prev) {
    let c = 0;
    scan(sel, (r) => { if (test(r)) c++; }, p.prev[0], p.prev[1]);
    prev = c;
  }
  const change = prev ? (n - prev) / prev : null;
  return { n, tot, prev, change, inTop, outside, perTop, months: monthIndex(ds, p.to) - monthIndex(ds, p.from) + 1 };
}

export interface TrendPoint {
  m: string;
  /** treff på klassen */
  v: number;
  /** alle hendelser */
  t: number;
}

export function monthlyTrend(sel: Selection): { pts: TrendPoint[]; partialLast: boolean } {
  const { ds, period: p, test } = sel;
  const a = monthIndex(ds, p.from), b = monthIndex(ds, p.to), M = ds.col.month;
  const v = new Array<number>(b - a + 1).fill(0), t = new Array<number>(b - a + 1).fill(0);
  scan(sel, (r) => {
    const i = M[r] - a;
    t[i]++;
    if (test(r)) v[i]++;
  });
  return { pts: v.map((x, i) => ({ m: ds.months[a + i], v: x, t: t[i] })), partialLast: ds.months[b] === ds.last };
}

export interface BarItem {
  key: string | number;
  label: string;
  v: number;
  sel?: boolean;
  dim?: boolean;
}

/** Overklasser (uten klassefilter), sortert synkende. */
export function topClassItems(sel: Selection): (BarItem & { code: string })[] {
  const { ds } = sel;
  const nTops = ds.app.tops.length, cnt = new Array<number>(nTops).fill(0), T = ds.col.tops;
  scan(sel, (r) => countBits(T[r], nTops, cnt));
  return ds.app.tops.map((c, i) => ({ key: c, code: c, label: tname(ds, c), v: cnt[i] })).sort((a, b) => b.v - a.v);
}

/** Underklasser i en overklasse (uten klassefilter), sortert synkende. */
export function subClassItems(sel: Selection, top: string): (BarItem & { code: string })[] {
  const { ds } = sel;
  const kids = childrenOf(ds, top);
  const bits = kids.map((c) => ds.subBit.get(c) ?? 0), cnt = new Array<number>(kids.length).fill(0), S = ds.col.subs;
  scan(sel, (r) => {
    const s = S[r];
    for (let k = 0; k < bits.length; k++) if (s & bits[k]) cnt[k]++;
  });
  return kids.map((code, k) => ({ key: code, code, label: tname(ds, code), v: cnt[k], sel: code === sel.cls })).sort((a, b) => b.v - a.v);
}

export function outcomeItems(sel: Selection): BarItem[] {
  const { ds, test } = sel;
  const cnt = new Array<number>(ds.app.outcomes.length).fill(0), O = ds.col.outcomes;
  scan(sel, (r) => { if (test(r)) countBits(O[r], cnt.length, cnt); });
  return ds.app.outcomes.map((label, k) => ({ key: label, label, v: cnt[k] })).filter((i) => i.v > 0).sort((a, b) => b.v - a.v);
}

/**
 * Personer omtalt: persons-feltet er opptil tre sifre i base 32, hvert = 1 + kjønn*8 + aldersgruppe.
 * Returnerer [menn, kvinner], hver med 8 aldersgrupper.
 */
export function decodePersons(code: number, into: [number[], number[]]): void {
  let p = code;
  while (p > 0) {
    const d = (p % 32) - 1;
    p = Math.floor(p / 32);
    if (d >= 0) into[d >> 3][d & 7]++;
  }
}

export function personCounts(sel: Selection): [number[], number[]] {
  const { ds, test } = sel;
  const S: [number[], number[]] = [new Array<number>(8).fill(0), new Array<number>(8).fill(0)];
  const P = ds.col.persons;
  scan(sel, (r) => { if (test(r)) decodePersons(P[r], S); });
  return S;
}

// ---------- Fordeling ----------

export interface Level {
  title: string;
  key: (r: number) => number;
  label: (k: number) => string;
  /** Områdenøkkel for å velge nivået, eller null. */
  geo: (k: number) => string | null;
  /** false for samlebøtten (ukjent kommune / ikke koblet / øvrige). */
  known: (k: number) => boolean;
  limit: number;
  note?: string;
}

export function childLevel(ds: Dataset, g: GeoInfo): Level {
  const { col, app } = ds;
  if (g.kind === "all") {
    return {
      title: "Per politidistrikt", key: (r) => col.district[r], label: (k) => dname(ds, k),
      geo: (k) => `d:${app.districts[k][0]}`, known: () => true, limit: 20,
      note: "Distriktene publiserer svært ulikt. Andel av eget volum egner seg derfor bedre til sammenligning enn antall.",
    };
  }
  if (g.kind === "d") {
    return {
      title: `Kommuner i ${g.label}`, key: (r) => col.muni[r], label: (k) => muniName(ds, k),
      geo: (k) => (k ? `m:${app.munis[k - 1][0]}` : null), known: (k) => k > 0, limit: 15,
    };
  }
  if (g.kind === "m" && g.hasBydel) {
    return {
      title: `Bydeler i ${g.label}`, key: (r) => col.bydel[r],
      label: (k) => (k ? bydelName(ds, k) : "Ikke koblet (vei, mangler, ukjent)"),
      geo: (k) => (k ? `b:${app.bydeler[k - 1].join("|")}` : null), known: (k) => k > 0, limit: 20,
      note: "«Ikke koblet» er veier, tunneler, hendelser uten område og steder som ennå ikke er knyttet til bydel.",
    };
  }
  return {
    title: `Områder i ${g.label}`, key: (r) => col.area[r], label: (k) => (k ? areaRow(ds, k)[0] : "Øvrige/ukjent"),
    geo: () => null, known: (k) => k > 0, limit: 15,
  };
}

export type DistMode = "share" | "abs";

export interface DistItem extends BarItem {
  k: number;
  /** treff på klassen */
  n: number;
  /** alle hendelser i enheten */
  t: number;
  known: boolean;
}

export interface Distribution {
  level: Level;
  mode: DistMode;
  items: DistItem[];
  /** månedsserie per enhet (treff på klassen) */
  series: Map<number, number[]>;
  months: string[];
  partialLast: boolean;
}

export function distribution(sel: Selection, dmode: DistMode): Distribution {
  const { ds, geo, test, period: p } = sel;
  const level = childLevel(ds, geo);
  // Med alle hendelser er andelen alltid 100 %, så da vises bare antall.
  const mode: DistMode = sel.cls === "*" ? "abs" : dmode;
  const a = monthIndex(ds, p.from), b = monthIndex(ds, p.to), M = ds.col.month;
  const n = new Map<number, number>(), t = new Map<number, number>(), series = new Map<number, number[]>();
  scan(sel, (r) => {
    const k = level.key(r);
    t.set(k, (t.get(k) ?? 0) + 1);
    if (test(r)) {
      n.set(k, (n.get(k) ?? 0) + 1);
      let s = series.get(k);
      if (!s) series.set(k, (s = new Array<number>(b - a + 1).fill(0)));
      s[M[r] - a]++;
    }
  });
  let items: DistItem[] = [...t.keys()].map((k) => {
    const nn = n.get(k) ?? 0, tt = t.get(k)!, known = level.known(k);
    return { key: k, k, label: level.label(k), n: nn, t: tt, known, dim: !known && geo.kind === "m", v: mode === "share" ? (tt ? nn / tt : 0) : nn };
  });
  items.sort((x, y) => (mode === "share" ? y.n - x.n : 0) || y.v - x.v);
  items = items.filter((i) => i.known || geo.kind === "m").slice(0, level.limit);
  if (mode === "share") items.sort((x, y) => Number(!x.known) - Number(!y.known) || y.v - x.v);
  return { level, mode, items, series, months: ds.months.slice(a, b + 1), partialLast: ds.months[b] === ds.last };
}

// ---------- Områder ----------

export interface AreaStats {
  n: number;
  missing: number;
  mapped: number;
  types: (BarItem & { all: number })[];
  bydeler: (BarItem & { k: number; all: number })[];
  top: { a: number; row: AreaRow; v: number; all: number }[];
}

export function areaStats(sel: Selection, topN = 25): AreaStats {
  const { ds, test, geo } = sel;
  const { col, app } = ds;
  const nT = app.areaTypes.length;
  const types = new Array<number>(nT).fill(0), typesAll = new Array<number>(nT).fill(0);
  const byd = new Map<number, number>(), bydAll = new Map<number, number>(), ar = new Map<number, number>(), arAll = new Map<number, number>();
  let n = 0, mapped = 0;
  scan(sel, (r) => {
    const y = col.areaType[r], bd = col.bydel[r], a = col.area[r];
    typesAll[y]++;
    bydAll.set(bd, (bydAll.get(bd) ?? 0) + 1);
    if (a) arAll.set(a, (arAll.get(a) ?? 0) + 1);
    if (!test(r)) return;
    n++;
    types[y]++;
    byd.set(bd, (byd.get(bd) ?? 0) + 1);
    if (bd) mapped++;
    if (a) ar.set(a, (ar.get(a) ?? 0) + 1);
  });
  const missing = types[app.areaTypes.indexOf("mangler")] ?? 0;
  const typeItems = app.areaTypes
    .map((t, i) => ({ key: t, label: t, v: types[i], all: typesAll[i] }))
    .filter((i) => i.v > 0).sort((a, b) => b.v - a.v);
  const bydItems = [...bydAll.keys()]
    .map((k) => ({ key: k, k, label: k ? bydelName(ds, k) : "Ikke koblet (vei, mangler, ukjent)", v: byd.get(k) ?? 0, all: bydAll.get(k)!, sel: geo.kind === "b" && k === geo.b, dim: !k }))
    .sort((a, b) => Number(!a.k) - Number(!b.k) || b.v - a.v);
  const top = [...ar.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN)
    .map(([a, v]) => ({ a, row: areaRow(ds, a), v, all: arAll.get(a) ?? 0 }));
  return { n, missing, mapped, types: typeItems, bydeler: bydItems, top };
}

// ---------- Tidsmønster ----------

/** 7 × 24 (mandag først), pluss totalen. */
export function weekHourGrid(sel: Selection): { grid: number[][]; tot: number } {
  const { ds, test } = sel;
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const H = ds.col.hourOfWeek;
  let tot = 0;
  scan(sel, (r) => {
    if (!test(r)) return;
    const h = H[r];
    grid[Math.floor(h / 24)][h % 24]++;
    tot++;
  });
  return { grid, tot };
}

// ---------- Klassifisering ----------

export interface CrossTab {
  /** [kategori][overklasse] */
  cells: number[][];
  rowTot: number[];
  /** kategorier med treff, sortert etter volum */
  order: number[];
}

export function crossTab(sel: Selection): CrossTab {
  const { ds } = sel;
  const nTops = ds.app.tops.length;
  const cells = ds.app.categories.map(() => new Array<number>(nTops).fill(0));
  const rowTot = new Array<number>(ds.app.categories.length).fill(0);
  const C = ds.col.category, T = ds.col.tops;
  scan(sel, (r) => {
    const c = C[r];
    rowTot[c]++;
    countBits(T[r], nTops, cells[c]);
  });
  const order = rowTot.map((_, i) => i).filter((i) => rowTot[i] > 0).sort((a, b) => rowTot[b] - rowTot[a]);
  return { cells, rowTot, order };
}

/** Antall per overklasse og underklasse (uten klassefilter), og våpen (med klassefilter). */
export function taxonomyCounts(sel: Selection): { tops: number[]; subs: number[]; weapons: BarItem[] } {
  const { ds, test } = sel;
  const nT = ds.app.tops.length, nS = ds.app.subs.length;
  const tc = new Array<number>(nT).fill(0), sc = new Array<number>(nS).fill(0), wc = new Array<number>(ds.app.weapons.length + 1).fill(0);
  const T = ds.col.tops, S = ds.col.subs, W = ds.col.weapon;
  scan(sel, (r) => {
    countBits(T[r], nT, tc);
    countBits(S[r], nS, sc);
    if (test(r)) wc[W[r]]++;
  });
  const weapons = ds.app.weapons.map((w, i) => ({ key: w, label: w, v: wc[i + 1] })).filter((i) => i.v > 0).sort((a, b) => b.v - a.v);
  return { tops: tc, subs: sc, weapons };
}

// ---------- Kart ----------

export interface MapPoint {
  a: number;
  v: number;
  row: AreaRow;
  lat: number;
  lon: number;
}

export function mapPoints(sel: Selection): { pts: MapPoint[]; located: number; total: number } {
  const { ds, test } = sel;
  const A = ds.col.area, cnt = new Map<number, number>();
  let located = 0, total = 0;
  scan(sel, (r) => {
    if (!test(r)) return;
    total++;
    const a = A[r];
    if (a && ds.app.areas[a - 1][3] != null) {
      located++;
      cnt.set(a, (cnt.get(a) ?? 0) + 1);
    }
  });
  const pts = [...cnt.entries()].map(([a, v]) => {
    const row = areaRow(ds, a);
    return { a, v, row, lat: row[3]!, lon: row[4]! };
  });
  return { pts, located, total };
}

export type LatLngBounds = [[number, number], [number, number]];
export const NORWAY: LatLngBounds = [[57.8, 4.5], [71.3, 31.5]];

/** Utsnitt for valgt område: kommunens boks hvis vi har den, ellers 2–98-persentilen av geokodede hendelser. */
export function geoBounds(ds: Dataset, geo: GeoInfo, mask: Uint8Array): LatLngBounds {
  if (geo.kind === "all") return NORWAY;
  if (geo.kind === "m") {
    const k = ds.app.kommuner.find((x) => x.id === geo.id);
    if (k) return [[k.bbox[1], k.bbox[0]], [k.bbox[3], k.bbox[2]]];
  }
  const lats: number[] = [], lons: number[] = [], A = ds.col.area;
  for (let r = 0; r < ds.n; r++) {
    if (!mask[r]) continue;
    const a = A[r];
    const row = a ? ds.app.areas[a - 1] : null;
    if (row && row[3] != null && row[4] != null) {
      lats.push(row[3]);
      lons.push(row[4]);
    }
  }
  if (!lats.length) return NORWAY;
  lats.sort((x, y) => x - y);
  lons.sort((x, y) => x - y);
  const q = (arr: number[], f: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * f))];
  return [[q(lats, 0.02) - 0.01, q(lons, 0.02) - 0.02], [q(lats, 0.98) + 0.01, q(lons, 0.98) + 0.02]];
}

// ---------- Hendelser ----------

export function filterSamples(ds: Dataset, geo: GeoInfo, cls: string): Sample[] {
  const inGeo = (s: Sample) =>
    geo.kind === "all" || (geo.kind === "d" && s.d === geo.i) || (geo.kind === "m" && s.k === geo.k) || (geo.kind === "b" && s.b === geo.b);
  const inCls = (s: Sample) => cls === "*" || s.classes.some((x) => x === cls || topOf(ds, x) === cls);
  return ds.app.samples.filter((s) => inGeo(s) && inCls(s));
}
