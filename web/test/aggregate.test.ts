import { describe, expect, it } from "vitest";
import { buildDataset } from "../src/data/dataset";
import {
  areaStats, crossTab, distribution, kpiStats, makeSelection, mapPoints, monthlyTrend, outcomeItems, personCounts, weekHourGrid,
} from "../src/lib/aggregate";
import { geoInfo, geoMask } from "../src/lib/geo";
import { periodInfo, type PeriodKey } from "../src/lib/period";
import { makeFixture } from "./fixture";

const ds = buildDataset(makeFixture());
const sel = (geo: string, cls = "*", period: PeriodKey = "alle") => {
  const g = geoInfo(ds, geo);
  return makeSelection(ds, g, geoMask(ds, g), cls, periodInfo(period, ds.first, ds.last));
};

describe("geo og periode", () => {
  it("maskerer kommune, distrikt og bydel", () => {
    expect([...geoMask(ds, geoInfo(ds, "m:0301"))]).toEqual([1, 1, 1, 1, 0, 0]);
    expect([...geoMask(ds, geoInfo(ds, "d:207"))]).toEqual([0, 0, 0, 0, 1, 1]);
    expect([...geoMask(ds, geoInfo(ds, "b:0301|Frogner"))]).toEqual([1, 1, 0, 0, 0, 0]);
    expect(geoInfo(ds, "m:9999").kind).toBe("all");
  });
  it("siste 12 mnd slutter måneden før siste (ufullstendige) måned", () => {
    const p = periodInfo("12m", ds.first, ds.last);
    expect(p).toMatchObject({ from: "2024-02", to: "2025-01", prev: ["2023-02", "2024-01"] });
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
});

describe("kpiStats", () => {
  it("regner andel utenfor politiets kategori", () => {
    const k = kpiStats(sel("all", "vold"));
    expect(k.n).toBe(4);
    expect(k.tot).toBe(6);
    // rad 3 er vold, men politiet kalte den Trafikk
    expect(k.inTop).toBe(4);
    expect(k.outside).toBe(1);
    expect(k.prev).toBeNull();
  });
  it("teller per overklasse uten klassefilter", () => {
    expect(kpiStats(sel("all")).perTop).toEqual([4, 2]);
  });
});

describe("utfall og personer", () => {
  it("teller utfall som bitmaske", () => {
    expect(outcomeItems(sel("all", "vold")).map((i) => [i.label, i.v])).toEqual([["pågrepet", 2], ["anmeldt", 2]]);
  });
  it("pakker ut opptil tre personer per hendelse", () => {
    const [men, women] = personCounts(sel("all"));
    expect(men).toEqual([1, 2, 0, 0, 0, 0, 0, 0]);
    expect(women).toEqual([0, 0, 1, 0, 0, 0, 0, 2]);
  });
});

describe("distribution", () => {
  it("gir alle distrikter på landsnivå, også indeks 0", () => {
    const d = distribution(sel("all"), "share");
    expect(d.mode).toBe("abs");
    expect(d.items.map((i) => [i.label, i.v])).toEqual([["Oslo", 4], ["Vest", 2]]);
  });
  it("viser bydeler med «ikke koblet» sist i andelsmodus", () => {
    const d = distribution(sel("m:0301", "vold"), "share");
    expect(d.level.title).toBe("Bydeler i Oslo");
    expect(d.items.map((i) => [i.k, i.n, i.t])).toEqual([[1, 2, 2], [2, 0, 1], [0, 1, 1]]);
    expect(d.items[2].dim).toBe(true);
    expect(d.series.get(1)).toEqual([1, 1, 0]);
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
  it("områder og kartpunkter", () => {
    const a = areaStats(sel("m:0301"));
    expect(a).toMatchObject({ n: 4, missing: 1, mapped: 3 });
    expect(a.top.map((t) => [t.row[0], t.v])).toEqual([["Sentrum", 2], ["Storgata", 1]]);
    const m = mapPoints(sel("all"));
    expect(m).toMatchObject({ located: 3, total: 6 });
    expect(m.pts.find((p) => p.a === 1)?.v).toBe(2);
  });
});
