import { describe, expect, it } from "vitest";
import { decodeRecords, encodeValue } from "../src/data/decode";
import { encodeRecs, REC_FIELDS, RECS } from "./fixture";

describe("encodeValue", () => {
  it("matcher enc() i build_app_data.py", () => {
    expect(encodeValue(0, 1)).toBe("A");
    expect(encodeValue(63, 1)).toBe("/");
    expect(encodeValue(64, 2)).toBe("BA");
    expect(encodeValue(64 ** 3 - 1, 3)).toBe("///");
  });
  it("avviser verdier som ikke får plass", () => {
    expect(() => encodeValue(64, 1)).toThrow();
    expect(() => encodeValue(-1, 2)).toThrow();
  });
});

describe("decodeRecords", () => {
  it("pakker ut alle felt for alle rader", () => {
    const { n, col } = decodeRecords(encodeRecs(RECS), REC_FIELDS);
    expect(n).toBe(RECS.length);
    RECS.forEach((rec, i) => {
      for (const [f] of REC_FIELDS) expect(col[f][i], `${f} i rad ${i}`).toBe(rec[f] ?? 0);
    });
  });

  it("velger kolonnetype etter bredde", () => {
    const { col } = decodeRecords(encodeRecs(RECS), REC_FIELDS);
    expect(col.month).toBeInstanceOf(Uint8Array);
    expect(col.hourOfWeek).toBeInstanceOf(Uint16Array);
    expect(col.subs).toBeInstanceOf(Uint32Array);
  });

  it("håndterer store verdier i brede felt (30 bit)", () => {
    const big = 2 ** 30 - 1;
    const { col } = decodeRecords(encodeRecs([{ subs: big, persons: 64 ** 3 - 1 }]), REC_FIELDS);
    expect(col.subs[0]).toBe(big);
    expect(col.persons[0]).toBe(64 ** 3 - 1);
  });

  it("feiler på lengde som ikke går opp i radbredden", () => {
    expect(() => decodeRecords("ABC", REC_FIELDS)).toThrow(/radbredden/);
  });

  it("decoder ekte fixture-streng fra Python-formatet", () => {
    // month=3, hourOfWeek=130, district=0, muni=4 ... alt annet 0
    const s = "D" + "CC" + "A" + "AE" + "A" + "AA" + "AAAAA" + "A" + "AAA" + "AAA" + "A" + "A" + "A";
    const { n, col } = decodeRecords(s, REC_FIELDS);
    expect(n).toBe(1);
    expect(col.month[0]).toBe(3);
    expect(col.hourOfWeek[0]).toBe(2 * 64 + 2);
    expect(col.muni[0]).toBe(4);
  });
});
