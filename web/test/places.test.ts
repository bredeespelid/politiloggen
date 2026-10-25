import { describe, expect, it } from "vitest";
import { buildDataset } from "../src/data/dataset";
import {
  changeStats, childLevel, distribution, distributionTexts, filterSamples, geoBounds, insights, makeSelection, mapPoints, topClassItems,
  type FLevel,
} from "../src/lib/aggregate";
import { geoInfo, geoMask, geoPop, isValidGeo, mapMask, placeOptions, resolvePlace } from "../src/lib/geo";
import { periodInfo, type PeriodKey } from "../src/lib/period";
import { bydelLabels, labelFits, placeLabel, polyCentroid, type Placed } from "../src/map/labels";
import { DEFAULT_STATE, queryToState, sanitize, stateToQuery } from "../src/state/appState";
import { makeFixture, RECS } from "./fixture";

const ds = buildDataset(makeFixture());
const sel = (geo: string, cls = "*", period: PeriodKey = "alle", flevel: FLevel = "bydel", d = ds) => {
  const g = geoInfo(d, geo);
  return makeSelection(d, g, geoMask(d, g), cls, periodInfo(period, d.first, d.last), flevel);
};

describe("geo-nøkkel a: (ett sted)", () => {
  it("er gyldig for steder, men ikke for veier eller ukjente indekser", () => {
    expect(isValidGeo(ds, "a:1")).toBe(true);
    expect(isValidGeo(ds, "a:4")).toBe(false); // E6 er en vei
    expect(isValidGeo(ds, "a:99")).toBe(false);
    expect(isValidGeo(ds, "a:x")).toBe(false);
    expect(geoInfo(ds, "a:4").kind).toBe("all");
  });
  it("gir etikett «Sted, Kommune», kommune og maske", () => {
    const g = geoInfo(ds, "a:2");
    expect(g).toMatchObject({ kind: "a", a: 2, k: 1, id: "0301", label: "Storgata, Oslo", hasBydel: false });
    expect(geoInfo(ds, "a:1").label).toBe("Sentrum (sted), Oslo");
    expect([...geoMask(ds, g)]).toEqual([0, 0, 1, 0, 0, 0]);
    expect(geoPop(ds, g)).toBeNull();
  });
  it("kartet viser hele kommunen når ett sted er valgt", () => {
    const g = geoInfo(ds, "a:2");
    expect([...mapMask(ds, g, geoMask(ds, g))]).toEqual([1, 1, 1, 1, 0, 0]);
    const m = mapPoints(sel("a:2"));
    expect(m.pts.map((p) => p.a).sort()).toEqual([1, 2]);
    expect(m.total).toBe(4);
    expect(m.byd.get(1)).toBe(2);
  });
  it("utsnittet legges rundt stedet", () => {
    const [[s, w], [n, e]] = geoBounds(ds, geoInfo(ds, "a:2"), new Uint8Array());
    expect([(s + n) / 2, (w + e) / 2]).toEqual([59.92, 10.75]);
    expect(n - s).toBeCloseTo(0.04, 6);
  });
  it("kan deles i adressen og avvises hvis ugyldig", () => {
    expect(sanitize(ds, queryToState("?geo=a:2")).geo).toBe("a:2");
    expect(sanitize(ds, queryToState("?geo=a:4")).geo).toBe(DEFAULT_STATE.geo);
  });
});

describe("Finn sted", () => {
  it("tar med steder med minst 5 hendelser, ikke veier, mest brukt først", () => {
    expect(placeOptions(ds)).toEqual([{ value: "Sentrum, Oslo", a: 1 }, { value: "Storgata, Oslo", a: 2 }]);
  });
  it("finner eksakt treff eller første som begynner med teksten", () => {
    const o = placeOptions(ds);
    expect(resolvePlace(o, "storgata, oslo")).toEqual({ value: "Storgata, Oslo", a: 2 });
    expect(resolvePlace(o, " Stor")?.a).toBe(2);
    expect(resolvePlace(o, "Fana")).toBeNull();
    expect(resolvePlace(o, "")).toBeNull();
  });
});

