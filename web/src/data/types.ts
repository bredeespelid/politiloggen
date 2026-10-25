/** Formatet til app.json, slik det skrives av scripts/build_app_data.py. */

export type RecFieldName =
  | "month" | "hourOfWeek" | "district" | "muni" | "category" | "tops" | "subs"
  | "outcomes" | "persons" | "area" | "areaType" | "bydel" | "weapon";

/** [feltnavn, antall base64-tegn] */
export type RecField = [RecFieldName, number];

export interface TaxonomyEntry {
  parent: string | null;
  name: string;
}

export interface Person {
  kjønn: string;
  alder: string;
}

export interface Sample {
  id: string;
  category: string;
  municipality: string;
  area: string | null;
  created: string;
  messages: number;
  active: boolean;
  /** første melding */
  text: string;
  /** siste melding, når den er en annen enn den første */
  update?: string | null;
  classes: string[];
  weapon: string | null;
  outcome: string[];
  persons: Person[];
  /** distriktsindeks (0-basert) */
  d: number;
  /** kommuneindeks (1-basert, 0 = ukjent) */
  k: number;
  /** bydelsindeks (1-basert, 0 = ingen) */
  b: number;
  /** stedsindeks (1-basert, 0 = ukjent sted) */
  a: number;
}

/** Ring av [lon, lat]-punkter. */
export type Ring = [number, number][];

export interface Fylke {
  name: string;
  rings: Ring[];
}

export interface Kommune {
  id: string;
  name: string;
  rings: Ring[];
  /** [minLon, minLat, maxLon, maxLat] */
  bbox: [number, number, number, number];
}

/** [navn, type, bydel, lat, lon, kommuneindeks, nøkkel, antall hendelser] */
export type AreaRow = [string, string, string | null, number | null, number | null, number, string, number];

/** [kommunenr, navn, distrikts-id, antall hendelser, folketall (SSB) eller null] */
export type MuniRow = [string, string, number, number, (number | null)?];

export interface AppData {
  generated: string;
  span: [string, string];
  classifier: string;
  areaClassifier: string;
  recFields: RecField[];
  rec: string;
  months: string[];
  tops: string[];
  subs: string[];
  taxonomy: Record<string, TaxonomyEntry>;
  /** [distrikts-id, navn] */
  districts: [number, string][];
  munis: MuniRow[];
  /** året folketallene i munis gjelder */
  populationYear?: string;
  categories: string[];
  areaTypes: string[];
  outcomes: string[];
  ages: string[];
  weapons: string[];
  /** [kommunenr, bydelsnavn] */
  bydeler: [string, string][];
  areas: AreaRow[];
  distinctAreas: { raw: number; keys: number };
  samples: Sample[];
  /** kommunenr -> [[nøkkel, [råverdier]]] */
  variants: Record<string, [string, string[]][]>;
  counts: Record<string, number>;
  example: Record<string, unknown[][]>;
  fylker: Fylke[];
  kommuner: Kommune[];
  /** bydelsgrenser (OSM): kommunenr -> bydel -> ringer av [lon, lat]. Mangler eller er tom hvis de ikke er hentet. */
  bydelGeo?: Record<string, Record<string, Ring[]>>;
}
