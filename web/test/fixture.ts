import { encodeValue } from "../src/data/decode";
import type { AppData, RecField, RecFieldName } from "../src/data/types";

export const REC_FIELDS: RecField[] = [
  ["month", 1], ["hourOfWeek", 2], ["district", 1], ["muni", 2], ["category", 1], ["tops", 2],
  ["subs", 5], ["outcomes", 1], ["persons", 3], ["area", 3], ["areaType", 1], ["bydel", 1], ["weapon", 1],
];

export type Rec = Partial<Record<RecFieldName, number>>;

/** Kodet person: kjønn 0 = mann, 1 = kvinne; alder 0 = 10-årene … */
export const person = (gender: 0 | 1, age: number): number => 1 + gender * 8 + age;
export const persons = (...codes: number[]): number => codes.reduce((p, c) => p * 32 + c, 0);

export function encodeRecs(recs: Rec[], fields = REC_FIELDS): string {
  return recs.map((r) => fields.map(([f, w]) => encodeValue(r[f] ?? 0, w)).join("")).join("");
}

/**
 * Lite syntetisk datasett:
 *   tops: vold(bit 0), trafikk(bit 1); subs: vold.kniv(0), vold.ran(1), trafikk.rus(2)
 *   distrikter: 0 = Oslo (201), 1 = Vest (207); kommuner: 1 = Oslo (0301), 2 = Bergen (4601)
 *   bydeler: 1 = Oslo|Frogner, 2 = Oslo|Sagene
 *   måneder: 2024-12 (0), 2025-01 (1), 2025-02 (2)
 */
export const RECS: Rec[] = [
  { month: 0, hourOfWeek: 0, district: 0, muni: 1, category: 1, tops: 1, subs: 1, outcomes: 1, persons: persons(person(0, 1)), area: 1, areaType: 2, bydel: 1, weapon: 1 },
  { month: 1, hourOfWeek: 24 * 5 + 23, district: 0, muni: 1, category: 1, tops: 1, subs: 3, outcomes: 3, persons: persons(person(0, 1), person(1, 2)), area: 1, areaType: 2, bydel: 1, weapon: 1 },
  { month: 1, hourOfWeek: 24 * 6 + 2, district: 0, muni: 1, category: 2, tops: 2, subs: 4, outcomes: 0, persons: 0, area: 2, areaType: 3, bydel: 2 },
  { month: 2, hourOfWeek: 24 * 6 + 2, district: 0, muni: 1, category: 2, tops: 3, subs: 4 | 2, outcomes: 2, persons: persons(person(1, 7), person(1, 7), person(0, 0)), area: 0, areaType: 0, bydel: 0 },
  { month: 2, hourOfWeek: 10, district: 1, muni: 2, category: 1, tops: 1, subs: 1, outcomes: 0, persons: 0, area: 3, areaType: 1, bydel: 0 },
  { month: 0, hourOfWeek: 11, district: 1, muni: 2, category: 0, tops: 0, subs: 0, outcomes: 0, persons: 0, area: 0, areaType: 0, bydel: 0 },
];

export function makeFixture(recs: Rec[] = RECS): AppData {
  return {
    generated: "2025-02-15T12:00:00+00:00",
    span: ["2024-12-01T00:00:00+00:00", "2025-02-15T00:00:00+00:00"],
    classifier: "regex-v1",
    areaClassifier: "area-v1",
    recFields: REC_FIELDS,
    rec: encodeRecs(recs),
    months: ["2024-12", "2025-01", "2025-02"],
    tops: ["vold", "trafikk"],
    subs: ["vold.kniv", "vold.ran", "trafikk.rus"],
    taxonomy: {
      vold: { parent: null, name: "Vold" },
      trafikk: { parent: null, name: "Trafikk" },
      "vold.kniv": { parent: "vold", name: "Kniv/stikkvåpen" },
      "vold.ran": { parent: "vold", name: "Ran" },
      "trafikk.rus": { parent: "trafikk", name: "Ruskjøring" },
    },
    districts: [[201, "Oslo politidistrikt"], [207, "Vest politidistrikt"]],
    munis: [["0301", "Oslo", 201, 4, 700000], ["4601", "Bergen", 207, 2, 300000]],
    populationYear: "2026",
    categories: ["Andre hendelser", "Voldshendelse", "Trafikk"],
    areaTypes: ["mangler", "strøk", "sentrum", "gate", "vei", "kollektiv", "virksomhet", "natur", "kommune"],
    outcomes: ["pågrepet", "anmeldt", "innbrakt", "bortvist", "førerkortbeslag", "forelegg"],
    ages: ["10-årene", "20-årene", "30-årene", "40-årene", "50-årene", "60-årene", "70-årene", "80-årene"],
    weapons: ["kniv", "skytevåpen"],
    bydeler: [["0301", "Frogner"], ["0301", "Sagene"]],
    areas: [
      ["Sentrum", "sentrum", "Frogner", 59.91, 10.73, 1, "sentrum", 6],
      ["Storgata", "gate", "Sagene", 59.92, 10.75, 1, "storgata", 5],
      ["Fana", "strøk", null, null, null, 2, "fana", 2],
      ["E6", "vei", null, 59.8, 10.8, 1, "e6", 9],
    ],
    bydelGeo: {
      "0301": {
        // kvadrat 0–2 i begge retninger: tyngdepunkt (1, 1)
        Frogner: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
        // 3 punkter finnes ikke her, så Sagene faller tilbake til medianen av stedene
      },
    },
    distinctAreas: { raw: 5, keys: 3 },
    samples: [],
    variants: {},
    counts: {},
    example: {},
    fylker: [],
    kommuner: [],
  };
}