describe("Fordeling på nivået under valgt område", () => {
  it("ett sted fordeles på politiets kategori, uten samlebøtte", () => {
    const L = childLevel(ds, geoInfo(ds, "a:1"));
    expect(L).toMatchObject({ title: "Politiets kategorier på stedet", limit: 12 });
    expect(L.none(0)).toBe(false);
    const d = distribution(sel("a:1"), "abs");
    expect(d.items.map((i) => [i.label, i.n])).toEqual([["Voldshendelse", 2]]);
  });
  it("kommune med bydeler kan bytte til steder, og «uten oppgitt sted» legges sist", () => {
    expect(distribution(sel("m:0301"), "abs").level.title).toBe("Bydeler i Oslo");
    const d = distribution(sel("m:0301", "*", "alle", "sted"), "abs");
    expect(d.level).toMatchObject({ title: "Steder i Oslo", places: true });
    expect(d.items.map((i) => [i.label, i.n, i.none])).toEqual([["Sentrum (sted)", 2, false], ["Storgata", 1, false], ["Uten oppgitt sted", 1, true]]);
    expect(d.level.geo(1)).toBe("a:1");
    expect([d.missingN, d.totalN]).toEqual([1, 4]);
  });
  it("bydelsnivået brukes ikke for kommuner uten bydeler", () => {
    expect(childLevel(ds, geoInfo(ds, "m:4601"), "bydel").title).toBe("Steder i Bergen");
  });
});

describe("Hvor endrer det seg?", () => {
  it("skjules for ett sted og uten sammenligningsperiode", () => {
    expect(changeStats(sel("a:1")).applicable).toBe(false);
    expect(changeStats(sel("m:0301")).hasPrev).toBe(false);
  });
  it("tar med bare enheter med minst 10 hendelser og sorterer etter endring", () => {
    // Måned 0 (2024-12) er «året før» for 2025. Frogner: 14 før, 4 nå. Sagene: 0 før, 11 nå.
    // Uten bydel: 30 nå (samlebøtten telles ikke). Grønland-lignende enhet med 3 og 2 faller under grensen.
    const rec = (month: number, bydel: number) => ({ ...RECS[0], month, bydel });
    const recs = [
      ...Array.from({ length: 14 }, () => rec(0, 1)), ...Array.from({ length: 4 }, () => rec(1, 1)),
      ...Array.from({ length: 11 }, () => rec(1, 2)), ...Array.from({ length: 30 }, () => rec(1, 0)),
    ];
    const c = changeStats(sel("m:0301", "*", "2025", "bydel", buildDataset(makeFixture(recs))));
    expect(c).toMatchObject({ applicable: true, hasPrev: true, title: "Hvor endrer det seg? Bydeler i Oslo" });
    expect(c.ups.map((x) => [x.label, x.o, x.c, x.v, x.geo])).toEqual([["Sagene", 0, 11, 11, "b:0301|Sagene"]]);
    expect(c.downs.map((x) => [x.label, x.o, x.c, x.v, x.neg])).toEqual([["Frogner", 14, 4, 10, true]]);
  });
});

describe("nøkkelfunn for steder", () => {
  it("nevner mest omtalte sted (ikke sentrum, vei, kommune) med bydel", () => {
    expect(insights(sel("m:0301")).some((t) => t === "Mest omtalte sted: **Storgata** (1 hendelser, bydel Sagene).")).toBe(true);
  });
  it("ett sted får vanligste kategori hos politiet, og ikke mest omtalte sted", () => {
    const recs = [RECS[0], RECS[1], { ...RECS[0], category: 2 }];
    const d2 = buildDataset(makeFixture(recs));
    const out = insights(sel("a:1", "*", "alle", "bydel", d2));
    expect(out).toContain("Vanligste kategori hos politiet: **Voldshendelse** (2 hendelser).");
    expect(out.some((t) => t.startsWith("Mest omtalte sted"))).toBe(false);
  });
});

