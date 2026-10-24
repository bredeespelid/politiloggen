import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Bredden til et element, oppdatert med ResizeObserver. */
export function useWidth<T extends HTMLElement>(fallback = 600) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || fallback);
    if (typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const ro = new ResizeObserver(([entry]) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setWidth(Math.round(entry.contentRect.width) || fallback));
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [fallback]);
  return [ref, width] as const;
}

export type Scheme = "light" | "dark";

function currentScheme(): Scheme {
  const forced = document.documentElement.getAttribute("data-theme");
  if (forced === "light" || forced === "dark") return forced;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Lys/mørk modus fra prefers-color-scheme eller [data-theme] på <html>. */
export function useColorScheme(): Scheme {
  const [scheme, setScheme] = useState<Scheme>(currentScheme);
  useEffect(() => {
    const update = () => setScheme(currentScheme());
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", update);
      mo.disconnect();
    };
  }, []);
  return scheme;
}

/** Leser en CSS-variabel fra :root (for Leaflet/canvas, som ikke forstår var()). */
export const cssVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const RAMP_VARS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `var(--h${i})`);
