import { describe, expect, it } from "vitest";
import { buildDataset } from "../src/data/dataset";
import {
  areaStats, crossTab, days, distribution, distributionTexts, eventCount, filterSamples, insights, kpiStats, makeSelection, mapPoints, monthlyTrend,
  nationalRate, outcomeStats, personStats, seasonStats, weekHourGrid,
} from "../src/lib/aggregate";
import { nice } from "../src/lib/format";
import { geoInfo, geoMask, geoPop } from "../src/lib/geo";
import { periodInfo, periodYears, type PeriodKey } from "../src/lib/period";
import { makeFixture, RECS } from "./fixture";

const ds = buildDataset(makeFixture());
const sel2 = (d: typeof ds, geo: string, cls = "*", period: PeriodKey = "alle") => {
  const g = geoInfo(d, geo);
  return makeSelection(d, g, geoMask(d, g), cls, periodInfo(period, d.first, d.last));
};
const sel = (geo: string, cls = "*", period: PeriodKey = "alle") => sel2(ds, geo, cls, period);
const years = (s: ReturnType<typeof sel>) => periodYears(s.period, s.ds.app.span);

describe("geo og periode", () => {
  it("maskerer kommune, distrikt og bydel", () => {
    expect([...geoMask(ds, geoInfo(ds, "m:0301"))]).toEqual([1, 1, 1, 1, 0, 0]);
    expect([...geoMask(ds, geoInfo(ds, "d:207"))]).toEqual([0, 0, 0, 0, 1, 1]);
    expect([...geoMask(ds, geoInfo(ds, "b:0301|Frogner"))]).toEqual([1, 1, 0, 0, 0, 0]);
    expect(geoInfo(ds, "m:9999").kind).toBe("all");
  });
  it("første distrikt (indeks 0) er et gyldig valg", () => {
    expect(geoInfo(ds, "d:201")).toMatchObject({ kind: "d", i: 0, label: "Oslo" });
  });
  it("siste 12 mnd slutter måneden før siste (ufullstendige) måned", () => {
    const p = periodInfo("12m", ds.first, ds.last);
    expect(p).toMatchObject({ from: "2024-02", to: "2025-01", prev: ["2023-02", "2024-01"] });
  });
  it("antall dager klippes mot datasettets start og slutt", () => {
    expect(Math.round(days(sel("all")))).toBe(76);
  });
});

describe("folketall", () => {
  it("slår opp kommune, distrikt og hele landet; bydeler har ikke folketall", () => {
    expect(geoPop(ds, geoInfo(ds, "m:0301"))).toBe(700000);
    expect(geoPop(ds, geoInfo(ds, "d:207"))).toBe(300000);
    expect(geoPop(ds, geoInfo(ds, "all"))).toBe(1000000);
    expect(geoPop(ds, geoInfo(ds, "b:0301|Frogner"))).toBeNull();
  });
  it("landsrate = hendelser per år per 1 000 innbyggere", () => {
    const s = sel("all", "vold");
    expect(nationalRate(s)).toBeCloseTo((4 / (76 / 365.25) / 1_000_000) * 1000, 6);
  });
});

describe("monthlyTrend", () => {
  it("teller treff og totaler per måned", () => {
    const { pts, partialLast } = monthlyTrend(sel("all", "vold"));
    expect(pts.map((p) => [p.m, p.v, p.t])).toEqual([["2024-12", 1, 2], ["2025-01", 1, 2], ["2025-02", 2, 2]]);
    expect(partialLast).toBe(true);
  });
  it("filtrerer på underklasse og område", () => {
    const { pts } = monthlyTrend(sel("m:0301", "vold.ran"));
    expect(pts.map((p) => p.v)).toEqual([0, 1, 1]);
  });
  it("respekterer perioden", () => {
    const { pts } = monthlyTrend(sel("all", "*", "2025"));
    expect(pts.map((p) => p.m)).toEqual(["2025-01", "2025-02"]);
    expect(pts.map((p) => p.v)).toEqual([2, 2]);
  });
  it("har ingen sammenligningslinje når året før mangler i dataene", () => {
    const t = monthlyTrend(sel("all"));
    expect(t.hasCompare).toBe(false);
    expect(t.pts.every((p) => p.pv == null)).toBe(true);
  });
});

describe("kpiStats", () => {
  it("regner andel utenfor politiets kategori blant treffene", () => {
    const k = kpiStats(sel("all", "vold"));
    expect(k.n).toBe(4);
    expect(k.tot).toBe(6);
    // rad 3 er vold, men politiet kalte den Trafikk
    expect(k.outside).toBe(1);
    expect(k.prev).toBeNull();
    expect(k.pop).toBe(1000000);
  });
  it("teller per overklasse uten klassefilter", () => {
    expect(kpiStats(sel("all")).perTop).toEqual([4, 2]);
  });
});

