# politiloggen-mcp

MCP-server for [Politiloggen](https://www.politiet.no/politiloggen). Den gir AI-assistenter tilgang til politiets operative meldinger fra operasjonssentralene i Norge.

Data hentes fra det åpne [Politiloggen API](https://api.politiloggen.politiet.no/swagger/index.html), som er lisensiert under [NLOD 2.0](https://data.norge.no/nlod/no/2.0). Politiet krever at kilden krediteres med en synlig lenke til www.politiet.no/politiloggen. Derfor tar serveren med kildehenvisning i svarene.

## Verktøy

| Verktøy | Beskrivelse |
| --- | --- |
| `search_incidents` | Søk etter hendelser, nyeste først. Du kan filtrere på distrikt, kommune, kategori, område, relativt tidsrom (`LastHour`…`LastYear`) eller `from`/`to`, og velge å se bare pågående hendelser. Søket støtter paginering. |
| `get_incident` | Henter én hendelse med alle oppdateringer. |
| `list_categories` | Lister hendelseskategoriene, for eksempel Trafikk, Brann og Ro og orden. |
| `list_districts` | Lister politidistriktene, med eller uten kommunene i hvert distrikt. |

## Kom i gang

```sh
npm install
npm run build
```

### Claude Desktop / Claude Code (stdio)

```json
{
  "mcpServers": {
    "politiloggen": {
      "command": "node",
      "args": ["/sti/til/politiloggen/dist/index.js"]
    }
  }
}
```

I Claude Code: `claude mcp add politiloggen -- node /sti/til/politiloggen/dist/index.js`

### Som fjern-server (Streamable HTTP)

Når `PORT` er satt, kjører serveren over HTTP. Endepunktet er `POST /mcp`, og helsesjekken ligger på `GET /health`. Serveren lagrer ingen tilstand mellom forespørsler, så den passer for Render, Fly, Railway og lignende.

```sh
PORT=8080 npm start
```

Bygg-kommando: `npm install && npm run build`. Startkommando: `npm start`.

## Konfigurasjon

| Variabel | Standard | |
| --- | --- | --- |
| `PORT` | – | Starter HTTP-modus når den er satt. |
| `POLITILOGGEN_BASE_URL` | `https://api.politiloggen.politiet.no` | Overstyrer adressen til API-et. |
