import type { MouseEvent } from "react";
import type { Dataset } from "../data/dataset";
import { fmtDate } from "../lib/format";
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
            <span className="chip"><span className="dot" aria-hidden="true" />Oppdatert {fmtDate(ds.app.span[1])}</span>
          </div>
        )}
      </div>
      {tab && (
        <nav className="tabs" aria-label="Visninger">
          {TABS.map((t) => (
            <a key={t.id} href={`#${t.id}`} className={t.meta ? "meta" : undefined} aria-current={t.id === tab ? "page" : undefined} onClick={click(t.id)}>{t.label}</a>
          ))}
        </nav>
      )}
    </header>
  );
}
