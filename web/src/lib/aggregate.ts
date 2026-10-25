/**
 * Alle aggregeringer som rene funksjoner over en Selection (datasett + filter).
 * Ingen DOM og ingen React her, så alt kan testes direkte.
 */
import { decodeMeta } from "../data/decode";
import {
  areaLabel, areaRow, bydelLabel, childrenOf, dname, monthIndex, muniName, tname, topOf, type Dataset,
} from "../data/dataset";
import type { AreaRow, Sample } from "../data/types";
import { CAT_TO_TOP, NF, PF, WD, cap1, fmt1 } from "./format";
import { geoInfo, geoMask, geoPop, mapMask, type GeoInfo } from "./geo";
import { periodDays, periodYears, shiftMonth, type PeriodInfo } from "./period";

export type RowTest = (r: number) => boolean;

/** Nivået under en kommune med bydeler i Fordeling: bydeler eller enkeltsteder. */
export type FLevel = "bydel" | "sted";

export interface Selection {
  ds: Dataset;
  geo: GeoInfo;
  /** Geo-maske (1 = i området), se geoMask(). */
  mask: Uint8Array;
  cls: string;
  period: PeriodInfo;
  test: RowTest;
  flevel: FLevel;
  /** Alvorlighetsfilter: «*» eller lav/middels/høy. Gjelder alle tall (se scan), unntatt fordelingen på alvorlighet selv. */
  sev: string;
  /** verdien i meta for sev, eller -1 for alle */
  sevIdx: number;
}

/** Type (og undertype), og eventuelt alvorlighet (sevIdx >= 0, språkmodellens vurdering i de to laveste bitene av meta). */
export function clsTest(ds: Dataset, c: string, sevIdx = -1): RowTest {
  let base: RowTest;
  if (c === "*" || !ds.app.taxonomy[c]) base = () => true;
  else if (ds.app.taxonomy[c].parent) {
    const bit = ds.subBit.get(c) ?? 0;
    const S = ds.col.subs;
    base = (r) => (S[r] & bit) !== 0;
  } else {
    const bit = ds.topBit.get(c) ?? 0;
    const T = ds.col.tops;
    base = (r) => (T[r] & bit) !== 0;
  }
  if (sevIdx < 0) return base;
  const META = ds.col.meta;
  return (r) => (META[r] & 3) === sevIdx && base(r);
}

export function makeSelection(
  ds: Dataset, geo: GeoInfo, mask: Uint8Array, cls: string, period: PeriodInfo, flevel: FLevel = "bydel", sev = "*",
): Selection {
  const sevIdx = sev === "*" ? -1 : ds.sevIdx.get(sev) ?? -1;
  return { ds, geo, mask, cls, period, test: clsTest(ds, cls, sevIdx), flevel, sev: sevIdx < 0 ? "*" : sev, sevIdx };
}

/**
 * Går gjennom hendelsene i valgt område og månedsintervall (inkludert begge ender).
 * Alvorlighetsfilteret gjelder alle tall, unntatt når ignoreSev er satt.
 */
export function scan(
  sel: Selection, fn: (r: number) => void, from = sel.period.from, to = sel.period.to, mask = sel.mask, ignoreSev = false,
): void {
  const { ds } = sel;
  if (from > ds.last || to < ds.first) return;
  const a = monthIndex(ds, from), b = monthIndex(ds, to), M = ds.col.month, META = ds.col.meta;
  const sev = ignoreSev ? -1 : sel.sevIdx;
  for (let r = 0; r < ds.n; r++) if (mask[r] && M[r] >= a && M[r] <= b && (sev < 0 || (META[r] & 3) === sev)) fn(r);
}

const countBits = (mask: number, bits: number, into: number[]) => {
  for (let k = 0; k < bits; k++) if (mask & (1 << k)) into[k]++;
};

/** "i hele landet" / "i Oslo" */
export const inGeoText = (geo: GeoInfo): string => (geo.kind === "all" ? "i hele landet" : `i ${geo.label}`);

export const days = (sel: Selection): number => periodDays(sel.period, sel.ds.app.span);
export const years = (sel: Selection): number => periodYears(sel.period, sel.ds.app.span);

/** Hendelser av valgt type per 1 000 innbyggere per år i hele landet. */
export function nationalRate(sel: Selection): number {
  const { ds, period: p, test } = sel;
  const a = monthIndex(ds, p.from), b = monthIndex(ds, p.to), M = ds.col.month;
  const pop = geoPop(ds, { kind: "all" });
  if (!pop) return 0;
  let n = 0;
  for (let r = 0; r < ds.n; r++) if (M[r] >= a && M[r] <= b && test(r)) n++;
  return (n / years(sel) / pop) * 1000;
}

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
  /** treff der politiets kategori ikke er den vi plasserer hendelsen i (bare for en valgt type) */
  outside: number;
  perTop: number[];
  pop: number | null;
}

