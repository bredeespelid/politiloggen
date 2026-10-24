// Tynn klient mot Politiloggen API (https://api.politiloggen.politiet.no).
// Data under NLOD 2.0 – kilde må krediteres med lenke til www.politiet.no/politiloggen.

export const BASE_URL = process.env.POLITILOGGEN_BASE_URL ?? "https://api.politiloggen.politiet.no";

export const DISTRICTS = {
  Oslo: 201,
  Øst: 202,
  Innlandet: 203,
  SørØst: 204,
  Agder: 205,
  SørVest: 206,
  Vest: 207,
  MøreOgRomsdal: 208,
  Trøndelag: 209,
  Nordland: 210,
  Troms: 211,
  Finnmark: 212,
} as const;

export type District = keyof typeof DISTRICTS;
export const DISTRICT_NAMES = Object.keys(DISTRICTS) as [District, ...District[]];

export const TIME_SPANS = ["LastHour", "LastDay", "LastWeek", "LastMonth", "LastQuarter", "LastYear"] as const;
export type TimeSpan = (typeof TIME_SPANS)[number];

export interface ThreadMessage {
  id: string;
  text: string | null;
  createdOn: string;
  updatedOn: string;
  hasImage: boolean;
  previouslyIncludedImage: boolean;
  type: "Draft" | "Published" | "Edited" | "Removed";
}

export interface MessageThread {
  id: string;
  district: string | null;
  districtId: number;
  category: string | null;
  municipality: string | null;
  area: string | null;
  createdOn: string;
  updatedOn: string;
  lastMessageOn: string;
  isActive: boolean;
  messages: ThreadMessage[];
}

export interface Category {
  id: string;
  name: string;
}

export interface DistrictWithMunicipalities {
  district: { id: number; name: string };
  municipalities: { id: string; name: string }[];
}

type Query = Record<string, string | number | boolean | (string | number)[] | undefined>;

async function get<T>(path: string, query: Query = {}): Promise<T> {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(v));
  }
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "politiloggen-mcp" },
    signal: AbortSignal.timeout(20_000),
  });
  // APIet svarer 400 (ikke 404) for ukjente IDer.
  if (res.status === 404 || (res.status === 400 && path.split("/").length > 2)) throw new NotFoundError(path);
  if (!res.ok) throw new Error(`Politiloggen API svarte ${res.status} ${res.statusText} for ${url.pathname}`);
  return (await res.json()) as T;
}

export class NotFoundError extends Error {
  constructor(path: string) {
    super(`Fant ikke ${path}`);
  }
}

export interface ThreadSearch {
  districts?: District[];
  municipalities?: string[];
  categories?: string[];
  area?: string;
  timeSpan?: TimeSpan;
  from?: string;
  to?: string;
  activeOnly?: boolean;
  oldestFirst?: boolean;
  take?: number;
  skip?: number;
}

export function searchThreads(s: ThreadSearch) {
  const custom = Boolean(s.from || s.to);
  return get<{ messageThreads: MessageThread[] | null; hasMoreResults: boolean }>("/messagethreads", {
    DistrictIds: s.districts?.map((d) => DISTRICTS[d]),
    Municipalities: s.municipalities,
    Category: s.categories,
    Area: s.area,
    TimeSpanType: custom ? "Custom" : s.timeSpan,
    DateTimeFrom: s.from,
    DateTimeTo: s.to,
    IsActiveEnum: s.activeOnly ? "Active" : undefined,
    SortByEnum: "LastMessageOn",
    SortByAsc: s.oldestFirst ? true : undefined,
    Take: s.take,
    Skip: s.skip,
  });
}

export const getThread = (id: string) => get<MessageThread>(`/messagethreads/${encodeURIComponent(id)}`);
export const getCategories = () => get<Category[]>("/categories");
export const getDistricts = () => get<DistrictWithMunicipalities[]>("/districts/extended");
