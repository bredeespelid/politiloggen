import type { MouseEvent } from "react";
import type { Dataset } from "../data/dataset";
import { fmtDate, fmtNum } from "../lib/format";
import { TABS, type Tab } from "../state/appState";

interface Props {
  ds: Dataset | null;
  tab: Tab | null;
  onTab?: (t: Tab) => void;
}

export function Header({ ds, tab, onTab }: Props) {
  const click = (t: Tab) => (e: MouseEvent) => {
    if (!onTab) return;
    e.preventDefault();
    onTab(t);
  };
  return (
    <header className="bar">
      <div className="bar-top">
        <div className="brand"><h1>Politiloggen Analyse</h1><span className="sub">prototype</span></div>
        {ds && (
          <div className="status">
            <span className="chip"><span className="dot" aria-hidden="true" />Sist lastet {fmtDate(ds.app.generated)}</span>
            <span className="chip">{fmtNum(ds.n)} hendelser</span>
            <span className="chip mono">{ds.app.classifier} · {ds.app.areaClassifier}</span>
          </div>
        )}
      </div>
      {tab && (
        <nav className="tabs" aria-label="Visninger">
          {TABS.map(([t, label]) => (
            <a key={t} href={`#${t}`} aria-current={t === tab ? "page" : undefined} onClick={click(t)}>{label}</a>
          ))}
        </nav>
      )}
    </header>
  );
}