describe("utfall og personer", () => {
  it("teller utfall som bitmaske og dekning", () => {
    const o = outcomeStats(sel("all", "vold"), { "pågrepet": "Pågrepet" });
    expect(o.items.map((i) => [i.label, i.v])).toEqual([["Pågrepet", 2], ["siktet", 2]]);
    expect(o).toMatchObject({ n: 4, any: 3 });
  });
  it("pakker ut opptil tre personer per hendelse", () => {
    const { counts, nInc, withP, total } = personStats(sel("all"));
    // 9 aldersgrupper: barn, 10-årene … 80+
    expect(counts[0]).toEqual([1, 2, 0, 0, 0, 0, 0, 0, 0]);
    expect(counts[1]).toEqual([0, 0, 1, 0, 0, 0, 0, 2, 0]);
    expect([nInc, withP, total]).toEqual([6, 3, 6]);
  });
});

describe("distribution", () => {
  it("gir alle distrikter på landsnivå, også indeks 0 (Oslo)", () => {
    const d = distribution(sel("all"), "abs");
    expect(d.mode).toBe("abs");
    expect(d.items.map((i) => [i.label, i.v, i.none])).toEqual([["Oslo", 4, false], ["Vest", 2, false]]);
  });
  it("per innbygger er standard der folketall finnes, når noen enhet har nok hendelser", () => {
    const many = Array.from({ length: 12 }, () => ({ ...RECS[0], district: 0, muni: 1 }));
    const d2 = buildDataset(makeFixture([...many, RECS[4]]));
    const all = distribution(sel2(d2, "all"), "pop");
    expect(all.modes).toEqual(["pop", "abs"]);
    expect(all.mode).toBe("pop");
    expect(all.autoAbs).toBe(false);
    const oslo = all.items.find((i) => i.label === "Oslo")!;
    expect(oslo.v).toBeCloseTo((12 / years(sel2(d2, "all")) / 700000) * 1000, 6);
    // Vest har bare 1 hendelse: lavt grunnlag, nederst
    expect(all.items.map((i) => [i.label, i.low])).toEqual([["Oslo", false], ["Vest", true]]);
    // ber om andel uten klassefilter: faller tilbake til første tilgjengelige mål
    expect(distribution(sel2(d2, "all"), "share").mode).toBe("pop");
  });
  it("bytter til antall når ingen enhet har 10 hendelser, og forklarer det", () => {
    const s = sel("all");
    const d = distribution(s, "pop");
    expect(d).toMatchObject({ mode: "abs", autoAbs: true });
    expect(d.items.every((i) => !i.low)).toBe(true);
    const t = distributionTexts(s, d, 7.5);
    expect(t.note).toContain("Viser antall, fordi ingen områder har 10 hendelser eller flere av denne typen.");
    expect(t.lede).toBe("Alle hendelser, des 24 – feb 25. Antall hendelser.");
  });
  it("forklarer målet i ledeteksten og nevner manglende per-innbygger-tall", () => {
    const many = Array.from({ length: 12 }, () => ({ ...RECS[0], bydel: 1, muni: 1 }));
    const d2 = buildDataset(makeFixture(many));
    const s = sel2(d2, "m:0301", "vold");
    const d = distribution(s, "share");
    expect(d.mode).toBe("share");
    const t = distributionTexts(s, d, 7.5);
    expect(t.lede).toContain("Hver søyle viser hvor stor andel av områdets hendelser som er vold. Områder med under 10 slike hendelser står nederst.");
    expect(t.note).toContain("Per innbygger er ikke tilgjengelig her, fordi folketall finnes bare for kommuner og distrikter.");
    const pop = distributionTexts(sel2(d2, "d:201", "vold"), distribution(sel2(d2, "d:201", "vold"), "pop"), 7.5);
    expect(pop.note).toContain("Distriktene publiserer ulikt mye, så rater er ikke direkte sammenlignbare.");
  });
  it("viser bydeler med «uten bydel» sist, og teller de manglende fra alle nøkler", () => {
    const d = distribution(sel("m:0301", "vold"), "share");
    expect(d.level.title).toBe("Bydeler i Oslo");
    expect(d.modes).toEqual(["share", "abs"]);
    expect(d.autoAbs).toBe(true);
    expect(d.items.map((i) => [i.k, i.n, i.t])).toEqual([[1, 2, 2], [2, 0, 1], [0, 1, 1]]);
    expect(d.items[2]).toMatchObject({ none: true, dim: true, low: false });
    expect(d.series.get(1)).toEqual([1, 1, 0]);
    expect([d.missingN, d.totalN]).toEqual([1, 3]);
    const note = distributionTexts(sel("m:0301", "vold"), d, 0).note;
    expect(note).toContain("1 hendelse (");
    expect(note).toContain("av 3) er uten bydel.");
  });
});