export function kpiStats(sel: Selection): KpiStats {
  const { ds, period: p, test } = sel;
  const top = topOf(ds, sel.cls);
  const T = ds.col.tops, C = ds.col.category, cats = ds.app.categories, nTops = ds.app.tops.length;
  const perTop = new Array<number>(nTops).fill(0);
  let n = 0, tot = 0, outside = 0;
  scan(sel, (r) => {
    tot++;
    if (test(r)) {
      n++;
      if (top !== "*" && CAT_TO_TOP[cats[C[r]]] !== top) outside++;
    }
    if (top === "*") countBits(T[r], nTops, perTop);
  });
  let prev: number | null = null;
  if (p.prev) {
    let c = 0;
    scan(sel, (r) => { if (test(r)) c++; }, p.prev[0], p.prev[1]);
    prev = c;
  }
  const change = prev ? (n - prev) / prev : null;
  return { n, tot, prev, change, outside, perTop, pop: geoPop(ds, sel.geo) };
}

export interface TrendPoint {
  m: string;
  /** treff på klassen */
  v: number;
  /** alle hendelser */
  t: number;
  /** samme måned året før (null der datasettet ikke har den, eller bare delvis) */
  pv: number | null;
}

export function monthlyTrend(sel: Selection): { pts: TrendPoint[]; partialLast: boolean; hasCompare: boolean } {
  const { ds, period: p, test } = sel;
  const a = monthIndex(ds, p.from), b = monthIndex(ds, p.to), M = ds.col.month, len = b - a + 1;
  const v = new Array<number>(len).fill(0), t = new Array<number>(len).fill(0);
  scan(sel, (r) => {
    const i = M[r] - a;
    t[i]++;
    if (test(r)) v[i]++;
  });
  const pv: (number | null)[] = new Array<number | null>(len).fill(null);
  const pa = shiftMonth(ds.months[a], -12), pb = shiftMonth(ds.months[b], -12);
  if (pb >= ds.first) {
    for (let i = 0; i < len; i++) if (shiftMonth(ds.months[a + i], -12) >= ds.first) pv[i] = 0;
    scan(sel, (r) => {
      if (!test(r)) return;
      const i = M[r] + 12 - a;
      if (i >= 0 && i < len && pv[i] != null) pv[i]!++;
    }, pa < ds.first ? ds.first : pa, pb);
  }
  // Første måned i datasettet er delvis, så den er ikke noe godt sammenligningsgrunnlag.
  for (let i = 0; i < len; i++) if (shiftMonth(ds.months[a + i], -12) === ds.first) pv[i] = null;
  return {
    pts: v.map((x, i) => ({ m: ds.months[a + i], v: x, t: t[i], pv: pv[i] })),
    partialLast: ds.months[b] === ds.last,
    hasCompare: pv.some((x) => x != null),
  };
}

export interface BarItem {
  key: string | number;
  label: string;
  v: number;
  sel?: boolean;
  dim?: boolean;
  /** tegnes grått (nedgang) */
  neg?: boolean;
}

/** Overklasser (uten klassefilter), sortert synkende. */
export function topClassItems(sel: Selection): (BarItem & { code: string })[] {
  const { ds } = sel;
  const nTops = ds.app.tops.length, cnt = new Array<number>(nTops).fill(0), T = ds.col.tops;
  scan(sel, (r) => countBits(T[r], nTops, cnt));
  return ds.app.tops.map((c, i) => ({ key: c, code: c, label: tname(ds, c), v: cnt[i] })).filter((i) => i.v > 0).sort((a, b) => b.v - a.v);
}

/** Underklasser i en overklasse (uten klassefilter), sortert synkende. Valgt klasse vises også uten treff. */
export function subClassItems(sel: Selection, top: string): (BarItem & { code: string })[] {
  const { ds } = sel;
  const kids = childrenOf(ds, top);
  const bits = kids.map((c) => ds.subBit.get(c) ?? 0), cnt = new Array<number>(kids.length).fill(0), S = ds.col.subs;
  scan(sel, (r) => {
    const s = S[r];
    for (let k = 0; k < bits.length; k++) if (s & bits[k]) cnt[k]++;
  });
  return kids
    .map((code, k) => ({ key: code, code, label: tname(ds, code), v: cnt[k], sel: code === sel.cls }))
    .filter((i) => i.v > 0 || i.sel)
    .sort((a, b) => b.v - a.v);
}

export interface OutcomeStats {
  items: BarItem[];
  /** hendelser i utvalget */
  n: number;
  /** hendelser som nevner minst ett utfall */
  any: number;
}

export function outcomeStats(sel: Selection, labels: Record<string, string> = {}): OutcomeStats {
  const { ds, test } = sel;
  const cnt = new Array<number>(ds.app.outcomes.length).fill(0), O = ds.col.outcomes;
  let n = 0, any = 0;
  scan(sel, (r) => {
    if (!test(r)) return;
    n++;
    if (O[r]) any++;
    countBits(O[r], cnt.length, cnt);
  });
  const items = ds.app.outcomes
    .map((o, k) => ({ key: o, label: labels[o] ?? o, v: cnt[k] }))
    .filter((i) => i.v > 0).sort((a, b) => b.v - a.v);
  return { items, n, any };
}

