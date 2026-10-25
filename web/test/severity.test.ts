import { describe, expect, it } from "vitest";
import { buildDataset } from "../src/data/dataset";
import {
  decodePersons, filterSamples, insights, kpiStats, makeSelection, mapPoints, monthlyTrend, outcomeStats, personStats, severityStats,
  topClassItems, weekHourGrid,
} from "../src/lib/aggregate";
import { ageLabel, OUT_LABEL } from "../src/lib/format";
import { geoInfo, geoMask } from "../src/lib/geo";
import { periodInfo } from "../src/lib/period";
import { DEFAULT_STATE, isDefaultFilter, queryToState, sanitize, stateToQuery } from "../src/state/appState";
import { makeFixture, person, persons } from "./fixture";

// Alvorlighet per rad i fixturen: 0 lav, 1 høy (alvorlig skade), 2 middels, 3 høy (dødsfall), 4 lav (øvelse), 5 lav
const ds = buildDataset(makeFixture());
const sel = (sev = "*", geo = "all", cls = "*") => {
  const g = geoInfo(ds, geo);
  return makeSelection(ds, g, geoMask(ds, g), cls, periodInfo("alle", ds.first, ds.last), "bydel", sev);
};
const nbsp = (t: string) => t.replace(/ /g, " ");

describe("alvorlighetsfilter gjelder alle tall", () => {
  it("scan og alle aggregeringer teller bare valgt alvorlighet", () => {
    expect(kpiStats(sel()).tot).toBe(6);
    expect(kpiStats(sel("høy"))).toMatchObject({ n: 2, tot: 2 });
    expect(kpiStats(sel("middels"))).toMatchObject({ n: 1, tot: 1 });
    expect(monthlyTrend(sel("høy")).pts.map((p) => [p.v, p.t])).toEqual([[0, 0], [1, 1], [1, 1]]);
    expect(weekHourGrid(sel("lav")).tot).toBe(3);
    expect(topClassItems(sel("høy")).map((i) => [i.code, i.v])).toEqual([["vold", 2], ["trafikk", 1]]);
  });
  it("gjelder også kartpunktene og utfall/personer", () => {
    expect(mapPoints(sel("høy")).total).toBe(2);
    expect(outcomeStats(sel("høy")).n).toBe(2);
    expect(personStats(sel("høy")).nInc).toBe(2);
  });
  it("ukjent alvorlighet ignoreres", () => {
    expect(sel("kritisk").sev).toBe("*");
    expect(kpiStats(sel("kritisk")).tot).toBe(6);
  });
});

describe("alvorlighet, skade og tone", () => {
  it("fordelingen på alvorlighet ignorerer filteret, de to andre følger utvalget uten filter", () => {
    const s = severityStats(sel("høy"));
    expect(s.severity.map((i) => [i.value, i.v, i.sel])).toEqual([["høy", 2, true], ["middels", 1, false], ["lav", 3, false]]);
    expect(s.tot).toBe(6);
    expect(s.exercises).toBe(1);
    expect(s.sentiment.map((i) => [i.label, i.v])).toEqual([["Negativ", 1], ["Nøytral", 5], ["Positiv", 0]]);
    expect(s.injury.map((i) => [i.label, i.v])).toEqual([["Ingen", 4], ["Lettere", 0], ["Alvorlig", 1], ["Dødsfall", 1], ["Ukjent", 0]]);
  });
  it("respekterer område og type, men ikke alvorlighet", () => {
    expect(severityStats(sel("*", "d:207")).tot).toBe(2);
    expect(severityStats(sel("høy", "all", "trafikk")).tot).toBe(2);
  });
});

describe("nøkkelfunn med alvorlighet", () => {
  it("nevner andel alvorlige og alvorlig skade eller dødsfall, men ikke når filteret er på", () => {
    const line = insights(sel()).map(nbsp).find((t) => t.includes("vurdert som alvorlige"));
    expect(line).toBe("**33,3 %** av hendelsene er vurdert som alvorlige, og 2 har alvorlig skade eller dødsfall.");
    expect(insights(sel("høy")).some((t) => t.includes("vurdert som alvorlige"))).toBe(false);
  });
  it("legger «med høy alvorlighet» inn i andelslinjen", () => {
    const out = insights(sel("høy", "all", "vold")).map(nbsp);
    expect(out).toContain("Vold er **100 %** av alle hendelser med høy alvorlighet.");
    expect(out[0]).toBe("**2** hendelser med vold i hele landet i perioden.");
  });
});

describe("hendelseslisten filtreres på alvorlighet", () => {
  const withSamples = buildDataset({
    ...makeFixture(),
    samples: ["høy", "lav", null].map((severity, i) => ({
      id: `s${i}`, category: "Trafikk", municipality: "Oslo", area: null, created: "2025-02-10T12:00:00Z", messages: 1, active: false, text: "x",
      classes: [], weapon: null, outcome: [], persons: [], d: 0, k: 1, b: 0, a: 0, severity, sentiment: "nøytral", exercise: i === 1,
    })),
  });
  const ids = (sev: string) =>
    filterSamples(withSamples, geoInfo(withSamples, "all"), "*", "", periodInfo("alle", withSamples.first, withSamples.last), sev).map((s) => s.id);
  it("viser alle uten filter og bare treff med filter", () => {
    expect(ids("*")).toEqual(["s0", "s1", "s2"]);
    expect(ids("høy")).toEqual(["s0"]);
    expect(ids("middels")).toEqual([]);
  });
});

describe("personer: base 64 og ni aldersgrupper", () => {
  it("pakker ut kjønn (bit 4) og aldersgruppe (bit 0-3)", () => {
    const into: [number[], number[]] = [new Array<number>(9).fill(0), new Array<number>(9).fill(0)];
    decodePersons(persons(person(0, 0), person(1, 8), person(1, 8)), into);
    expect(into[0][0]).toBe(1);
    expect(into[1][8]).toBe(2);
    expect(into[0].concat(into[1]).reduce((a, b) => a + b, 0)).toBe(3);
  });
  it("aksetekster: barn, tiår og 80+", () => {
    expect(["barn", "10-årene", "20-årene", "70-årene", "80+"].map(ageLabel)).toEqual(["<10", "10–19", "20–29", "70–79", "80+"]);
  });
});

describe("utfall: nye verdier", () => {
  it("har navn for siktet og funnet", () => {
    expect(OUT_LABEL.siktet).toBe("Siktet");
    expect(OUT_LABEL.funnet).toBe("Funnet (savnet/gjenstand)");
  });
});

describe("sev i adressen og nullstilling", () => {
  it("skrives bare når filteret er på, og leses tilbake", () => {
    expect(stateToQuery(DEFAULT_STATE)).not.toContain("sev=");
    const q = stateToQuery({ ...DEFAULT_STATE, sev: "høy" });
    expect(q).toContain("sev=h%C3%B8y");
    expect(sanitize(ds, queryToState(`?${q}`)).sev).toBe("høy");
  });
  it("ugyldig alvorlighet blir «*», og et aktivt filter teller som endret filter", () => {
    expect(sanitize(ds, queryToState("?sev=kritisk")).sev).toBe("*");
    expect(isDefaultFilter(DEFAULT_STATE)).toBe(true);
    expect(isDefaultFilter({ ...DEFAULT_STATE, sev: "lav" })).toBe(false);
  });
});