describe("hendelser fra ett sted", () => {
  const withSamples = buildDataset({
    ...makeFixture(),
    samples: [
      { id: "a", category: "Trafikk", municipality: "Oslo", area: "Storgata", created: "2025-02-10T12:00:00Z", messages: 1, active: false, text: "x", classes: [], weapon: null, outcome: [], persons: [], d: 0, k: 1, b: 2, a: 2 },
      { id: "b", category: "Trafikk", municipality: "Oslo", area: "Sentrum", created: "2025-02-11T12:00:00Z", messages: 1, active: false, text: "y", classes: [], weapon: null, outcome: [], persons: [], d: 0, k: 1, b: 1, a: 1 },
    ],
  });
  it("filtrerer på stedsindeks", () => {
    const g = geoInfo(withSamples, "a:2");
    expect(filterSamples(withSamples, g, "*", "", periodInfo("alle", withSamples.first, withSamples.last)).map((s) => s.id)).toEqual(["a"]);
  });
});

describe("kartetiketter", () => {
  it("bydelens etikett er polygonets tyngdepunkt, ellers medianen av stedene", () => {
    expect(polyCentroid([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]])).toEqual([1, 1]);
    const out = bydelLabels(ds.app);
    expect(out.find((b) => b.name === "Frogner")).toMatchObject({ mid: "0301", lon: 1, lat: 1 });
    // Sagene har bare ett sted, så for få punkter for en median
    expect(out.find((b) => b.name === "Sagene")).toBeUndefined();
  });
  it("etiketter prøver høyre, venstre, over og under, og hoppes over når alt er tatt", () => {
    const placed: Placed[] = [];
    expect(placeLabel(placed, 100, 100, 60)?.dir).toBe("right");
    expect(placeLabel(placed, 100, 100, 60)?.dir).toBe("left");
    expect(placeLabel(placed, 100, 100, 60)?.dir).toBe("top");
    expect(placeLabel(placed, 100, 100, 60)?.dir).toBe("bottom");
    expect(placeLabel(placed, 100, 100, 60)).toBeNull();
    expect(labelFits(placed, 400, 400, 60)).toBe(true);
  });
});

describe("fl i adressen", () => {
  it("skrives bare når nivået ikke er standard", () => {
    expect(stateToQuery(DEFAULT_STATE)).not.toContain("fl=");
    expect(stateToQuery({ ...DEFAULT_STATE, flevel: "sted" })).toContain("fl=sted");
    expect(sanitize(ds, queryToState("?fl=sted")).flevel).toBe("sted");
    expect(sanitize(ds, queryToState("?fl=x")).flevel).toBe("bydel");
  });
});