/**
 * Personer omtalt: persons-feltet er opptil tre sifre i base 64, hvert = 1 + kjønn*16 + aldersgruppe
 * (kjønn 0 mann, 1 kvinne; aldersgruppene er ds.app.ages). Teller inn i [menn, kvinner].
 */
export function decodePersons(code: number, into: [number[], number[]]): void {
  let p = code;
  while (p > 0) {
    const d = (p % 64) - 1;
    p = Math.floor(p / 64);
    if (d >= 0 && (d >> 4) < 2) into[d >> 4][d & 15]++;
  }
}

export interface PersonStats {
  /** [menn, kvinner], hver med én verdi per aldersgruppe */
  counts: [number[], number[]];
  /** hendelser i utvalget og hvor mange av dem som nevner kjønn og alder */
  nInc: number;
  withP: number;
  total: number;
}

export function personStats(sel: Selection): PersonStats {
  const { ds, test } = sel;
  const nA = Math.max(ds.app.ages.length, 16);
  const counts: [number[], number[]] = [new Array<number>(nA).fill(0), new Array<number>(nA).fill(0)];
  const P = ds.col.persons;
  let nInc = 0, withP = 0;
  scan(sel, (r) => {
    if (!test(r)) return;
    nInc++;
    if (P[r]) withP++;
    decodePersons(P[r], counts);
  });
  const k = ds.app.ages.length;
  const out: [number[], number[]] = [counts[0].slice(0, k), counts[1].slice(0, k)];
  return { counts: out, nInc, withP, total: out[0].concat(out[1]).reduce((x, y) => x + y, 0) };
}

// ---------- Alvorlighet, skade og tone ----------

export interface SeverityStats {
  /** høy først (størst vekt øverst) */
  severity: (BarItem & { value: string })[];
  injury: BarItem[];
  sentiment: BarItem[];
  tot: number;
  /** hendelser som er øvelser */
  exercises: number;
}

/** Fordeling på alvorlighet, skade og tone. Ignorerer alvorlighetsfilteret, så alle grader alltid vises. */
export function severityStats(sel: Selection): SeverityStats {
  const { ds } = sel;
  const test = clsTest(ds, sel.cls);
  const sev = ds.app.severities.map(() => 0), inj = ds.app.injuries.map(() => 0), sent = ds.app.sentiments.map(() => 0);
  let tot = 0, exercises = 0;
  const META = ds.col.meta;
  scan(sel, (r) => {
    if (!test(r)) return;
    const m = decodeMeta(META[r]);
    tot++;
    sev[m.severity]++;
    sent[m.sentiment]++;
    inj[m.injury]++;
    if (m.exercise) exercises++;
  }, sel.period.from, sel.period.to, sel.mask, true);
  return {
    severity: ds.app.severities.map((v, k) => ({ key: v, value: v, label: cap1(v), v: sev[k], sel: sel.sev === v })).reverse(),
    injury: ds.app.injuries.map((l, k) => ({ key: l, label: cap1(l), v: inj[k] })),
    sentiment: ds.app.sentiments.map((l, k) => ({ key: l, label: cap1(l), v: sent[k] })),
    tot, exercises,
  };
}

// ---------- Fordeling ----------

export interface Level {
  title: string;
  key: (r: number) => number;
  label: (k: number) => string;
  /** Områdenøkkel for å velge nivået, eller null. */
  geo: (k: number) => string | null;
  /** Samlebøtter (ukjent kommune, uten bydel, uten sted, sjeldne steder). Distriktsindeks 0 er et ekte distrikt. */
  none: (k: number) => boolean;
  /** Folketall for enheten, hvis det finnes for dette nivået. */
  pop?: (k: number) => number | null;
  limit: number;
  note?: string;
  /** Nivået er steder (da heter samlebøtten «uten oppgitt sted», ellers «uten bydel»). */
  places?: boolean;
  /** Hvilke nøkler som teller som «mangler» i merknaden (steder: bare 0 = ikke oppgitt sted). */
  missing?: (k: number) => boolean;
  /** Ordlyd i merknaden: «<n hendelser> … ». */
  missingText?: string;
}

