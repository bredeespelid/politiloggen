import L, { TILE_ATTRIBUTION, TILE_URL } from "../map/leaflet";
import "leaflet.heat";
import { useEffect, useMemo, useRef, useState } from "react";
import { BarList } from "../components/BarList";
import { Panel, RampLegend, Segmented } from "../components/ui";
import { areaLabel, muniName, tname } from "../data/dataset";
import { geoBounds, mapPoints, NORWAY, type MapPoint } from "../lib/aggregate";
import { fmtNum, fmtPct } from "../lib/format";
import { cssVar } from "../lib/hooks";
import { bydelLabels, labelFits, type Placed } from "../map/labels";
import type { MapKind, MapView } from "../state/appState";
import type { ViewProps } from "./types";

const VIEWS = [["geo", "Zoom: valgt område"], ["norge", "Hele landet"]] as const;
const KINDS = [["heat", "Heatmap"], ["dots", "Punkter"]] as const;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
const ring = (r: [number, number][]) => r.map(([x, y]) => [y, x] as [number, number]);

interface Layers {
  bounds: L.LayerGroup;
  dots: L.LayerGroup;
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

  const data = useMemo(() => mapPoints(sel), [sel]);
  const bounds = useMemo(() => geoBounds(ds, sel.geo, sel.mask), [ds, sel.geo, sel.mask]);
  const bydeler = useMemo(() => bydelLabels(ds.app.areas), [ds]);
  const cap = useMemo(() => {
    const vals = data.pts.map((p) => p.v).sort((a, b) => a - b);
    return vals.length ? Math.max(1, vals[Math.floor(vals.length * 0.97)]) : 1;
  }, [data]);
  const vmax = useMemo(() => Math.max(0, ...data.pts.map((p) => p.v)), [data]);
  const where = (p: MapPoint) => `${muniName(ds, p.row[5])}${p.row[2] ? ` · ${p.row[2]}` : ""}`;

