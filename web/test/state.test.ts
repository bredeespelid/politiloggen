import { describe, expect, it } from "vitest";
import { buildDataset } from "../src/data/dataset";
import { DEFAULT_STATE, queryToState, sanitize, stateToQuery } from "../src/state/appState";
import { makeFixture } from "./fixture";

const ds = buildDataset(makeFixture());

describe("filtre i adressen", () => {
  it("skriver geo, cls og p, og bare de andre feltene når de avviker fra standard", () => {
    expect(stateToQuery(DEFAULT_STATE)).toBe("geo=m%3A0301&cls=*&p=12m");
    expect(stateToQuery({ ...DEFAULT_STATE, dmode: "abs", mkind: "dots", q: "kniv" })).toContain("dm=abs&mk=dots&q=kniv");
  });

  it("leser samme verdier tilbake", () => {
    const s = { ...DEFAULT_STATE, geo: "b:0301|Frogner", cls: "vold.kniv", period: "2025" as const, dmode: "share" as const };
    expect(sanitize(ds, queryToState(stateToQuery(s)))).toMatchObject({ geo: "b:0301|Frogner", cls: "vold.kniv", period: "2025", dmode: "share" });
  });

  it("retter ugyldige verdier til standardvalg", () => {
    const s = sanitize(ds, queryToState("?geo=m:9999&cls=finnesikke&p=1996&dm=x&mk=y&mv=z"));
    expect(s).toEqual(DEFAULT_STATE);
  });
});