describe("Steder-nivået: nøkler 0 og -1", () => {
  // Oslo: 3 hendelser uten sted (areaType mangler), 2 med sted men sjeldent navn (ingen egen rad), 4 på Storgata
  const rec = (area: number, areaType: number) => ({ ...RECS[0], area, areaType, bydel: 0 });
  const recs = [...Array.from({ length: 3 }, () => rec(0, 0)), ...Array.from({ length: 2 }, () => rec(0, 3)), ...Array.from({ length: 4 }, () => rec(2, 3))];
  const d2 = buildDataset(makeFixture(recs));
  const s = sel("m:0301", "*", "alle", "sted", d2);
  it("0 = ikke oppgitt sted, -1 = sjeldent navn; begge er samlebøtter uten valg", () => {
    const L = childLevel(d2, s.geo, "sted");
    expect([L.none(0), L.none(-1), L.none(2)]).toEqual([true, true, false]);
    expect([L.label(0), L.label(-1), L.label(2)]).toEqual(["Uten oppgitt sted", "Øvrige steder (sjeldne navn)", "Storgata"]);
    expect([L.geo(0), L.geo(-1), L.geo(2)]).toEqual([null, null, "a:2"]);
  });
  it("«har ikke oppgitt sted» teller bare nøkkel 0, regnet over alle nøkler", () => {
    const d = distribution(s, "abs");
    expect(d.items.map((i) => [i.k, i.n])).toEqual([[2, 4], [0, 3], [-1, 2]]);
    expect([d.missingN, d.totalN]).toEqual([3, 9]);
    expect(distributionTexts(s, d, 0).note).toContain("3 hendelser (33,3");
    expect(distributionTexts(s, d, 0).note).toContain("har ikke oppgitt sted.");
  });
  it("entall: «1 hendelse»", () => {
    const one = buildDataset(makeFixture([rec(0, 0), rec(2, 3), rec(2, 3)]));
    const so = sel("m:0301", "*", "alle", "sted", one);
    expect(distributionTexts(so, distribution(so, "abs"), 0).note).toContain("1 hendelse (");
  });
  it("de to bøttene vises sist, og «Mest omtalte sted» dupliseres ikke på Steder-nivået", () => {
    const out = insights(s);
    expect(out.some((t) => t.startsWith("Mest omtalte sted"))).toBe(false);
    expect(out[0]).toBe("**9** hendelser i Oslo i perioden.");
  });
});

describe("avvik i dekning (hvor endrer det seg)", () => {
  // Året før (måned 0): alle 20 hendelser har bydel. Nå (måned 1): 20 av 30 har ikke bydel.
  const rec = (month: number, bydel: number) => ({ ...RECS[0], month, bydel });
  const recs = [...Array.from({ length: 20 }, () => rec(0, 1)), ...Array.from({ length: 10 }, () => rec(1, 1)), ...Array.from({ length: 20 }, () => rec(1, 0))];
  const d2 = buildDataset(makeFixture(recs));
  it("advarer når andelen uten bydel avviker mer enn 10 prosentpoeng", () => {
    const c = changeStats(sel("m:0301", "*", "2025", "bydel", d2));
    expect(c.drift?.replace(/\u00a0/g, " ")).toMatch(/^Merk: andelen hendelser uten bydel var 66,7 % nå mot 0 % året før, så endringer per område er usikre\.$/);
  });
  it("ikke for hele landet, og ikke når dekningen er lik", () => {
    expect(changeStats(sel("all", "*", "2025", "bydel", d2)).drift).toBeNull();
    const same = buildDataset(makeFixture([...Array.from({ length: 20 }, () => rec(0, 1)), ...Array.from({ length: 20 }, () => rec(1, 1))]));
    expect(changeStats(sel("m:0301", "*", "2025", "bydel", same)).drift).toBeNull();
  });
});

describe("Finn sted ved flere treff", () => {
  const o = [{ value: "Sentrum, Oslo", a: 1 }, { value: "Sentrum, Bergen", a: 7 }, { value: "Sentrumsgata, Oslo", a: 9 }];
  it("foretrekker stedet i gjeldende kommune, ellers det mest brukte", () => {
    expect(resolvePlace(o, "Sentrum", "Bergen")).toEqual({ value: "Sentrum, Bergen", a: 7 });
    expect(resolvePlace(o, "Sentrum", null)?.a).toBe(1);
    expect(resolvePlace(o, "Sentrum", "Drammen")?.a).toBe(1);
  });
  it("eksakt treff går foran gjeldende kommune", () => {
    expect(resolvePlace(o, "Sentrum, Oslo", "Bergen")?.a).toBe(1);
  });
});

describe("typer uten treff", () => {
  it("skjuler overklasser med 0 hendelser", () => {
    const d2 = buildDataset(makeFixture([RECS[0]]));
    expect(topClassItems(sel("all", "*", "alle", "bydel", d2)).map((i) => i.code)).toEqual(["vold"]);
  });
});
