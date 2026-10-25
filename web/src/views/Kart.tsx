import L, { TILE_URL, mapAttribution } from "../map/leaflet";
import "leaflet.heat";
import { useEffect, useMemo, useRef, useState } from "react";
import { BarList } from "../components/BarList";
import { Panel, RampLegend, Segmented } from "../components/ui";
import { areaLabel, muniName, tname } from "../data/dataset";
import { geoBounds, mapPoints, NORWAY, type MapPoint } from "../lib/aggregate";
import { fmtNum, fmtPct } from "../lib/format";
import { cssVar } from "../lib/hooks";
import { bydelLabels, labelFits, placeLabel, type Placed } from "../map/labels";
import type { MapKind, MapView } from "../state/appState";
import type { ViewProps } from "./types";

const VIEWS = [
  ["geo", "Zoom: valgt område", "Zoom til valgt område"],
  ["norge", "Zoom ut: Norge", "Zoom ut til hele Norge. Kartet viser fortsatt bare valgt område."],
] as const;
const KINDS = [["heat", "Heatmap"], ["dots", "Punkter"]] as const;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
const ring = (r: [number, number][]) => r.map(([x, y]) => [y, x] as [number, number]);

interface Layers {
  bounds: L.LayerGroup;
  bydelPoly: L.LayerGroup;
  dots: L.LayerGroup;
  sel: L.LayerGroup;
  hover: L.LayerGroup;
  bydel: L.LayerGroup;
  labels: L.LayerGroup;
  heat: L.HeatLayer | null;
}

type TileStatus = "laster" | "ok" | "feil";

