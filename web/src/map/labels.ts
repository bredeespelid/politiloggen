import type { AppData, AreaRow, Ring } from "../data/types";

export interface BydelLabel {
  mid: string;
  name: string;
  lat: number;
  lon: number;
}

/** Tyngdepunkt (arealvektet) av en lukket ring av [lon, lat]. */
export function polyCentroid(ring: Ring): [number, number] {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1], f = x1 * y2 - x2 * y1;
    a += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  a *= 3;
  return a ? [cx / a, cy / a] : ring[0];
}

/**
 * Bydelsetiketter: tyngdepunktet av bydelens største polygon (OSM). Der grensen mangler,
 * brukes medianen av de geokodede stedene i bydelen (minst tre).
 */
export function bydelLabels(app: Pick<AppData, "areas" | "munis" | "bydelGeo">): BydelLabel[] {
  const out: BydelLabel[] = [], seen = new Set<string>();
  for (const [mid, byName] of Object.entries(app.bydelGeo ?? {})) {
    for (const [name, rings] of Object.entries(byName)) {
      if (!rings.length) continue;
      const big = rings.slice().sort((x, y) => y.length - x.length)[0];
      const [lon, lat] = polyCentroid(big);
      out.push({ mid, name, lat, lon });
      seen.add(`${mid}|${name}`);
    }
  }
  const acc: Record<string, { mid: string; name: string; lat: number[]; lon: number[] }> = {};
  for (const A of app.areas as AreaRow[]) {
    if (!A[2] || A[3] == null || A[4] == null) continue;
    const mid = app.munis[A[5] - 1]?.[0];
    if (!mid || seen.has(`${mid}|${A[2]}`)) continue;
    const e = (acc[`${mid}|${A[2]}`] ??= { mid, name: A[2], lat: [], lon: [] });
    e.lat.push(A[3]);
    e.lon.push(A[4]);
  }
  const med = (a: number[]) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
  for (const b of Object.values(acc)) if (b.lat.length >= 3) out.push({ mid: b.mid, name: b.name, lat: med(b.lat), lon: med(b.lon) });
  return out;
}

/** Plasserte etiketter, i kartets pikselkoordinater (x, y = senter, w = bredde). */
export interface Placed {
  x: number;
  y: number;
  w: number;
}

/** Plass til en etikett uten å overlappe de som allerede er plassert? */
export const labelFits = (placed: Placed[], x: number, y: number, w: number): boolean =>
  !placed.some((q) => Math.abs(q.x - x) < (q.w + w) / 2 && Math.abs(q.y - y) < 12);

export type LabelDir = "right" | "left" | "top" | "bottom";

/** De fire plasseringene rundt et punkt, i prioritert rekkefølge. */
export function labelCandidates(x: number, y: number, w: number): { dir: LabelDir; x: number; y: number; offset: [number, number] }[] {
  return [
    { dir: "right", x: x + 6 + w / 2, y, offset: [6, 0] },
    { dir: "left", x: x - 6 - w / 2, y, offset: [-6, 0] },
    { dir: "top", x, y: y - 14, offset: [0, -8] },
    { dir: "bottom", x, y: y + 14, offset: [0, 8] },
  ];
}

/** Første kandidat som får plass; registreres i placed. */
export function placeLabel(placed: Placed[], x: number, y: number, w: number): { dir: LabelDir; offset: [number, number] } | null {
  const c = labelCandidates(x, y, w).find((cand) => labelFits(placed, cand.x, cand.y, w));
  if (!c) return null;
  placed.push({ x: c.x, y: c.y, w });
  return { dir: c.dir, offset: c.offset };
}
