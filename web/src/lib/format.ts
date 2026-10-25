export const NF = new Intl.NumberFormat("nb-NO");
export const PF = new Intl.NumberFormat("nb-NO", { style: "percent", maximumFractionDigits: 1 });
const DF = new Intl.DateTimeFormat("nb-NO", { timeZone: "Europe/Oslo", dateStyle: "medium", timeStyle: "short" });

export const fmtNum = (v: number): string => NF.format(v);
export const fmtPct = (v: number): string => PF.format(v);
export const fmtDate = (iso: string): string => DF.format(new Date(iso));

export const MON = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"];
export const WD = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];

/** "2025-03" -> "mar 25" */
export const mlabel = (m: string): string => `${MON[+m.slice(5) - 1]} ${m.slice(2, 4)}`;

export const pad2 = (h: number): string => String(h).padStart(2, "0");

export const ATYPE_NAME: Record<string, string> = {
  "strøk": "Strøk/tettsted", sentrum: "Sentrum", gate: "Gate/adresse", vei: "Vei/tunnel/bro",
  natur: "Natur/sjø", virksomhet: "Virksomhet/anlegg", kollektiv: "Kollektiv/kai",
  kommune: "Bare kommunenavn", mangler: "Mangler område",
};

/** Politiets kategori -> vår overklasse, brukt til å måle hvor mye klassifiseringen fanger utenfor kategorien. */
export const CAT_TO_TOP: Record<string, string> = {
  Voldshendelse: "vold", Trafikk: "trafikk", "Ro og orden": "ro", Brann: "brann", Tyveri: "vinning",
  Innbrudd: "vinning", Skadeverk: "vinning", Ulykke: "ulykke", Redning: "ulykke", "Sjø": "ulykke", Savnet: "savnet",
};

export const MONTH_FULL = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];

export const OUT_LABEL: Record<string, string> = {
  "pågrepet": "Pågrepet", anmeldt: "Anmeldt", innbrakt: "Innbrakt (tatt med til politiet)", bortvist: "Bortvist",
  "førerkortbeslag": "Førerkort beslaglagt", forelegg: "Bot (forelegg)", siktet: "Siktet", funnet: "Funnet (savnet/gjenstand)",
};

/** Aldersgruppe fra datafilen til akseetikett: barn -> «<10», 20-årene -> «20–29», 80+ -> «80+». */
export const ageLabel = (a: string): string => (a === "barn" ? "<10" : a === "80+" ? "80+" : `${a.slice(0, 2)}–${+a.slice(0, 2) + 9}`);

export const cap1 = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Én desimal: 5,6 */
export const fmt1 = (v: number): string => NF.format(Math.round(v * 10) / 10);

/**
 * Toppen av y-aksen: fire like trinn der hvert trinn er et helt «pent» tall (1, 2, 5 × 10^n),
 * så akseetikettene blir heltall.
 */
export function nice(max: number): number {
  const raw = Math.max(1, max) / 4;
  const p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  const step = Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p);
  return step * 4;
}
