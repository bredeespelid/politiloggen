import type { RecField, RecFieldName } from "./types";

export const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export type Column = Uint8Array | Uint16Array | Uint32Array;
export type Columns = Record<RecFieldName, Column>;

export interface DecodedRecords {
  n: number;
  col: Columns;
}

const DEC = (() => {
  const d = new Uint8Array(128);
  for (let i = 0; i < 64; i++) d[B64.charCodeAt(i)] = i;
  return d;
})();

/** Bytes per rad: 1 tegn = 6 bit, så 2 tegn får plass i 16 bit og opptil 5 tegn i 32 bit. */
function columnFor(width: number, n: number): Column {
  if (width > 5) throw new Error(`Feltbredde ${width} er for stor for 32 bit`);
  return width >= 3 ? new Uint32Array(n) : width === 2 ? new Uint16Array(n) : new Uint8Array(n);
}

/**
 * Pakker ut "rec" (faste base64-felt etter hverandre) til én typet kolonne per felt.
 * Verdiene er usignerte heltall, mest signifikante tegn først.
 */
export function decodeRecords(rec: string, fields: RecField[]): DecodedRecords {
  const stride = fields.reduce((s, [, w]) => s + w, 0);
  if (stride === 0) throw new Error("recFields er tom");
  if (rec.length % stride !== 0) throw new Error(`rec har lengde ${rec.length}, som ikke går opp i radbredden ${stride}`);
  const n = rec.length / stride;
  const col = {} as Columns;
  const targets: Column[] = [];
  const widths: number[] = [];
  for (const [name, w] of fields) {
    const c = columnFor(w, n);
    col[name] = c;
    targets.push(c);
    widths.push(w);
  }
  let o = 0;
  for (let i = 0; i < n; i++) {
    for (let f = 0; f < targets.length; f++) {
      let v = 0;
      for (let k = widths[f]; k > 0; k--) v = v * 64 + DEC[rec.charCodeAt(o++) & 127];
      targets[f][i] = v;
    }
  }
  return { n, col };
}

/** Motsatt vei (som enc() i build_app_data.py). Brukes i tester og fixtures. */
export function encodeValue(value: number, width: number): string {
  if (value < 0 || value >= 64 ** width) throw new Error(`${value} får ikke plass i ${width} tegn`);
  let s = "";
  for (let i = width - 1; i >= 0; i--) s += B64[Math.floor(value / 64 ** i) % 64];
  return s;
}

/** Språkmodellens vurderinger, pakket i feltet «meta» (se REC_FIELDS i build_app_data.py). */
export interface Meta {
  /** 0 lav, 1 middels, 2 høy */
  severity: number;
  /** 0 negativ, 1 nøytral, 2 positiv */
  sentiment: number;
  /** indeks i injuries */
  injury: number;
  exercise: boolean;
  /** 0 høy, 1 middels, 2 lav */
  confidence: number;
}

export const metaSeverity = (m: number): number => m & 3;

export function decodeMeta(m: number): Meta {
  return { severity: m & 3, sentiment: (m >> 2) & 3, injury: (m >> 4) & 7, exercise: ((m >> 7) & 1) === 1, confidence: (m >> 8) & 3 };
}

/** Motsatt vei, for tester. */
export function encodeMeta(x: Partial<Meta>): number {
  return (x.severity ?? 0) + 4 * (x.sentiment ?? 0) + 16 * (x.injury ?? 0) + 128 * (x.exercise ? 1 : 0) + 256 * (x.confidence ?? 0);
}
