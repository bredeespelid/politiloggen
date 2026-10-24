import { useEffect, useState } from "react";
import { buildDataset, type Dataset } from "./dataset";
import type { AppData } from "./types";

export type LoadState =
  | { status: "loading"; received: number; total: number | null }
  | { status: "error"; message: string; missing: boolean }
  | { status: "ready"; ds: Dataset };

export const DATA_URL = `${import.meta.env.BASE_URL}app.json`;

/** Henter app.json med fremdrift, og pakker ut hendelsene. */
export function useAppData(url = DATA_URL): LoadState {
  const [state, setState] = useState<LoadState>({ status: "loading", received: 0, total: null });

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      const res = await fetch(url, { signal: ctrl.signal });
      const type = res.headers.get("content-type") ?? "";
      // Vite svarer med index.html (200) for filer som mangler, så sjekk innholdstypen også.
      if (res.status === 404 || type.includes("text/html")) {
        setState({ status: "error", missing: true, message: `Fant ikke ${url}.` });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const total = Number(res.headers.get("content-length")) || null;
      let text: string;
      if (res.body && "TextDecoderStream" in window) {
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        const parts: string[] = [];
        let received = 0, last = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
          received += value.length;
          if (received - last > 250_000) {
            last = received;
            setState({ status: "loading", received, total });
          }
        }
        text = parts.join("");
      } else {
        text = await res.text();
      }
      const app = JSON.parse(text) as AppData;
      if (!app.rec || !app.recFields) throw new Error("app.json mangler feltene rec/recFields – er filen laget med en eldre versjon av build_app_data.py?");
      setState({ status: "ready", ds: buildDataset(app) });
    })().catch((e: unknown) => {
      if (ctrl.signal.aborted) return;
      setState({ status: "error", missing: false, message: e instanceof Error ? e.message : String(e) });
    });
    return () => ctrl.abort();
  }, [url]);

  return state;
}
