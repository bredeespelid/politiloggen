import { areaLabel, dname, muniName, type Dataset } from "../data/dataset";

/**
 * Områdenøkkel i filteret:
 *   "all" | "d:<distrikts-id>" | "m:<kommunenr>" | "b:<kommunenr>|<bydel>" | "a:<stedsindeks>"
 * der a er ett enkelt sted (f.eks. Grønland), 1-basert indeks i app.json «areas».
 */
export type GeoKey = string;

export interface GeoInfo {
  kind: "all" | "d" | "m" | "b" | "a";
  label: string;
  /** distriktsindeks (kind d) */
  i?: number;
  /** kommuneindeks (kind m, b, a) */
  k?: number;
  /** kommunenummer (kind m, b, a) */
  id?: string;
  /** bydelsindeks (kind b) */
  b?: number;
  /** stedsindeks (kind a) */
  a?: number;
  hasBydel: boolean;
}

/** Veier og tunneler er ikke steder man kan velge (E6, Ring 3 osv.). */
export const isSelectableArea = (ds: Dataset, a: number): boolean => {
  const A = ds.app.areas[a - 1];
  return !!A && A[1] !== "vei";
};

export function isValidGeo(ds: Dataset, g: string): boolean {
  if (g === "all") return true;
  const id = g.slice(2);
  if (g.startsWith("d:")) return ds.distIdx.has(id);
  if (g.startsWith("m:")) return ds.muniIdx.has(id);
  if (g.startsWith("b:")) return ds.bydelIdx.has(id);
  if (g.startsWith("a:")) return /^\d+$/.test(id) && isSelectableArea(ds, +id);
  return false;
}

export function geoInfo(ds: Dataset, g: GeoKey): GeoInfo {
  if (g === "all" || !isValidGeo(ds, g)) return { kind: "all", label: "Hele landet", hasBydel: false };
  const kind = g[0] as "d" | "m" | "b" | "a";
  const id = g.slice(2);
  if (kind === "d") {
    const i = ds.distIdx.get(id)!;
    return { kind, i, label: dname(ds, i), hasBydel: false };
  }
  if (kind === "m") {
    const k = ds.muniIdx.get(id)!;
    return { kind, k, id, label: muniName(ds, k), hasBydel: ds.app.bydeler.some((b) => b[0] === id) };
  }
  if (kind === "a") {
    const a = +id, A = ds.app.areas[a - 1];
    return { kind, a, k: A[5], id: ds.app.munis[A[5] - 1]?.[0], label: `${areaLabel(A)}, ${muniName(ds, A[5])}`, hasBydel: false };
  }
  const b = ds.bydelIdx.get(id)!;
  const [mid, name] = id.split("|");
  const k = ds.muniIdx.get(mid) ?? 0;
  return { kind, b, id: mid, k, label: `${name} (${muniName(ds, k)})`, hasBydel: true };
}

/**
 * Folketall (SSB) for valgt område. null for bydeler og steder (folketall finnes ikke, og
 * sentrum har få beboere) og når kommunen mangler folketall.
 */
export function geoPop(ds: Dataset, g: Pick<GeoInfo, "kind" | "k" | "i">): number | null {
  const { munis, districts } = ds.app;
  if (g.kind === "m") return munis[(g.k ?? 0) - 1]?.[4] || null;
  if (g.kind === "d") {
    const id = String(districts[g.i ?? 0][0]);
    return munis.filter((m) => String(m[2]) === id).reduce((s, m) => s + (m[4] || 0), 0) || null;
  }
  if (g.kind === "all") return munis.reduce((s, m) => s + (m[4] || 0), 0) || null;
  return null;
}

/** 1 for hendelser i valgt område, ellers 0. */
export function geoMask(ds: Dataset, g: GeoInfo): Uint8Array {
  const mask = new Uint8Array(ds.n);
  const { col } = ds;
  if (g.kind === "all") mask.fill(1);
  else if (g.kind === "d") for (let r = 0; r < ds.n; r++) mask[r] = col.district[r] === g.i ? 1 : 0;
  else if (g.kind === "m") for (let r = 0; r < ds.n; r++) mask[r] = col.muni[r] === g.k ? 1 : 0;
  else if (g.kind === "a") for (let r = 0; r < ds.n; r++) mask[r] = col.area[r] === g.a ? 1 : 0;
  else for (let r = 0; r < ds.n; r++) mask[r] = col.bydel[r] === g.b ? 1 : 0;
  return mask;
}

/** Hendelsene som vises på kartet: valgt område, men for ett enkelt sted hele kommunen så stedet ses i sammenheng. */
export function mapMask(ds: Dataset, g: GeoInfo, mask: Uint8Array): Uint8Array {
  if (g.kind !== "a") return mask;
  return geoMask(ds, { kind: "m", k: g.k, label: "", hasBydel: false });
}

// ---------- Finn sted ----------

/** Steder som kan velges i «Finn sted»: minst så mange hendelser, og ikke veier. */
export const MIN_PLACE_COUNT = 5;

export interface PlaceOption {
  /** «Grønland, Oslo» */
  value: string;
  a: number;
}

/** De mest brukte stedsnavnene, mest brukt først, med ett valg per «Navn, Kommune». */
export function placeOptions(ds: Dataset): PlaceOption[] {
  const seen = new Set<string>(), out: PlaceOption[] = [];
  ds.app.areas
    .map((A, i) => ({ A, a: i + 1 }))
    .filter((x) => x.A[7] >= MIN_PLACE_COUNT && x.A[1] !== "vei")
    .sort((x, y) => y.A[7] - x.A[7])
    .forEach(({ A, a }) => {
      const value = `${A[0]}, ${muniName(ds, A[5])}`;
      if (seen.has(value)) return;
      seen.add(value);
      out.push({ value, a });
    });
  return out;
}

/**
 * Slår opp det brukeren skrev: eksakt treff, ellers treffene som begynner med teksten.
 * Ved flere treff vinner stedet i gjeldende kommune (preferMuni), ellers det mest brukte.
 * Returnerer hele valget, så feltet kan vise det fullstendige navnet.
 */
export function resolvePlace(options: PlaceOption[], text: string, preferMuni?: string | null): PlaceOption | null {
  const v = text.trim().toLowerCase();
  if (!v) return null;
  const exact = options.find((o) => o.value.toLowerCase() === v);
  if (exact) return exact;
  const hits = options.filter((o) => o.value.toLowerCase().startsWith(v));
  return (preferMuni ? hits.find((o) => o.value.endsWith(`, ${preferMuni}`)) : undefined) ?? hits[0] ?? null;
}