export function childLevel(ds: Dataset, g: GeoInfo, flevel: FLevel = "bydel"): Level {
  const { col, app } = ds;
  const base = { none: (k: number) => !k };
  if (g.kind === "all") {
    return {
      title: "Per politidistrikt", key: (r) => col.district[r], label: (k) => dname(ds, k),
      geo: (k) => `d:${app.districts[k][0]}`, none: () => false, pop: (k) => geoPop(ds, { kind: "d", i: k }), limit: 20,
      note: "Distriktene publiserer svært ulikt. Andel av eget volum egner seg derfor bedre til sammenligning enn antall.",
    };
  }
  if (g.kind === "d") {
    return {
      ...base, title: `Kommuner i ${g.label}`, key: (r) => col.muni[r], label: (k) => muniName(ds, k),
      geo: (k) => (k ? `m:${app.munis[k - 1][0]}` : null), pop: (k) => (k ? app.munis[k - 1][4] ?? null : null), limit: 15,
      missingText: "har ukjent kommune",
    };
  }
  if (g.kind === "a") {
    return { title: "Politiets kategorier på stedet", key: (r) => col.category[r], label: (k) => app.categories[k], geo: () => null, none: () => false, limit: 12 };
  }
  if (g.kind === "m" && g.hasBydel && flevel !== "sted") {
    return {
      ...base, title: `Bydeler i ${g.label}`, key: (r) => col.bydel[r], label: (k) => bydelLabel(ds, k),
      geo: (k) => (k ? `b:${app.bydeler[k - 1].join("|")}` : null), limit: 20, missingText: "er uten bydel",
      note: "«Uten bydel» er veier og tunneler (E6, E18, Ring 3), hendelser uten oppgitt sted og steder som ennå ikke er knyttet til bydel. Bydelstallene er derfor et minimum.",
    };
  }
  return {
    // 0 = hendelsen har ikke oppgitt sted; -1 = har sted, men et sjeldent navn som ikke har egen rad.
    ...base, title: `Steder i ${g.label}`,
    key: (r) => col.area[r] || (app.areaTypes[col.areaType[r]] === "mangler" ? 0 : -1),
    label: (k) => (k > 0 ? areaLabel(areaRow(ds, k)) : k === 0 ? "Uten oppgitt sted" : "Øvrige steder (sjeldne navn)"),
    geo: (k) => (k > 0 ? `a:${k}` : null), limit: 15, places: true, none: (k) => k <= 0, missing: (k) => k === 0, missingText: "har ikke oppgitt sted",
    note: "Steder er stedsnavnene politiet oppgir (strøk, gater, sentrum), vasket og samlet. Klikk et sted for å se bare det.",
  };
}

export type DistMode = "pop" | "share" | "abs";
export const DIST_MODES: DistMode[] = ["pop", "share", "abs"];

/** Færre hendelser av valgt type enn dette gir usikre andeler og rater. */
export const MIN_SAMPLE = 10;

export interface DistItem extends BarItem {
  k: number;
  /** treff på klassen */
  n: number;
  /** alle hendelser i enheten */
  t: number;
  pop: number | null;
  none: boolean;
  /** for få hendelser til å si noe sikkert (ikke samlebøtten) */
  low: boolean;
}

export interface Distribution {
  level: Level;
  /** målene som er tilgjengelige for dette nivået og valget */
  modes: DistMode[];
  mode: DistMode;
  items: DistItem[];
  /** månedsserie per enhet (treff på klassen) */
  series: Map<number, number[]>;
  months: string[];
  partialLast: boolean;
  years: number;
  /** hendelser uten bydel/sted og alle hendelser av valgt type, regnet over alle nøkler (ikke bare de som vises) */
  missingN: number;
  totalN: number;
  hasLow: boolean;
  /** Andel og rate ble byttet ut med antall fordi ingen enhet har nok hendelser. */
  autoAbs: boolean;
}

export function distribution(sel: Selection, dmode: DistMode): Distribution {
  const { ds, geo, test, period: p } = sel;
  const level = childLevel(ds, geo, sel.flevel);
  // Per innbygger finnes bare for kommuner/distrikter; andel gir ikke mening for alle hendelser (alltid 100 %).
  const modes = ([level.pop ? "pop" : null, sel.cls !== "*" ? "share" : null, "abs"] as (DistMode | null)[]).filter((m): m is DistMode => m != null);
  let mode = modes.includes(dmode) ? dmode : modes[0];
  const yrs = years(sel);
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
  // Når ingen enhet har nok hendelser til pålitelige andeler eller rater, vises antall i stedet.
  const autoAbs = mode !== "abs" && ![...n.values()].some((v) => v >= MIN_SAMPLE);
  if (autoAbs) mode = "abs";
  let items: DistItem[] = [...t.keys()].map((k) => {
    const pop = level.pop ? level.pop(k) : null, nk = n.get(k) ?? 0, tk = t.get(k)!, none = level.none(k);
    const v = mode === "share" ? (tk ? nk / tk : 0) : mode === "pop" ? (pop ? (nk / yrs / pop) * 1000 : 0) : nk;
    const low = !none && mode !== "abs" && nk < MIN_SAMPLE;
    return { key: k, k, label: level.label(k), n: nk, t: tk, pop, v, none, low, dim: none || low };
  });
  items = items.filter((i) => !i.none || geo.kind === "m");
  // Største først etter antall, så begrens, så sorter etter valgt mål; «Uten bydel»/øvrige alltid sist.
  items.sort((x, y) => y.n - x.n);
  items = items.slice(0, level.limit);
  items.sort((x, y) => Number(x.none) - Number(y.none) || Number(x.low) - Number(y.low) || y.v - x.v);
  const isMissing = level.missing ?? level.none;
  return {
    level, modes, mode, items, series, months: ds.months.slice(a, b + 1), partialLast: ds.months[b] === ds.last, years: yrs,
    missingN: [...n.entries()].filter(([k]) => isMissing(k)).reduce((s, [, v]) => s + v, 0),
    totalN: [...n.values()].reduce((s, v) => s + v, 0),
    hasLow: items.some((i) => i.low), autoAbs,
  };
}

