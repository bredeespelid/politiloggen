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

/** Avrunder opp til en "pen" akseverdi (1, 2, 2,5, 5, 10 × 10^n). */
export function nice(max: number): number {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  const f = max / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
