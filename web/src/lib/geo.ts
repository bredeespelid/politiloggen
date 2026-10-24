import { dname, muniName, type Dataset } from "../data/dataset";

/**
 * Områdenøkkel i filteret:
 *   "all" | "d:<distrikts-id>" | "m:<kommunenr>" | "b:<kommunenr>|<bydel>"
 */
export type GeoKey = string;

export interface GeoInfo {
  kind: "all" | "d" | "m" | "b";
  label: string;
  /** distriktsindeks (kind d) */
  i?: number;
  /** kommuneindeks (kind m, b) */
  k?: number;
  /** kommunenummer (kind m, b) */
  id?: string;
  /** bydelsindeks (kind b) */
  b?: number;
  hasBydel: boolean;
}

export function isValidGeo(ds: Dataset, g: string): boolean {
  if (g === "all") return true;
  const id = g.slice(2);
  if (g.startsWith("d:")) return ds.distIdx.has(id);
  if (g.startsWith("m:")) return ds.muniIdx.has(id);
  if (g.startsWith("b:")) return ds.bydelIdx.has(id);
  return false;
}

export function geoInfo(ds: Dataset, g: GeoKey): GeoInfo {
  if (g === "all" || !isValidGeo(ds, g)) return { kind: "all", label: "Hele landet", hasBydel: false };
  const kind = g[0] as "d" | "m" | "b";
  const id = g.slice(2);
  if (kind === "d") {
    const i = ds.distIdx.get(id)!;
    return { kind, i, label: dname(ds, i), hasBydel: false };
  }
  if (kind === "m") {
    const k = ds.muniIdx.get(id)!;
    return { kind, k, id, label: muniName(ds, k), hasBydel: ds.app.bydeler.some((b) => b[0] === id) };
  }
  const b = ds.bydelIdx.get(id)!;
  const [mid, name] = id.split("|");
  const k = ds.muniIdx.get(mid) ?? 0;
  return { kind, b, id: mid, k, label: `${name} (${muniName(ds, k)})`, hasBydel: true };
}

/** 1 for hendelser i valgt område, ellers 0. */
export function geoMask(ds: Dataset, g: GeoInfo): Uint8Array {
  const mask = new Uint8Array(ds.n);
  const { col } = ds;
  if (g.kind === "all") mask.fill(1);
  else if (g.kind === "d") for (let r = 0; r < ds.n; r++) mask[r] = col.district[r] === g.i ? 1 : 0;
  else if (g.kind === "m") for (let r = 0; r < ds.n; r++) mask[r] = col.muni[r] === g.k ? 1 : 0;
  else for (let r = 0; r < ds.n; r++) mask[r] = col.bydel[r] === g.b ? 1 : 0;
  return mask;
}
