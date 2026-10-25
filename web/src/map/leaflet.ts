/**
 * Leaflet med leaflet.heat. leaflet.heat er et vanlig skript som utvider den globale L,
 * så L må ligge på window før det lastes. ES-moduler evalueres i importrekkefølge,
 * så denne filen må importeres før "leaflet.heat".
 */
import L from "leaflet";

(window as unknown as { L: typeof L }).L = L;

export default L;

/** Kartverkets gråtonekart (WMTS-cache, Web Mercator). Rekkefølgen er {z}/{y}/{x}. */
export const TILE_URL = "https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png";

/** Kildelinje nederst i kartet. Bydelsgrensene (OSM) nevnes bare når de er med i datafilen. */
export const mapAttribution = (withBydel: boolean): string =>
  ["Data: Politiet", "© Kartverket", ...(withBydel ? ["bydeler © OpenStreetMap"] : [])].join(" · ");
