import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DISTRICT_NAMES,
  NotFoundError,
  TIME_SPANS,
  getCategories,
  getDistricts,
  getThread,
  searchThreads,
  type MessageThread,
} from "./api.js";

const ATTRIBUTION = "Kilde: Politiet – www.politiet.no/politiloggen (NLOD 2.0)";

const INSTRUCTIONS = `Hendelser fra Politiloggen – operative meldinger fra politiets operasjonssentraler i Norge.
En hendelse (tråd) har én eller flere meldinger som oppdateres fortløpende. Bruk search_incidents for å finne hendelser
(filtrer på distrikt, kommune, kategori, område og tidsrom), og get_incident for alle meldinger i én hendelse.
Kategorinavn må være eksakte (f.eks. "Trafikk", "Ro og orden") – bruk list_categories ved tvil. Kommuner: list_districts.
Tidspunkter er i UTC fra APIet, men vises i norsk tid. Oppgi alltid kilden: Politiet, www.politiet.no/politiloggen.`;

const osloTime = new Intl.DateTimeFormat("nb-NO", {
  timeZone: "Europe/Oslo",
  dateStyle: "short",
  timeStyle: "short",
});
const fmt = (iso: string) => osloTime.format(new Date(iso));

function place(t: MessageThread) {
  return [t.area, t.municipality, t.district].filter(Boolean).join(", ");
}

function formatThread(t: MessageThread, full: boolean) {
  const messages = t.messages.filter((m) => m.type !== "Removed" && m.type !== "Draft");
  const head = `[${t.id}] ${t.category ?? "Ukjent kategori"} – ${place(t)}${t.isActive ? " (pågår)" : ""}`;
  const when = `Opprettet ${fmt(t.createdOn)}, siste melding ${fmt(t.lastMessageOn)}`;
  const shown = full ? messages : messages.slice(-1);
  const body = shown.map((m) => `  ${fmt(m.createdOn)}: ${m.text?.trim() ?? ""}${m.hasImage ? " [bilde]" : ""}`);
  if (!full && messages.length > 1) body.push(`  (${messages.length} meldinger totalt – bruk get_incident for alle)`);
  return [head, when, ...body].join("\n");
}

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const fail = (s: string) => ({ ...text(s), isError: true });

async function run(fn: () => Promise<ReturnType<typeof text>>) {
  try {
    return await fn();
  } catch (e) {
    return fail(e instanceof NotFoundError ? e.message : `Feil mot Politiloggen: ${(e as Error).message}`);
  }
}

export function createServer() {
  const server = new McpServer({ name: "politiloggen", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "search_incidents",
    {
      title: "Søk i Politiloggen",
      description:
        "Søk etter hendelser i Politiloggen, nyeste først. Viser siste melding per hendelse. " +
        "Uten tidsfilter søkes det i hele historikken.",
      inputSchema: {
        districts: z.array(z.enum(DISTRICT_NAMES)).optional().describe("Politidistrikter"),
        municipalities: z.array(z.string()).optional().describe('Kommunenavn, f.eks. ["Bergen"]'),
        categories: z.array(z.string()).optional().describe('Eksakte kategorinavn, f.eks. ["Trafikk", "Brann"]'),
        area: z.string().optional().describe("Område/bydel/sted, f.eks. «Sentrum» eller «Grünerløkka»"),
        timeSpan: z.enum(TIME_SPANS).optional().describe("Relativt tidsrom. Ignoreres hvis from/to er satt."),
        from: z.string().optional().describe("Fra-tidspunkt, ISO 8601 (f.eks. 2026-10-24 eller 2026-10-24T18:00:00+02:00)"),
        to: z.string().optional().describe("Til-tidspunkt, ISO 8601"),
        activeOnly: z.boolean().optional().describe("Bare hendelser som fortsatt pågår"),
        oldestFirst: z.boolean().optional().describe("Sorter eldste først"),
        limit: z.number().int().min(1).max(100).default(20).describe("Antall hendelser (maks 100)"),
        offset: z.number().int().min(0).default(0).describe("Hopp over så mange (paginering)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ limit, offset, ...filters }) =>
      run(async () => {
        const res = await searchThreads({ ...filters, take: limit, skip: offset });
        const threads = res.messageThreads ?? [];
        if (threads.length === 0) return text(`Ingen hendelser funnet.\n\n${ATTRIBUTION}`);
        const more = res.hasMoreResults ? `\n\nFlere treff finnes – bruk offset=${offset + threads.length}.` : "";
        return text(`${threads.map((t) => formatThread(t, false)).join("\n\n")}${more}\n\n${ATTRIBUTION}`);
      }),
  );

  server.registerTool(
    "get_incident",
    {
      title: "Hent hendelse",
      description: "Hent én hendelse med alle meldinger (oppdateringer) i kronologisk rekkefølge.",
      inputSchema: { id: z.string().describe('Hendelses-ID, f.eks. "260jwp"') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ id }) =>
      run(async () => {
        // Meldings-IDer har formen <tråd>-<n>; godta begge.
        const thread = await getThread(id.replace(/-\d+$/, ""));
        return text(`${formatThread(thread, true)}\n\n${ATTRIBUTION}`);
      }),
  );

  server.registerTool(
    "list_categories",
    {
      title: "Kategorier",
      description: "List alle hendelseskategorier i Politiloggen.",
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () => run(async () => text((await getCategories()).map((c) => c.name).join("\n"))),
  );

  server.registerTool(
    "list_districts",
    {
      title: "Politidistrikter",
      description: "List politidistriktene og (valgfritt) kommunene i hvert distrikt.",
      inputSchema: {
        district: z.enum(DISTRICT_NAMES).optional().describe("Vis kommuner kun for dette distriktet"),
        includeMunicipalities: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ district, includeMunicipalities }) =>
      run(async () => {
        const all = await getDistricts();
        const key = (s: string) => s.toLowerCase().replace(/[\s-]/g, "");
        const picked = district ? all.filter((d) => key(d.district.name).startsWith(key(district) + "politi")) : all;
        const showMunicipalities = includeMunicipalities || Boolean(district);
        return text(
          picked
            .map((d) =>
              showMunicipalities
                ? `${d.district.name}: ${d.municipalities.map((m) => m.name).join(", ")}`
                : d.district.name,
            )
            .join("\n"),
        );
      }),
  );

  return server;
}
