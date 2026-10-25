# Politiloggen Analyse – webapp

Analyseverktøy over Politiloggen (operasjonssentralenes logg, ca. 140 000 hendelser fra mai 2023):
egen klassifisering (8 overklasser, 26 underklasser), vaskede og typede områder, bydeler for Oslo
og Bergen, varmekart på kart fra Kartverket og tidsmønster.

Vite + React 18 + TypeScript. Ingen UI- eller diagrambibliotek: diagrammene er håndskrevet SVG.
Kartet bruker Leaflet og leaflet.heat med Kartverkets gråtonekart som bakgrunn.

## Kom i gang

Krever Node 20 eller nyere.

```sh
cd web
npm install
npm run dev        # http://localhost:5173
```

Appen henter `public/app.json` når den starter. Filen sjekkes ikke inn i git (se under).

## Data

`app.json` lages av skriptene i `scripts/` i rotmappen:

```sh
python3 scripts/build_db.py && python3 scripts/geocode.py && python3 scripts/build_app_data.py --out web/public/app.json
```

- `build_db.py` leser CSV-eksporten fra Politiloggen og bygger `politiloggen.db` (SQLite) med klassifisering.
- `geocode.py` slår opp koordinater for områdene hos Kartverket.
- `build_app_data.py` pakker én rad per hendelse som base64-felt med fast bredde (`rec` og `recFields`),
  pluss oppslagstabeller, eksempler og fylkes- og kommunegrenser.

Bydelsgrenser (OSM) leses fra `prototype/data/bydeler.json` (lages med `scripts/fetch_bydel_geo.py`) og
havner i `bydelGeo`. Hvis de mangler, tegnes bare bydelsetiketter ut fra stedene. Kartfliser i
`app.json` (`--basemap`, brukes av den frittstående prototypen) ignoreres av webappen, som henter
kartfliser live fra Kartverket. La derfor være å bruke `--basemap` her: filen blir flere MB større.

Hvis filen mangler, viser appen en feilmelding med kommandoen over.

## Lenker til et utvalg

Filtrene ligger i adressen, så et utvalg kan deles:

```
/?geo=b:0301|Grünerløkka&cls=vold&p=2025#fordeling
```

`geo` er `all`, `d:<distrikts-id>`, `m:<kommunenr>`, `b:<kommunenr>|<bydel>` eller `a:<stedsindeks>`
(ett sted, f.eks. `a:42` = Grønland; veier kan ikke velges). `cls` er en
klassekode (`vold`, `vold.kniv`, …) eller `*`. `p` er `12m`, `2025`, `2024` eller `alle`.
Valgfritt: `dm` (`pop`, `share`, `abs`), `fl` (`bydel`, `sted`: nivå i Fordeling), `mv` (`geo`, `norge`),
`mk` (`heat`, `dots`) og `q` (søk i Hendelser).
Ugyldige verdier byttes ut med standardvalget (Oslo, alle hendelser, siste 12 hele måneder).

## Kommandoer

| Kommando            | Hva den gjør                                      |
| ------------------- | ------------------------------------------------- |
| `npm run dev`       | Utviklingsserver med hot reload                   |
| `npm run build`     | Typesjekk (`tsc -b`) og produksjonsbygg i `dist/` |
| `npm run preview`   | Server det ferdige bygget lokalt                  |
| `npm test`          | Enhetstester (Vitest)                             |

## Struktur

```
src/
  data/        typer for app.json, dekoding av hendelsesrader, oppslag og lasting
  lib/         aggregeringer (rene funksjoner), perioder, områdefilter, formatering, hooks
  state/       filtertilstand: adressen (?geo=…&cls=…&p=…) går foran localStorage («pl-state-v2»),
               fanen følger #hash
  components/  diagrammer (linje, søyler, personer, varmekart, krysstabell), filtre, tooltip
  views/       én fil per fane: Oversikt, Kart, Fordeling, Når (Tidsmønster), Steder (Områder),
               Hendelser, Om klassifiseringen (Klassifisering), Datamodell
  map/         Leaflet-oppsett (fliser, attribusjon) og bydelsetiketter. Kartet er isolert her
               og i views/Kart.tsx, og lastes først når fanen åpnes
test/          tester for dekoderen og aggregeringene, med et lite syntetisk datasett
```

Alle beregninger ligger i `src/lib/aggregate.ts` og tar en `Selection` (datasett + område, klasse
og periode). Visningene memoiserer dem med `useMemo`, så bare det som endres regnes om.

## Kart

Bakgrunnen er Kartverkets gråtonekart:
`https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png`
(© Kartverket). I mørk modus inverteres og dempes kartflisene med et CSS-filter.
Hvis flisene ikke kan lastes, vises bare grensene, og kartet sier fra under.

## Replit

`.replit` i rotmappen starter utviklingsserveren:

```sh
cd web && npm install && npm run dev -- --host 0.0.0.0 --port 5173
```

Last opp `app.json` til `web/public/` (eller kjør skriptene over i Replit-skallet hvis CSV-eksporten
ligger der). For publisering bygges appen med `npm run build` og serveres med `vite preview`.

## Tilgjengelighet

- Alle kontroller kan brukes med tastatur og har synlig fokus.
- Diagrammene har `aria-label`. Linjediagram, persondiagram og varmekart kan fokuseres, og
  piltastene viser verdiene i tooltipen. Esc lukker tooltipen.
- Søylerader som kan velges, er knapper med tooltip ved fokus.
- Lys og mørk modus følger `prefers-color-scheme` og kan overstyres med `data-theme="light|dark"` på `<html>`.
