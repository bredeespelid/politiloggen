import {
  createContext, useContext, useLayoutEffect, useMemo, useRef, useState,
  type FocusEvent, type PointerEvent, type ReactNode,
} from "react";

interface TipState {
  content: ReactNode;
  x: number;
  y: number;
}

export interface TipApi {
  show: (content: ReactNode, x: number, y: number) => void;
  hide: () => void;
}

const noop: TipApi = { show: () => {}, hide: () => {} };
const TipContext = createContext<TipApi>(noop);

export const useTip = (): TipApi => useContext(TipContext);

/**
 * Én felles tooltip for hele appen. API-et er stabilt, så komponenter som viser tips
 * rendres ikke på nytt når tipset flytter seg.
 */
export function TipProvider({ children }: { children: ReactNode }) {
  const setRef = useRef<(s: TipState | null) => void>(() => {});
  const api = useMemo<TipApi>(() => ({
    show: (content, x, y) => setRef.current({ content, x, y }),
    hide: () => setRef.current(null),
  }), []);
  return (
    <TipContext.Provider value={api}>
      {children}
      <TipBox register={(fn) => { setRef.current = fn; }} />
    </TipContext.Provider>
  );
}

function TipBox({ register }: { register: (fn: (s: TipState | null) => void) => void }) {
  const [tip, setTip] = useState<TipState | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  register(setTip);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    const r = el.getBoundingClientRect(), pad = 12;
    let left = tip.x + 14, top = tip.y + 14;
    if (left + r.width > innerWidth - pad) left = tip.x - r.width - 14;
    if (top + r.height > innerHeight - pad) top = tip.y - r.height - 14;
    el.style.left = `${Math.max(pad, left)}px`;
    el.style.top = `${Math.max(pad, top)}px`;
  }, [tip]);

  useLayoutEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };
    addEventListener("scroll", hide, { passive: true, capture: true });
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("scroll", hide, { capture: true });
      removeEventListener("keydown", onKey);
    };
  }, [tip]);

  return (
    <div ref={ref} className="tip" role="tooltip" aria-live="polite" hidden={!tip}>
      {tip?.content}
    </div>
  );
}

/** Tips ved peker og ved tastaturfokus (plassert under elementet). */
export function tipHandlers(tip: TipApi, content: () => ReactNode) {
  return {
    onPointerMove: (e: PointerEvent) => tip.show(content(), e.clientX, e.clientY),
    onPointerLeave: () => tip.hide(),
    onFocus: (e: FocusEvent<Element>) => {
      if (!e.currentTarget.matches(":focus-visible")) return;
      const r = e.currentTarget.getBoundingClientRect();
      tip.show(content(), r.left + Math.min(r.width / 2, 120), r.bottom - 6);
    },
    onBlur: () => tip.hide(),
  };
}
