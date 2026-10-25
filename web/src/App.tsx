import { lazy, Suspense, useEffect, useMemo, type ComponentType } from "react";
import { Filters } from "./components/Filters";
import { Header } from "./components/Header";
import { Intro } from "./components/Intro";
import { TipProvider, useTip } from "./components/Tooltip";
import type { Dataset } from "./data/dataset";
import { DATA_URL, useAppData } from "./data/load";
import { makeSelection } from "./lib/aggregate";
import { fmtDate, fmtNum } from "./lib/format";
import { geoInfo, geoMask } from "./lib/geo";
import { useColorScheme } from "./lib/hooks";
import { periodInfo } from "./lib/period";
import { TABS, useAppState, type Tab } from "./state/appState";
import Datamodell from "./views/Datamodell";
import Fordeling from "./views/Fordeling";
import Hendelser from "./views/Hendelser";
import Klassifisering from "./views/Klassifisering";
import Omrader from "./views/Omrader";
import Oversikt from "./views/Oversikt";
import Tidsmonster from "./views/Tidsmonster";
import type { ViewProps } from "./views/types";

// Kartet (Leaflet) lastes først når fanen åpnes.
const Kart = lazy(() => import("./views/Kart"));

const VIEWS: Record<Tab, ComponentType<ViewProps>> = {
  oversikt: Oversikt, kart: Kart, fordeling: Fordeling, omrader: Omrader,
  tidsmonster: Tidsmonster, klassifisering: Klassifisering, hendelser: Hendelser, datamodell: Datamodell,
};

const GENERATE_CMD = "python3 scripts/build_db.py && python3 scripts/geocode.py && python3 scripts/build_app_data.py --out web/public/app.json";

export default function App() {
  const load = useAppData();
  return (
    <TipProvider>
      {load.status === "ready" ? <Dashboard ds={load.ds} /> : (
        <>
          <Header ds={null} tab={null} />
          <main id="main">
            {load.status === "loading" ? (
              <div className="state-box" role="status" aria-live="polite">
                <span className="spinner" aria-hidden="true" />
                <div>
                  <h2>Laster data …</h2>
                  <p className="note">
                    Henter <span className="mono">{DATA_URL}</span>
                    {load.received > 0 && ` (${(load.received / 1e6).toFixed(1)} MB${load.total ? ` av ${(load.total / 1e6).toFixed(1)} MB` : ""})`}.
                    Rundt 140 000 hendelser pakkes ut i nettleseren.
                  </p>
                </div>
              </div>
            ) : (
              <div className="state-box error" role="alert">
                <div>
                  <h2>{load.missing ? "Fant ikke datafilen" : "Kunne ikke laste data"}</h2>
                  <p>{load.message}</p>
                  <p>Appen leser <span className="mono">web/public/app.json</span>, som ikke sjekkes inn i git. Lag den fra rotmappen i repoet:</p>
                  <pre className="code">{GENERATE_CMD}</pre>
                  <p className="note"><span className="mono">build_db.py</span> trenger CSV-eksporten fra Politiloggen. <span className="mono">geocode.py</span> og <span className="mono">build_app_data.py</span> henter stedsnavn og grenser fra Kartverket. Last siden på nytt når filen finnes.</p>
                </div>
              </div>
            )}
          </main>
        </>
      )}
    </TipProvider>
  );
}

function Dashboard({ ds }: { ds: Dataset }) {
  const [state, update] = useAppState(ds);
  const scheme = useColorScheme();
  const tip = useTip();

  // Masken avhenger bare av området; resten av utvalget av klasse og periode.
  const geo = useMemo(() => geoInfo(ds, state.geo), [ds, state.geo]);
  const mask = useMemo(() => geoMask(ds, geo), [ds, geo]);
  const period = useMemo(() => periodInfo(state.period, ds.first, ds.last), [ds, state.period]);
  const sel = useMemo(() => makeSelection(ds, geo, mask, state.cls, period, state.flevel), [ds, geo, mask, state.cls, period, state.flevel]);

  useEffect(() => tip.hide(), [tip, sel, state.tab, state.dmode]);
  useEffect(() => {
    const label = TABS.find((t) => t.id === state.tab)?.label;
    document.title = `${label} · Politiloggen Analyse`;
  }, [state.tab]);

  const View = VIEWS[state.tab];
  return (
    <>
      <a className="skip" href="#main">Hopp til innhold</a>
      <Header ds={ds} tab={state.tab} onTab={(tab) => update({ tab })} />
      <main id="main" tabIndex={-1}>
        {state.tab !== "datamodell" && (
          <>
            <Intro />
            <Filters ds={ds} state={state} geo={geo} update={update} />
          </>
        )}
        <Suspense fallback={<div className="state-box" role="status"><span className="spinner" aria-hidden="true" /><p>Laster kart …</p></div>}>
          <View ds={ds} state={state} update={update} sel={sel} scheme={scheme} />
        </Suspense>
      </main>
      <footer>
        <span>Kilde: Politiet – <a href="https://www.politiet.no/politiloggen" target="_blank" rel="noopener">www.politiet.no/politiloggen</a> (NLOD 2.0) · Kart og stedsnavn: Kartverket</span>
        <span>Databasen: {fmtNum(ds.n)} hendelser fra {fmtDate(ds.app.span[0])} til {fmtDate(ds.app.span[1])}. Klassifisering {ds.app.classifier}, steder {ds.app.areaClassifier}.</span>
        <span>Politiloggen viser det operasjonssentralene publiserer. Det er ikke kriminalstatistikk.</span>
      </footer>
    </>
  );
}