const plural = (c: number): string => `${NF.format(c)} ${c === 1 ? "hendelse" : "hendelser"}`;

/** Forklaring og merknader under Fordeling. Ren tekst, så den kan testes. */
export function distributionTexts(sel: Selection, d: Distribution, natRate: number): { lede: string; note: string } {
  const { ds, geo, period: p } = sel;
  const L = d.level, what = sel.cls === "*" ? "hendelser" : `hendelser med ${tname(ds, sel.cls).toLowerCase()}`;
  const lede = `${tname(ds, sel.cls)}, ${p.label}. ` + (
    d.mode === "share" ? `Hver søyle viser hvor stor andel av områdets hendelser som er ${what.replace("hendelser med ", "")}. Områder med under ${MIN_SAMPLE} slike hendelser står nederst.`
      : d.mode === "pop" ? `Hendelser per 1 000 innbyggere per år. Områder med under ${MIN_SAMPLE} hendelser står nederst.`
        : `Antall ${what}.`);
  const note = [
    L.note,
    d.autoAbs ? `Viser antall, fordi ingen ${L.places ? "steder" : "områder"} har ${MIN_SAMPLE} hendelser eller flere av denne typen. Andeler og rater ville vært misvisende.` : "",
    d.missingN && d.totalN ? `${plural(d.missingN)} (${PF.format(d.missingN / d.totalN)} av ${NF.format(d.totalN)}) ${L.missingText ?? "er uten bydel"}.` : "",
    !L.pop && geo.kind !== "a" ? "Per innbygger er ikke tilgjengelig her, fordi folketall finnes bare for kommuner og distrikter." : "",
    d.mode === "pop"
      ? `Per innbygger: hendelser per år delt på folketall (SSB ${ds.app.populationYear}). Snittet for hele landet er ${fmt1(natRate)}. Distriktene publiserer ulikt mye, så rater er ikke direkte sammenlignbare. Kommuner med mange besøkende, som byer med uteliv, får høye tall.`
      : "",
    d.hasLow ? `Lysere søyler bygger på under ${MIN_SAMPLE} hendelser og er usikre.` : "",
  ].filter(Boolean).join(" ");
  return { lede, note };
}

// ---------- Steder ----------

export interface AreaStats {
  n: number;
  missing: number;
  /** hendelser plassert i bydel, og hendelser med kjent sted på kartet */
  mapped: number;
  located: number;
  types: (BarItem & { all: number })[];
  /** bydelene i hele kommunen (også når én bydel er valgt) */
  bydeler: (BarItem & { k: number; all: number })[];
  top: { a: number; row: AreaRow; v: number; all: number }[];
}

export function areaStats(sel: Selection, topN = 25): AreaStats {
  const { ds, test, geo } = sel;
  const { col, app } = ds;
  const nT = app.areaTypes.length;
  const types = new Array<number>(nT).fill(0), typesAll = new Array<number>(nT).fill(0);
  const ar = new Map<number, number>(), arAll = new Map<number, number>();
  let n = 0, mapped = 0, located = 0;
  scan(sel, (r) => {
    const y = col.areaType[r], bd = col.bydel[r], a = col.area[r];
    typesAll[y]++;
    if (a) arAll.set(a, (arAll.get(a) ?? 0) + 1);
    if (!test(r)) return;
    n++;
    types[y]++;
    if (bd) mapped++;
    if (a) {
      ar.set(a, (ar.get(a) ?? 0) + 1);
      if (areaRow(ds, a)[3] != null) located++;
    }
  });
  // Bydelslisten viser alltid hele kommunen, også når én bydel er valgt.
  const byd = new Map<number, number>(), bydAll = new Map<number, number>();
  if (geo.hasBydel) {
    const whole = { ...sel, mask: geoMask(ds, geoInfo(ds, `m:${geo.id}`)) };
    scan(whole, (r) => {
      const bd = col.bydel[r];
      bydAll.set(bd, (bydAll.get(bd) ?? 0) + 1);
      if (test(r)) byd.set(bd, (byd.get(bd) ?? 0) + 1);
    });
  }
  const missing = types[app.areaTypes.indexOf("mangler")] ?? 0;
  const typeItems = app.areaTypes
    .map((t, i) => ({ key: t, label: t, v: types[i], all: typesAll[i] }))
    .filter((i) => i.v > 0).sort((a, b) => b.v - a.v);
  const bydItems = [...bydAll.keys()]
    .map((k) => ({ key: k, k, label: bydelLabel(ds, k), v: byd.get(k) ?? 0, all: bydAll.get(k)!, sel: geo.kind === "b" && k === geo.b, dim: !k }))
    .sort((a, b) => Number(!a.k) - Number(!b.k) || b.v - a.v);
  const top = [...ar.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN)
    .map(([a, v]) => ({ a, row: areaRow(ds, a), v, all: arAll.get(a) ?? 0 }));
  return { n, missing, mapped, located, types: typeItems, bydeler: bydItems, top };
}

// ---------- Når ----------

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