  // Opprett kartet én gang. Kartet fjernes når fanen forlates, og med det varmekartlaget.
  useEffect(() => {
    const map = L.map(el.current!, { zoomSnap: 0.25, minZoom: 4, maxZoom: 16, preferCanvas: true });
    map.attributionControl.setPrefix(false).addAttribution("Data: Politiet");
    let loaded = 0;
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 18, className: "base-tiles" })
      .on("tileload", () => { loaded++; setTiles("ok"); })
      .on("tileerror", () => { if (!loaded) setTiles("feil"); })
      .addTo(map);
    const group = () => L.layerGroup().addTo(map);
    layers.current = { bounds: group(), dots: group(), bydel: group(), hover: group(), labels: group(), heat: null };
    map.on("moveend", () => setMoved((n) => n + 1));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layers.current = null;
    };
  }, []);

  // Grenser: fylker og kommuner lett, valgt kommune tydelig.
  useEffect(() => {
    const g = layers.current?.bounds;
    if (!g) return;
    g.clearLayers();
    const border = cssVar("--border"), accent = cssVar("--accent");
    for (const f of ds.app.fylker) {
      L.polygon(f.rings.map(ring), { color: border, weight: 1, opacity: 0.7, fill: false, interactive: false }).addTo(g);
    }
    for (const k of ds.app.kommuner) {
      const selected = k.id === sel.geo.id;
      L.polygon(k.rings.map(ring), selected
        ? { color: accent, weight: 2.5, opacity: 0.9, fill: false, interactive: false }
        : { color: border, weight: 1, opacity: 0.6, dashArray: "3 3", fill: false, interactive: false }).addTo(g);
    }
  }, [ds, sel.geo.id, scheme]);

  // Heatmap eller punkter, pluss usynlige punkter med tooltip.
  useEffect(() => {
    const map = mapRef.current, ls = layers.current;
    if (!map || !ls) return;
    if (ls.heat) { map.removeLayer(ls.heat); ls.heat = null; }
    ls.dots.clearLayers();
    if (state.mkind === "dots") {
      const surface = cssVar("--surface"), fill = cssVar("--series");
      for (const p of data.pts.slice().sort((a, b) => b.v - a.v)) {
        L.circleMarker([p.lat, p.lon], { radius: 3 + 17 * Math.sqrt(p.v / Math.max(1, vmax)), color: surface, weight: 1, fillColor: fill, fillOpacity: 0.55, interactive: false }).addTo(ls.dots);
      }
    } else {
      const ramp = [2, 3, 4, 5, 6, 7].map((i) => cssVar(`--h${i}`));
      const gradient = { 0.15: ramp[0], 0.35: ramp[1], 0.55: ramp[2], 0.75: ramp[3], 0.9: ramp[4], 1: ramp[5] };
      ls.heat = L.heatLayer(data.pts.map((p) => [p.lat, p.lon, Math.min(1, p.v / cap)] as L.HeatLatLngTuple),
        { radius: 20, blur: 15, maxZoom: 11, max: 1, minOpacity: 0.35, gradient }).addTo(map);
    }
    ls.hover.clearLayers();
    for (const p of data.pts.slice().sort((a, b) => b.v - a.v).slice(0, 800)) {
      L.circleMarker([p.lat, p.lon], { radius: 7, stroke: false, fillOpacity: 0 })
        .bindTooltip(`<b>${esc(areaLabel(p.row))}</b><br>${esc(where(p))}<br>${fmtNum(p.v)} hendelser`, { direction: "top" })
        .on("click", () => map.setView([p.lat, p.lon], Math.max(map.getZoom(), 13)))
        .addTo(ls.hover);
    }
  }, [data, cap, vmax, scheme, state.mkind]);

  // Tilpass utsnittet når område eller visning endres.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.invalidateSize();
    map.fitBounds(state.mview === "norge" ? NORWAY : bounds, { padding: [10, 10] });
  }, [bounds, state.mview]);

  // Områdene i utsnittet (oppdateres når kartet flyttes).
  const inView = useMemo(() => {
    const map = mapRef.current;
    if (!map) return [];
    const b = map.getBounds();
    return data.pts.filter((p) => b.contains([p.lat, p.lon])).sort((a, c) => c.v - a.v);
  }, [data, moved]);
  const inViewTotal = inView.reduce((s, p) => s + p.v, 0);

  // Etiketter: bydeler først, så de største stedene. Etiketter som ville overlappet en annen, hoppes over.
  useEffect(() => {
    const map = mapRef.current, ls = layers.current;
    if (!map || !ls) return;
    ls.labels.clearLayers();
    ls.bydel.clearLayers();
    const z = map.getZoom(), b = map.getBounds(), placed: Placed[] = [];
    if (z >= 10 && z < 13.5) {
      for (const bl of bydeler) {
        if (!b.contains([bl.lat, bl.lon])) continue;
        const pt = map.latLngToContainerPoint([bl.lat, bl.lon]), w = bl.name.length * 8 + 12;
        if (!labelFits(placed, pt.x, pt.y, w)) continue;
        placed.push({ x: pt.x, y: pt.y, w });
        L.tooltip({ permanent: true, direction: "center", className: "bydel", interactive: false }).setLatLng([bl.lat, bl.lon]).setContent(esc(bl.name)).addTo(ls.bydel);
      }
    }
    if (z < 11) return;
    for (const p of inView.slice(0, 14)) {
      const pt = map.latLngToContainerPoint([p.lat, p.lon]), w = p.row[0].length * 6.5 + 8, cx = pt.x + 6 + w / 2;
      if (!labelFits(placed, cx, pt.y, w)) continue;
      placed.push({ x: cx, y: pt.y, w });
      L.tooltip({ permanent: true, direction: "right", className: "place", offset: [6, 0] }).setLatLng([p.lat, p.lon]).setContent(esc(p.row[0])).addTo(ls.labels);
    }
  }, [inView, bydeler]);

  const items = inView.slice(0, 12).map((p) => ({
    key: p.a, label: `${areaLabel(p.row)}${sel.geo.kind === "all" || sel.geo.kind === "d" ? `, ${muniName(ds, p.row[5])}` : ""}`, v: p.v, p,
  }));
  const cov = data.total ? fmtPct(data.located / data.total) : "0 %";

  return (
    <div className="grid">
      <section className="panel span-8 map-panel" aria-labelledby="m-title">
        <div className="map-head">
          <h2 id="m-title">{tname(ds, state.cls)} · {sel.geo.label} · {sel.period.label}</h2>
          <div className="map-ctrls">
            <Segmented<MapKind> label="Kartvisning" value={state.mkind} options={KINDS} onChange={(mkind) => update({ mkind })} />
            <Segmented<MapView> label="Utsnitt" value={state.mview} options={VIEWS} onChange={(mview) => update({ mview })} />
          </div>
        </div>
        <div ref={el} className="map" role="region" aria-label="Kart over hendelser" />
        {state.mkind === "dots" ? (
          <div className="legend"><span>Sirkelens areal viser antall hendelser per område (størst: {fmtNum(vmax)}).</span></div>
        ) : (
          <RampLegend from="Få" to={`Flere hendelser (mørkest: ${fmtNum(cap)} eller flere på samme sted)`} steps={[2, 3, 4, 5, 6, 7].map((i) => `var(--h${i})`)} />
        )}
        <p className="note">
          {cov} av hendelsene i utvalget har et område som er slått opp i Kartverket ({fmtNum(data.located)} av {fmtNum(data.total)}).
          Veier, tunneler og hendelser uten oppgitt sted vises ikke. Tallene i listen gjelder derfor bare stedfestede hendelser.
          {tiles === "feil" && " Bakgrunnskartet fra Kartverket kunne ikke lastes, så bare grensene vises."}
        </p>
      </section>
      <Panel span={4} id="m-top-title" title="Steder med flest hendelser i kartutsnittet"
        lede={`${fmtNum(inViewTotal)} hendelser fordelt på ${fmtNum(inView.length)} områder i utsnittet.`}>
        <BarList
          items={items} label="Steder med flest hendelser i kartutsnittet"
          onSelect={(i) => { const map = mapRef.current; if (map) map.setView([i.p.lat, i.p.lon], Math.max(map.getZoom() + 2, 13)); }}
          tip={(i) => <><b>{i.p.row[0]}</b><br />{where(i.p)}<br />{fmtNum(i.v)} hendelser · {fmtPct(inViewTotal ? i.v / inViewTotal : 0)} av utsnittet</>}
        />
        <p className="note">Klikk et område for å zoome inn. Listen oppdateres når du flytter eller zoomer kartet.</p>
      </Panel>
    </div>
  );
}