export default function Kart({ ds, sel, state, update, scheme }: ViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layers = useRef<Layers | null>(null);
  const [moved, setMoved] = useState(0);
  const [tiles, setTiles] = useState<TileStatus>("laster");
  const g = sel.geo;

  const data = useMemo(() => mapPoints(sel), [sel]);
  const bounds = useMemo(() => geoBounds(ds, g, sel.mask), [ds, g, sel.mask]);
  const bydeler = useMemo(() => bydelLabels(ds.app), [ds]);
  const hasBydelGeo = useMemo(() => Object.keys(ds.app.bydelGeo ?? {}).length > 0, [ds]);
  const cap = useMemo(() => {
    const vals = data.pts.map((p) => p.v).sort((a, b) => a - b);
    return vals.length ? Math.max(1, vals[Math.floor(vals.length * 0.97)]) : 1;
  }, [data]);
  const vmax = useMemo(() => Math.max(0, ...data.pts.map((p) => p.v)), [data]);
  const where = (p: MapPoint) => `${muniName(ds, p.row[5])}${p.row[2] ? ` · ${p.row[2]}` : ""}`;

  // Opprett kartet én gang. Kartet fjernes når fanen forlates, og med det varmekartlaget.
  useEffect(() => {
    const map = L.map(el.current!, { zoomSnap: 0.25, zoomDelta: 0.5, minZoom: 4, maxZoom: 16, preferCanvas: true });
    map.attributionControl.setPrefix(false).addAttribution(mapAttribution(hasBydelGeo));
    let loaded = 0;
    L.tileLayer(TILE_URL, { maxZoom: 18, className: "base-tiles" })
      .on("tileload", () => { loaded++; setTiles("ok"); })
      .on("tileerror", () => { if (!loaded) setTiles("feil"); })
      .addTo(map);
    const group = () => L.layerGroup().addTo(map);
    layers.current = {
      bounds: group(), bydelPoly: group(), dots: group(), sel: group(), bydel: group(), hover: group(), labels: group(), heat: null,
    };
    map.on("moveend", () => setMoved((n) => n + 1));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layers.current = null;
    };
  }, [hasBydelGeo]);

  // Grenser: fylker lett, kommuner stiplet, valgt kommune tydelig.
  useEffect(() => {
    const lg = layers.current?.bounds;
    if (!lg) return;
    lg.clearLayers();
    const border = cssVar("--border"), dark = scheme === "dark";
    for (const f of ds.app.fylker) {
      L.polygon(f.rings.map(ring), { color: border, weight: 1, opacity: 0.7, fill: false, interactive: false }).addTo(lg);
    }
    for (const k of ds.app.kommuner) {
      const selected = k.id === g.id;
      L.polygon(k.rings.map(ring), {
        color: dark ? "#8a98ab" : "#6b7a8f", weight: selected ? 2.2 : 1, opacity: selected ? 0.9 : 0.55,
        dashArray: selected ? undefined : "4 4", fill: false, interactive: false,
      }).addTo(lg);
    }
  }, [ds, g.id, scheme]);

  // Bydelsgrenser (OSM): tynne omriss med navn og antall; klikk velger bydelen.
  useEffect(() => {
    const lg = layers.current?.bydelPoly;
    if (!lg) return;
    lg.clearLayers();
    const accent = cssVar("--accent"), dark = scheme === "dark";
    for (const [mid, byName] of Object.entries(ds.app.bydelGeo ?? {})) {
      for (const [name, rings] of Object.entries(byName)) {
        const bi = ds.bydelIdx.get(`${mid}|${name}`) ?? 0, selected = g.kind === "b" && g.b === bi;
        L.polygon(rings.map(ring), {
          color: selected ? accent : dark ? "#9aa8ba" : "#5d6b7e", weight: selected ? 3 : 1.2, opacity: selected ? 1 : 0.7,
          fillColor: accent, fillOpacity: selected ? 0.06 : 0, dashArray: selected ? undefined : "2 3",
        })
          .bindTooltip(`<b>${esc(name)}</b><br>${fmtNum(data.byd.get(bi) ?? 0)} hendelser<br><i>Klikk for å velge bydel</i>`, { sticky: true, direction: "top" })
          .on("click", () => update({ geo: `b:${mid}|${name}` }))
          .addTo(lg);
      }
    }
  }, [ds, g.kind, g.b, data.byd, scheme, update]);

  // Heatmap eller punkter, pluss usynlige punkter med tooltip som velger stedet.
  useEffect(() => {
    const map = mapRef.current, ls = layers.current;
    if (!map || !ls) return;
    if (ls.heat) { map.removeLayer(ls.heat); ls.heat = null; }
    ls.dots.clearLayers();
    if (state.mkind === "dots") {
      const surface = cssVar("--surface"), fill = cssVar("--series");
      for (const p of data.pts.slice().sort((a, b) => b.v - a.v)) {
        L.circleMarker([p.lat, p.lon], { radius: 3 + 17 * Math.sqrt(p.v / Math.max(1, vmax)), color: surface, weight: 1, fillColor: fill, fillOpacity: 0.6, interactive: false }).addTo(ls.dots);
      }
    } else {
      const ramp = [3, 4, 5, 6, 7].map((i) => cssVar(`--h${i}`));
      const gradient = { 0.2: ramp[0], 0.4: ramp[1], 0.6: ramp[2], 0.8: ramp[3], 1: ramp[4] };
      ls.heat = L.heatLayer(data.pts.map((p) => [p.lat, p.lon, Math.min(1, p.v / cap)] as L.HeatLatLngTuple),
        { radius: 24, blur: 18, maxZoom: 11, max: 1, minOpacity: 0.38, gradient }).addTo(map);
    }
    ls.hover.clearLayers();
    for (const p of data.pts.slice().sort((a, b) => b.v - a.v).slice(0, 800)) {
      L.circleMarker([p.lat, p.lon], { radius: 8, stroke: false, fillOpacity: 0 })
        .bindTooltip(`<b>${esc(areaLabel(p.row))}</b><br>${esc(where(p))}<br>${fmtNum(p.v)} hendelser<br><i>Klikk for å velge stedet</i>`, { direction: "top" })
        .on("click", () => update({ geo: `a:${p.a}` }))
        .addTo(ls.hover);
    }
  }, [data, cap, vmax, scheme, state.mkind, update]);

  // Ring rundt valgt sted.
  useEffect(() => {
    const ls = layers.current;
    if (!ls) return;
    ls.sel.clearLayers();
    const A = g.kind === "a" && g.a ? ds.app.areas[g.a - 1] : null;
    if (A && A[3] != null && A[4] != null) {
      L.circleMarker([A[3], A[4]], { radius: 14, color: cssVar("--accent"), weight: 3, fill: false, interactive: false }).addTo(ls.sel);
    }
  }, [ds, g.kind, g.a, scheme]);

  // Tilpass utsnittet når område eller visning endres (nær nok til å se stedet når ett sted er valgt).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.invalidateSize();
    map.fitBounds(state.mview === "norge" ? NORWAY : bounds, { padding: [10, 10], maxZoom: 15 });
  }, [bounds, state.mview]);

  // Områdene i utsnittet (oppdateres når kartet flyttes).
  const inView = useMemo(() => {
    const map = mapRef.current;
    if (!map) return [];
    const b = map.getBounds();
    return data.pts.filter((p) => b.contains([p.lat, p.lon])).sort((a, c) => c.v - a.v);
  }, [data, moved]);
  const inViewTotal = inView.reduce((s, p) => s + p.v, 0);

  // Etiketter: de fem mest omtalte stedene først, så bydeler, så resten av stedene.
  // Hver etikett prøver høyre, venstre, over og under, og hoppes over hvis ingen gir plass.
  useEffect(() => {
    const map = mapRef.current, ls = layers.current;
    if (!map || !ls) return;
    ls.labels.clearLayers();
    ls.bydel.clearLayers();
    const z = map.getZoom(), b = map.getBounds(), placed: Placed[] = [];
    const showPlace = (p: MapPoint) => {
      const pt = map.latLngToContainerPoint([p.lat, p.lon]), w = `${p.row[0]} ${fmtNum(p.v)}`.length * 6.6 + 10;
      const c = placeLabel(placed, pt.x, pt.y, w);
      if (!c) return;
      L.tooltip({ permanent: true, direction: c.dir, className: "place", offset: c.offset })
        .setLatLng([p.lat, p.lon]).setContent(`${esc(p.row[0])} <b>${fmtNum(p.v)}</b>`).addTo(ls.labels);
    };
    const near = z >= 11 ? inView.slice(0, 18) : [];
    near.slice(0, 5).forEach(showPlace);
    if (z >= 10 && z < 14) {
      for (const bl of bydeler) {
        if (!b.contains([bl.lat, bl.lon])) continue;
        const pt = map.latLngToContainerPoint([bl.lat, bl.lon]), w = bl.name.length * 8 + 12;
        if (!labelFits(placed, pt.x, pt.y, w)) continue;
        placed.push({ x: pt.x, y: pt.y, w });
        L.tooltip({ permanent: true, direction: "center", className: "bydel", interactive: false }).setLatLng([bl.lat, bl.lon]).setContent(esc(bl.name)).addTo(ls.bydel);
      }
    }
    near.slice(5).forEach(showPlace);
  }, [inView, bydeler]);

  const items = inView.slice(0, 12).map((p) => ({
    key: p.a, label: `${areaLabel(p.row)}${g.kind === "all" || g.kind === "d" ? `, ${muniName(ds, p.row[5])}` : ""}`, v: p.v, p, sel: g.kind === "a" && g.a === p.a,
  }));
  const cov = data.total ? fmtPct(data.located / data.total) : "0 %";

  return (
    <div className="grid">
      <section className="panel span-8 map-panel" aria-labelledby="m-title">
        <div className="map-head">
          <h2 id="m-title">{tname(ds, state.cls)} · {g.label} · {sel.period.label}</h2>
          <div className="map-ctrls">
            <Segmented<MapKind> label="Kartvisning" value={state.mkind} options={KINDS} onChange={(mkind) => update({ mkind })} />
            <Segmented<MapView> label="Utsnitt" value={state.mview} options={VIEWS} onChange={(mview) => update({ mview })} />
          </div>
        </div>
        <div ref={el} className={`map${scheme === "dark" ? " dark" : ""}`} role="region" aria-label="Kart over hendelser" />
        {state.mkind === "dots" ? (
          <div className="legend"><span>Sirkelens areal viser antall hendelser per sted (størst: {fmtNum(vmax)}).</span></div>
        ) : (
          <RampLegend from="Få" to={`Flere hendelser (mørkest: ${fmtNum(cap)} eller flere på samme sted)`} steps={[2, 3, 4, 5, 6, 7].map((i) => `var(--h${i})`)} />
        )}
        <p className="note">
          {cov} av hendelsene {g.kind === "a" ? "i kommunen" : "i utvalget"} har et sted som er slått opp i Kartverket ({fmtNum(data.located)} av {fmtNum(data.total)}).
          Veier, tunneler og hendelser uten oppgitt sted vises ikke. Klikk et sted eller en bydel for å velge det.
          {state.mview === "norge" && g.kind !== "all" && ` Kartet viser bare ${g.label}. Velg «Hele landet» under Område for å se alle.`}
          {tiles === "feil" && " Bakgrunnskartet fra Kartverket kunne ikke lastes, så bare grensene vises."}
        </p>
      </section>
      <Panel span={4} id="m-top-title" title="Steder med flest hendelser i kartutsnittet"
        lede={`${fmtNum(inViewTotal)} hendelser fordelt på ${fmtNum(inView.length)} steder i kartutsnittet.`}>
        <BarList
          items={items} label="Steder med flest hendelser i kartutsnittet"
          onSelect={(i) => update({ geo: `a:${i.p.a}` })}
          tip={(i) => <><b>{i.p.row[0]}</b><br />{where(i.p)}<br />{fmtNum(i.v)} hendelser · {fmtPct(inViewTotal ? i.v / inViewTotal : 0)} av utsnittet<br /><i>Klikk for å velge stedet</i></>}
        />
        <p className="note">Klikk et sted for å velge det. Listen oppdateres når du flytter eller zoomer kartet.</p>
      </Panel>
    </div>
  );
}