export interface SeasonStats {
  /** gjennomsnitt per kalendermåned (jan = 0) */
  avg: number[];
  /** antall hele år med data per kalendermåned */
  cnt: number[];
  mean: number;
  hi: number;
  lo: number;
  fromYear: string;
  toYear: string;
}

/** Gjennomsnitt per kalendermåned over hele datasettet. Første og siste måned er delvise og utelates. */
export function seasonStats(sel: Selection): SeasonStats {
  const { ds, mask, test } = sel;
  const last = ds.months.length - 1, sum = new Array<number>(12).fill(0), cnt = new Array<number>(12).fill(0), M = ds.col.month;
  for (let i = 1; i < last; i++) cnt[+ds.months[i].slice(5) - 1]++;
  for (let r = 0; r < ds.n; r++) {
    const m = M[r];
    if (mask[r] && m > 0 && m < last && test(r)) sum[+ds.months[m].slice(5) - 1]++;
  }
  const avg = sum.map((v, i) => (cnt[i] ? v / cnt[i] : 0));
  const mean = avg.reduce((a, b) => a + b, 0) / 12;
  return {
    avg, cnt, mean, hi: avg.indexOf(Math.max(...avg)), lo: avg.indexOf(Math.min(...avg)),
    fromYear: ds.months[1]?.slice(0, 4) ?? "", toYear: ds.months[last - 1]?.slice(0, 4) ?? "",
  };
}

// ---------- Nøkkelfunn ----------

/**
 * Korte setninger om utvalget. **tekst** markerer det som skal utheves.
 * Kjører flere gjennomganger over dataene, men bare når Oversikt vises.
 */
export function insights(sel: Selection): string[] {
  const { ds, geo, period: p, test } = sel;
  const c = sel.cls, lab = tname(ds, c).toLowerCase(), nTops = ds.app.tops.length;
  const cur = new Array<number>(nTops).fill(0), prv = new Array<number>(nTops).fill(0);
  let n = 0, tot = 0, prev = 0, night = 0, hi = 0, hurt = 0;
  const grid = new Array<number>(168).fill(0), child = new Map<number, number>(), L = childLevel(ds, geo, sel.flevel), places = new Map<number, number>();
  const { col } = ds;
  scan(sel, (r) => {
    tot++;
    countBits(col.tops[r], nTops, cur);
    if (!test(r)) return;
    n++;
    { const m = decodeMeta(col.meta[r]); if (m.severity === 2) hi++; if (m.injury === 2 || m.injury === 3) hurt++; }
    grid[col.hourOfWeek[r]]++;
    const h = col.hourOfWeek[r] % 24;
    if (h >= 22 || h < 6) night++;
    const k = L.key(r);
    if (!L.none(k)) child.set(k, (child.get(k) ?? 0) + 1);
    const pa = col.area[r];
    if (pa) places.set(pa, (places.get(pa) ?? 0) + 1);
  });
  if (p.prev) {
    scan(sel, (r) => {
      if (test(r)) prev++;
      countBits(col.tops[r], nTops, prv);
    }, p.prev[0], p.prev[1]);
  }
  const sevTxt = sel.sev === "*" ? "" : ` med ${sel.sev} alvorlighet`;
  const what = c === "*" ? "hendelser" : `hendelser med ${lab}`, where = inGeoText(geo), pct = (v: number) => `${(Math.round(v * 1000) / 10).toLocaleString("nb-NO")} %`;
  if (!n) return [`Ingen ${what} ${where} i perioden.`];
  const out: string[] = [];
  const f = (v: number) => v.toLocaleString("nb-NO");
  if (p.prev && prev) {
    const ch = (n - prev) / prev;
    const dir = Math.abs(ch) < 0.03 ? "omtrent like mange som" : ch > 0 ? `${pct(ch)} flere enn` : `${pct(-ch)} færre enn`;
    out.push(`**${f(n)}** ${what} ${where} – ${dir} året før (${f(prev)}).`);
  } else out.push(`**${f(n)}** ${what} ${where} i perioden.`);
  if (c === "*") {
    const big = cur.indexOf(Math.max(...cur));
    out.push(`**${tname(ds, ds.app.tops[big])}** er den største typen, med ${pct(cur[big] / tot)} av hendelsene.`);
    if (p.prev) {
      const moves = ds.app.tops
        .map((t, k) => ({ t, ch: prv[k] >= 30 ? (cur[k] - prv[k]) / prv[k] : null }))
        .filter((x): x is { t: string; ch: number } => x.ch != null)
        .sort((a, b) => Math.abs(b.ch) - Math.abs(a.ch));
      if (moves.length && Math.abs(moves[0].ch) >= 0.1) {
        const mv = moves[0], mk = ds.app.tops.indexOf(mv.t);
        out.push(`Størst endring: **${tname(ds, mv.t)}** ${mv.ch > 0 ? "økte" : "falt"} med ${pct(Math.abs(mv.ch))} mot året før (${f(prv[mk])} → ${f(cur[mk])}).`);
      }
    }
  } else {
    // Andelen her mot andelen i hele landet.
    let nAll = 0, totAll = 0;
    const a = monthIndex(ds, p.from), b = monthIndex(ds, p.to);
    for (let r = 0; r < ds.n; r++) {
      const mo = col.month[r];
      if (mo < a || mo > b) continue;
      if (sel.sevIdx >= 0 && (col.meta[r] & 3) !== sel.sevIdx) continue;
      totAll++;
      if (test(r)) nAll++;
    }
    if (geo.kind !== "all" && totAll) out.push(`${cap1(lab)} er **${pct(n / tot)}** av alle hendelser${sevTxt} ${where}, mot ${pct(nAll / totAll)} i hele landet.`);
    else out.push(`${cap1(lab)} er **${pct(n / tot)}** av alle hendelser${sevTxt}.`);
  }
  const best = [...child.entries()].sort((x, y) => y[1] - x[1])[0];
  if (best && child.size > 1) {
    out.push(geo.kind === "a"
      ? `Vanligste kategori hos politiet: **${L.label(best[0])}** (${f(best[1])} hendelser).`
      : `Flest i **${L.label(best[0])}**: ${f(best[1])} hendelser, ${pct(best[1] / n)} av ${what}.`);
  }
  const topPlace = geo.kind === "a" || L.places ? null
    : [...places.entries()].filter(([a]) => !["vei", "kommune", "sentrum"].includes(areaRow(ds, a)[1])).sort((x, y) => y[1] - x[1])[0];
  if (topPlace) {
    const A = areaRow(ds, topPlace[0]);
    out.push(`Mest omtalte sted: **${A[0]}** (${f(topPlace[1])} hendelser${A[2] ? `, bydel ${A[2]}` : ""}).`);
  }
  if (hi && sel.sev === "*") out.push(`**${pct(hi / n)}** av hendelsene er vurdert som alvorlige${hurt ? `, og ${f(hurt)} har alvorlig skade eller dødsfall` : ""}.`);
  const perDay = WD.map((_, d) => grid.slice(d * 24, d * 24 + 24).reduce((s, v) => s + v, 0));
  const bd = perDay.indexOf(Math.max(...perDay));
  const blocks = Array.from({ length: 8 }, (_, k) => {
    let s = 0;
    for (let d = 0; d < 7; d++) for (let h = k * 3; h < k * 3 + 3; h++) s += grid[d * 24 + h];
    return s;
  });
  const bb = blocks.indexOf(Math.max(...blocks));
  const wkday = perDay.slice(0, 5).reduce((x, y) => x + y, 0) / 5, wkend = (perDay[5] + perDay[6]) / 2;
  if (wkday && wkend / wkday >= 1.3) out.push(`**${(Math.round((wkend / wkday) * 10) / 10).toLocaleString("nb-NO")} ganger** så mange per dag i helgene som på hverdager.`);
  const hh = (h: number) => String(h).padStart(2, "0");
  out.push(`Mest aktivt på **${WD[bd].toLowerCase()}er** og mellom **kl. ${hh(bb * 3)} og ${hh(bb * 3 + 3)}**. ${pct(night / n)} skjer mellom kl. 22 og 06.`);
  return out;
}

