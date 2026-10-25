import { Fragment, useMemo } from "react";
import { BarList } from "../components/BarList";
import { LineChart } from "../components/LineChart";
import { PERSON_SERIES, PersonsChart } from "../components/PersonsChart";
import { KpiRow, Panel, type KpiItem } from "../components/ui";
import { childrenOf, tname, topOf } from "../data/dataset";
import {
  MIN_CHANGE, MIN_PERSONS, changeStats, days, insights, kpiStats, monthlyTrend, nationalRate, outcomeStats, personStats, severityStats, subClassItems, topClassItems, years,
} from "../lib/aggregate";
import { OUT_LABEL, fmt1, fmtNum, fmtPct, mlabel } from "../lib/format";
import { ctx, type ViewProps } from "./types";

/** **fet** i en tekststreng fra insights() blir <b>. */
const Rich = ({ text }: { text: string }) => (
  <>{text.split("**").map((part, i) => (i % 2 ? <b key={i}>{part}</b> : <Fragment key={i}>{part}</Fragment>))}</>
);

export default function Oversikt({ ds, sel, state, update }: ViewProps) {
  const cls = state.cls, top = topOf(ds, cls);
  const k = useMemo(() => kpiStats(sel), [sel]);
  const natRate = useMemo(() => (k.pop && sel.geo.kind !== "all" ? nationalRate(sel) : 0), [sel, k.pop]);
  const facts = useMemo(() => insights(sel), [sel]);
  const trend = useMemo(() => monthlyTrend(sel), [sel]);
  const changes = useMemo(() => changeStats(sel), [sel]);
  const classes = useMemo(() => (top === "*" ? topClassItems(sel) : subClassItems(sel, top)), [sel, top]);
  const outcomes = useMemo(() => outcomeStats(sel, OUT_LABEL), [sel]);
  const persons = useMemo(() => personStats(sel), [sel]);
  const severity = useMemo(() => severityStats(sel), [sel]);

  const p = sel.period, yrs = years(sel);
  const bigI = k.perTop.indexOf(Math.max(...k.perTop));
  const popYear = ds.app.populationYear;
  const kpis: KpiItem[] = [
    { k: `${tname(ds, cls)} · ${p.label}`, v: fmtNum(k.n), d: sel.geo.label },
    {
      k: "Endring mot året før",
      v: k.change == null ? "–" : `${k.change > 0 ? "+" : ""}${fmtPct(k.change)}`,
      d: p.prev ? `${fmtNum(k.prev ?? 0)} i perioden før` : p.noPrev ?? "Ingen hel sammenligningsperiode",
    },
    cls === "*"
      ? { k: "Største type", v: k.tot ? tname(ds, ds.app.tops[bigI]) : "–", d: k.tot ? `${fmtPct(k.perTop[bigI] / k.tot)} av hendelsene` : "" }
      : top === "vold"
        ? { k: "Registrert av politiet under annen kategori", v: k.n ? fmtPct(k.outside / k.n) : "–", d: `${fmtNum(k.outside)} av ${fmtNum(k.n)}, f.eks. kniv meldt som «Ro og orden»` }
        : { k: "Andel av alle hendelser", v: k.tot ? fmtPct(k.n / k.tot) : "–", d: `av ${fmtNum(k.tot)} hendelser` },
    k.pop
      ? {
        k: "Per 1 000 innbyggere per år", v: fmt1(k.n / yrs / k.pop * 1000),
        d: sel.geo.kind === "all" ? `${fmtNum(k.pop)} innbyggere (SSB ${popYear})` : `Hele landet: ${fmt1(natRate)}. Distriktene publiserer ulikt, så rater kan ikke sammenlignes direkte.`,
      }
      : k.n / days(sel) < 0.5
        ? { k: "Hendelser per måned", v: fmt1((k.n / days(sel)) * 30.4), d: "snitt i perioden" }
        : { k: "Hendelser per dag", v: fmt1(k.n / days(sel)), d: "snitt i perioden" },
  ];

  const pts = trend.pts.map((x) => ({ ...x, label: mlabel(x.m) }));
  const hasKids = top !== "*" && childrenOf(ds, top).length > 0;
  const personsEnough = persons.total >= MIN_PERSONS;

  return (
    <div className="grid">
      <KpiRow items={kpis} label="Nøkkeltall" />
      <Panel span={12} id="insights-title" title="Nøkkelfunn" className="insights-panel">
        <ul className="insights">{facts.map((t) => <li key={t}><Rich text={t} /></li>)}</ul>
      </Panel>
      <Panel span={8} id="trend-title" title={`${tname(ds, cls)} per måned`}
        lede={`${ctx(sel)}.${trend.partialLast ? " Siste måned er ikke komplett (stiplet)." : ""}`}>
        <div className="legend">
          <span><span className="sw" style={{ background: "var(--series)" }} />{p.label}</span>
          {trend.hasCompare && <span><span className="sw dash" />Samme måned året før</span>}
        </div>
        <LineChart
          pts={pts} partialLast={trend.partialLast} compare={trend.hasCompare ? trend.pts.map((x) => x.pv) : null}
          ariaLabel={`${tname(ds, cls)} per måned, ${ctx(sel)}`}
          tip={(pt) => (
            <>
              <b>{pt.label}</b><br />{fmtNum(pt.v)} hendelser
              {pt.pv != null && <><br />Året før: {fmtNum(pt.pv)}</>}
              {cls !== "*" && <><br />{fmtPct(pt.v / Math.max(1, pt.t))} av alle hendelser</>}
              {pt.m === ds.last && <><br /><i>delvis måned</i></>}
            </>
          )}
        />
      </Panel>
      <Panel span={4} id="sub-title"
        title={top === "*" ? "Typer hendelser" : (
          <>
            Typer {tname(ds, top).toLowerCase()}{" "}
            <button type="button" className="back" onClick={() => update({ cls: "*" })}>← Alle typer</button>
          </>
        )}
        lede={top === "*"
          ? "Klikk for å se nærmere på én type. En hendelse kan telle i flere typer."
          : "En hendelse kan telle i flere typer (f.eks. ran med kniv), så summen kan bli større enn totalen. Klikk for å velge."}>
        {top !== "*" && !hasKids ? (
          <p className="note">{tname(ds, top)} har ingen underklasser ennå.</p>
        ) : (
          <BarList
            items={classes} label={top === "*" ? "Typer hendelser" : "Undertyper"}
            onSelect={(i) => update({ cls: top === "*" ? i.code : i.code === cls ? top : i.code })}
            tip={(i) => <><b>{i.label}</b><br />{fmtNum(i.v)}<br /><i>{i.sel ? "Klikk for å fjerne valget" : "Klikk for å velge"}</i></>}
          />
        )}
      </Panel>
      {changes.applicable && (
        <Panel span={12} id="chg-title" title={changes.title}
          lede={changes.hasPrev
            ? `${tname(ds, cls)}, ${p.label} mot året før. Endring i antall hendelser; bare steder med minst ${MIN_CHANGE} hendelser i ett av årene.${changes.drift ? ` ${changes.drift}` : ""}`
            : "Velg «Siste 12 hele mnd» eller 2025 for å sammenligne med året før."}>
          {changes.hasPrev && (
            <div className="chg-grid">
              {([["Økt mest", changes.ups, "+"], ["Falt mest", changes.downs, "−"]] as const).map(([head, items, sign]) => (
                <div key={head}>
                  <h3>{head}</h3>
                  <BarList
                    items={items} label={head} fmt={(v) => `${sign}${fmtNum(v)}`}
                    selectable={(i) => i.geo != null}
                    onSelect={(i) => { if (i.geo) update({ geo: i.geo }); }}
                    tip={(i) => (
                      <>
                        <b>{i.label}</b><br />{fmtNum(i.o)} → {fmtNum(i.c)} ({i.d > 0 ? "+" : ""}{fmtNum(i.d)}{i.o ? `, ${i.d > 0 ? "+" : ""}${fmtPct(i.d / i.o)}` : ""})
                        {i.geo && <><br /><i>Klikk for å velge</i></>}
                      </>
                    )}
                  />
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}
      <Panel span={12} id="sev-title" title="Alvorlighet, skade og tone"
        lede={`${tname(ds, cls)}, ${ctx(sel)}. Språkmodellens vurdering ut fra teksten, ikke politiets. ${fmtNum(severity.tot)} hendelser${severity.exercises ? `, hvorav ${fmtNum(severity.exercises)} øvelser` : ""}.${sel.sev !== "*" ? ` Dette panelet viser alle alvorlighetsgrader; resten av siden er filtrert på «${sel.sev}».` : ""}`}>
        <div className="grid3">
          <div>
            <h3>Alvorlighet</h3>
            <BarList items={severity.severity} label="Alvorlighet" onSelect={(i) => update({ sev: state.sev === i.value ? "*" : i.value })}
              tip={(i) => <><b>{i.label}</b><br />{fmtNum(i.v)} hendelser · {fmtPct(severity.tot ? i.v / severity.tot : 0)}<br /><i>Klikk for å filtrere</i></>} />
          </div>
          <div>
            <h3>Skade på personer</h3>
            <BarList items={severity.injury} label="Skade på personer"
              tip={(i) => <><b>{i.label}</b><br />{fmtNum(i.v)} hendelser · {fmtPct(severity.tot ? i.v / severity.tot : 0)}</>} />
          </div>
          <div>
            <h3>Tone i teksten</h3>
            <BarList items={severity.sentiment} label="Tone i teksten"
              tip={(i) => <><b>{i.label}</b><br />{fmtNum(i.v)} hendelser · {fmtPct(severity.tot ? i.v / severity.tot : 0)}</>} />
          </div>
        </div>
      </Panel>
      <Panel span={6} id="outcomes-title" title="Hva politiet gjorde"
        lede={`Hentet fra teksten: hva politiet gjorde. ${fmtNum(outcomes.any)} av ${fmtNum(outcomes.n)} hendelser (${fmtPct(outcomes.n ? outcomes.any / outcomes.n : 0)}) nevner et utfall.`}>
        <BarList items={outcomes.items} label="Hva politiet gjorde"
          tip={(i) => <><b>{i.label}</b><br />{fmtNum(i.v)} hendelser · {fmtPct(outcomes.n ? i.v / outcomes.n : 0)} av alle i utvalget</>} />
      </Panel>
      <Panel span={6} id="persons-title" title="Hvem er omtalt"
        lede="Kjønn og aldersgruppe der teksten nevner det, f.eks. «mann i 20-årene».">
        {personsEnough ? (
          <>
            <div className="legend">
              {PERSON_SERIES.map((s) => <span key={s.name}><span className="sw" style={{ background: s.color }} />{s.name}</span>)}
            </div>
            <PersonsChart counts={persons.counts} ages={ds.app.ages} />
            <p className="note">
              Alder i år. {fmtNum(persons.total)} omtalte personer i {fmtNum(persons.withP)} av {fmtNum(persons.nInc)} hendelser
              ({fmtPct(persons.nInc ? persons.withP / persons.nInc : 0)}) – de fleste meldinger nevner ikke alder og kjønn.
            </p>
          </>
        ) : (
          <p className="note">{persons.total ? `Bare ${fmtNum(persons.total)} personer er omtalt` : "Ingen personer er omtalt"} med kjønn og alder i utvalget – for få til å vise en pålitelig fordeling (minst {MIN_PERSONS} trengs). Prøv et større område eller en lengre periode.</p>
        )}
      </Panel>
    </div>
  );
}
