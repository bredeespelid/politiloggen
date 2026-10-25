import type { AreaRow } from "../data/types";

export interface BydelLabel {
  name: string;
  lat: number;
  lon: number;
}

/** Bydelsetiketter: midtpunktet (medianen) av de geokodede stedene i hver bydel. */
export function bydelLabels(areas: AreaRow[]): BydelLabel[] {
  const acc: Record<string, { name: string; lat: number[]; lon: number[] }> = {};
  for (const A of areas) {
    if (!A[2] || A[3] == null || A[4] == null) continue;
    const e = (acc[`${A[5]}|${A[2]}`] ??= { name: A[2], lat: [], lon: [] });
    e.lat.push(A[3]);
    e.lon.push(A[4]);
  }
  const med = (a: number[]) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
  return Object.values(acc).filter((b) => b.lat.length >= 3).map((b) => ({ name: b.name, lat: med(b.lat), lon: med(b.lon) }));
}

/** Plasserte etiketter, i kartets pikselkoordinater (x = senter, w = bredde). */
export interface Placed {
  x: number;
  y: number;
  w: number;
}

/** Plass til en etikett uten å overlappe de som allerede er plassert? */
export const labelFits = (placed: Placed[], x: number, y: number, w: number): boolean =>
  !placed.some((q) => Math.abs(q.x - x) < (q.w + w) / 2 && Math.abs(q.y - y) < 16);