// ---------- Hvor endrer det seg? ----------

/** Færre personer enn dette gir en for tilfeldig alders- og kjønnsfordeling. */
export const MIN_PERSONS = 30;

/** Færre hendelser enn dette i begge år gir for tilfeldige endringer. */
export const MIN_CHANGE = 10;

export interface ChangeItem extends BarItem {
  k: number;
  /** nå og året før */
  c: number;
  o: number;
  d: number;
  /** områdenøkkel for å velge enheten, eller null */
  geo: string | null;
}

export interface ChangeStats {
  /** Skjules for ett enkelt sted: for få hendelser. */
  applicable: boolean;
  /** Finnes det en sammenligningsperiode? */
  hasPrev: boolean;
  title: string;
  ups: ChangeItem[];
  downs: ChangeItem[];
  /** Advarsel når andelen hendelser uten sted/bydel er klart ulik i de to periodene. */
  drift: string | null;
}

/** Største endringer mot samme periode året før, på nivået under valgt område. */
export function changeStats(sel: Selection, top = 5): ChangeStats {
  const { ds, geo, period: p, test } = sel;
  const L = childLevel(ds, geo, sel.flevel);
  const title = `Hvor endrer det seg? ${L.title.replace(/^Per /, "per ")}`.trim();
  if (geo.kind === "a") return { applicable: false, hasPrev: false, title, ups: [], downs: [], drift: null };
  if (!p.prev) return { applicable: true, hasPrev: false, title, ups: [], downs: [], drift: null };
  const cur = new Map<number, number>(), prv = new Map<number, number>();
  const count = (m: Map<number, number>) => (r: number) => {
    if (!test(r)) return;
    const k = L.key(r);
    if (!L.none(k)) m.set(k, (m.get(k) ?? 0) + 1);
  };
  scan(sel, count(cur));
  scan(sel, count(prv), p.prev[0], p.prev[1]);
  // Er andelen hendelser uten sted/bydel ulik i de to periodene, er endringer per område usikre.
  const cov = { c: [0, 0], o: [0, 0] };
  scan(sel, (r) => { cov.c[1]++; if (L.none(L.key(r))) cov.c[0]++; });
  scan(sel, (r) => { cov.o[1]++; if (L.none(L.key(r))) cov.o[0]++; }, p.prev[0], p.prev[1]);
  const shareC = cov.c[1] ? cov.c[0] / cov.c[1] : 0, shareO = cov.o[1] ? cov.o[0] / cov.o[1] : 0;
  const drift = Math.abs(shareC - shareO) > 0.1 && geo.kind !== "all"
    ? `Merk: andelen hendelser ${L.places ? "uten oppgitt sted" : "uten bydel"} var ${PF.format(shareC)} nå mot ${PF.format(shareO)} året før, så endringer per område er usikre.`
    : null;
  const rows: ChangeItem[] = [...new Set([...cur.keys(), ...prv.keys()])]
    .map((k) => ({ key: k, k, label: L.label(k), c: cur.get(k) ?? 0, o: prv.get(k) ?? 0, d: 0, v: 0, geo: L.geo(k) }))
    .filter((x) => Math.max(x.c, x.o) >= MIN_CHANGE)
    .map((x) => ({ ...x, d: x.c - x.o }));
  return {
    applicable: true, hasPrev: true, title, drift,
    ups: rows.filter((x) => x.d > 0).sort((a, b) => b.d - a.d).slice(0, top).map((x) => ({ ...x, v: x.d })),
    downs: rows.filter((x) => x.d < 0).sort((a, b) => a.d - b.d).slice(0, top).map((x) => ({ ...x, v: -x.d, neg: true })),
  };
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

export function mapPoints(sel: Selection): { pts: MapPoint[]; located: number; total: number; byd: Map<number, number> } {
  const { ds, test } = sel;
  const A = ds.col.area, B = ds.col.bydel, cnt = new Map<number, number>(), byd = new Map<number, number>();
  let located = 0, total = 0;
  scan(sel, (r) => {
    if (!test(r)) return;
    total++;
    const a = A[r];
    if (a && ds.app.areas[a - 1][3] != null) {
      located++;
      cnt.set(a, (cnt.get(a) ?? 0) + 1);
    }
    if (B[r]) byd.set(B[r], (byd.get(B[r]) ?? 0) + 1);
  }, sel.period.from, sel.period.to, mapMask(ds, sel.geo, sel.mask));
  const pts = [...cnt.entries()].map(([a, v]) => {
    const row = areaRow(ds, a);
    return { a, v, row, lat: row[3]!, lon: row[4]! };
  });
  return { pts, located, total, byd };
}

export type LatLngBounds = [[number, number], [number, number]];
export const NORWAY: LatLngBounds = [[57.8, 4.5], [71.3, 31.5]];

/**
 * Utsnitt for valgt område: 4.–96. persentil av stedfestede hendelser, ikke kommunegrensen
 * (ellers blir f.eks. Oslo dominert av Marka).
 */
export function geoBounds(ds: Dataset, geo: GeoInfo, mask: Uint8Array): LatLngBounds {
  if (geo.kind === "all") return NORWAY;
  if (geo.kind === "a") {
    const A = areaRow(ds, geo.a ?? 0);
    return A[3] != null && A[4] != null ? [[A[3] - 0.02, A[4] - 0.035], [A[3] + 0.02, A[4] + 0.035]] : NORWAY;
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
  return [[q(lats, 0.04) - 0.004, q(lons, 0.04) - 0.008], [q(lats, 0.96) + 0.004, q(lons, 0.96) + 0.008]];
}

// ---------- Hendelser ----------

/** Antall hendelser av valgt type i valgt område og periode (alle, ikke bare utvalget i Hendelser). */
export function eventCount(sel: Selection): number {
  let n = 0;
  scan(sel, (r) => { if (sel.test(r)) n++; });
  return n;
}

/** Utvalget av hendelser (samples) etter område, klasse, fritekst og periode. Listen tar med inneværende måned. */
export function filterSamples(ds: Dataset, geo: GeoInfo, cls: string, query: string, period: PeriodInfo, sev = "*"): Sample[] {
  const q = query.trim().toLowerCase();
  const inGeo = (s: Sample) =>
    geo.kind === "all" || (geo.kind === "d" && s.d === geo.i) || (geo.kind === "m" && s.k === geo.k) || (geo.kind === "b" && s.b === geo.b) || (geo.kind === "a" && s.a === geo.a);
  const inCls = (s: Sample) => cls === "*" || s.classes.some((x) => x === cls || topOf(ds, x) === cls);
  const inText = (s: Sample) => !q || `${s.text} ${s.update ?? ""} ${s.area ?? ""} ${s.municipality} ${s.category}`.toLowerCase().includes(q);
  const to = period.key === "12m" ? ds.last : period.to;
  const inPer = (s: Sample) => {
    const m = new Date(s.created).toLocaleDateString("sv-SE", { timeZone: "Europe/Oslo" }).slice(0, 7);
    return m >= period.from && m <= to;
  };
  return ds.app.samples.filter((s) => inGeo(s) && inCls(s) && inText(s) && inPer(s) && (sev === "*" || s.severity === sev));
}