describe("øvrige aggregeringer", () => {
  it("varmekart per ukedag og time", () => {
    const { grid, tot } = weekHourGrid(sel("all"));
    expect(tot).toBe(6);
    expect(grid[6][2]).toBe(2);
    expect(grid[5][23]).toBe(1);
  });
  it("krysstabell sorterer kategorier etter volum", () => {
    const c = crossTab(sel("all"));
    expect(c.order).toEqual([1, 2, 0]);
    expect(c.cells[2]).toEqual([1, 2]);
  });
  it("steder, bydeler og kartpunkter", () => {
    const a = areaStats(sel("m:0301"));
    expect(a).toMatchObject({ n: 4, missing: 1, mapped: 3, located: 3 });
    expect(a.top.map((t) => [t.row[0], t.v])).toEqual([["Sentrum", 2], ["Storgata", 1]]);
    const m = mapPoints(sel("all"));
    expect(m).toMatchObject({ located: 3, total: 6 });
    expect(m.pts.find((p) => p.a === 1)?.v).toBe(2);
  });
  it("bydelslisten viser hele kommunen også når én bydel er valgt", () => {
    const a = areaStats(sel("b:0301|Frogner"));
    expect(a.bydeler.map((b) => [b.label, b.v, b.all, !!b.sel])).toEqual([["Frogner", 2, 2, true], ["Sagene", 1, 1, false], ["Uten bydel", 1, 1, false]]);
  });
  it("sesong utelater første og siste (delvise) måned", () => {
    const s = seasonStats(sel("all"));
    expect(s.cnt[0]).toBe(1);
    expect(s.avg[0]).toBe(2);
    expect(s.hi).toBe(0);
    expect([s.fromYear, s.toYear]).toEqual(["2025", "2025"]);
  });
  it("nøkkelfunn nevner antall og hvor det er mest aktivt", () => {
    const out = insights(sel("all"));
    expect(out[0]).toBe("**6** hendelser i hele landet i perioden.");
    expect(out.some((t) => t.startsWith("Mest aktivt på"))).toBe(true);
    expect(insights(sel("b:0301|Sagene", "vold"))).toEqual(["Ingen hendelser med vold i Sagene (Oslo) i perioden."]);
  });
});

describe("eventCount", () => {
  it("teller alle hendelser av valgt type i området og perioden", () => {
    expect(eventCount(sel("all"))).toBe(6);
    expect(eventCount(sel("m:0301", "vold"))).toBe(3);
    expect(eventCount(sel("all", "*", "2025"))).toBe(4);
  });
});

describe("filterSamples", () => {
  const withSamples = buildDataset({
    ...makeFixture(),
    samples: [
      { id: "a", category: "Trafikk", municipality: "Oslo", area: "Storgata", created: "2025-02-10T12:00:00Z", messages: 2, active: false, text: "Bil i grøfta", update: "Fjernet", classes: ["trafikk.rus"], weapon: null, outcome: [], persons: [], d: 0, k: 1, b: 2, a: 2 },
      { id: "b", category: "Voldshendelse", municipality: "Bergen", area: null, created: "2024-12-02T12:00:00Z", messages: 1, active: false, text: "Slagsmål", classes: ["vold"], weapon: null, outcome: [], persons: [], d: 1, k: 2, b: 0, a: 0 },
    ],
  });
  const f = (geo: string, cls: string, q: string, period: PeriodKey) => {
    const g = geoInfo(withSamples, geo);
    return filterSamples(withSamples, g, cls, q, periodInfo(period, withSamples.first, withSamples.last)).map((s) => s.id);
  };
  it("filtrerer på område, type, tekst (inkl. oppdatering) og periode", () => {
    expect(f("all", "*", "", "alle")).toEqual(["a", "b"]);
    expect(f("d:201", "*", "", "alle")).toEqual(["a"]);
    expect(f("all", "trafikk", "", "alle")).toEqual(["a"]);
    expect(f("all", "*", "fjernet", "alle")).toEqual(["a"]);
    expect(f("all", "*", "", "2025")).toEqual(["a"]);
  });
  it("siste 12 mnd tar med inneværende måned", () => {
    expect(f("all", "*", "", "12m")).toEqual(["a", "b"]);
  });
});

describe("nice", () => {
  it("gir fire like trinn med hele tall", () => {
    expect(nice(0)).toBe(4);
    expect(nice(5)).toBe(8);
    expect(nice(203)).toBe(400);
    for (const m of [1, 7, 29, 93, 250, 1234, 98765]) {
      const top = nice(m);
      expect(top).toBeGreaterThanOrEqual(m);
      expect(Number.isInteger(top / 4)).toBe(true);
    }
  });
});
