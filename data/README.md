# data/

## incident_llm_class.pilot.parquet

Pilot: 300 hendelser klassifisert av Claude Haiku 5.5 (lest gjennom av underagenter, ikke via API-et) etter
instruksjonene og skjemaet i `scripts/classify_llm.py`. Utvalget er stratifisert (minst ca. 20 per politikategori,
pluss hendelser nøkkelordene har satt som vold utenfor «Voldshendelse» og noen øvelser), så tallene er **ikke**
representative for hele loggen.

Én rad per hendelse (`thread_id`):

| Kolonne | Innhold |
| --- | --- |
| `thread_id`, `input_hash` | Nøkkel og sha256 av teksten som ble klassifisert (for å oppdage endringer) |
| `classifier_version`, `model`, `classified_at` | Hvem som klassifiserte, og når |
| `primary_type`, `subtypes` | Hovedtype og undertyper (samme koder som `dim_taxonomy`) |
| `is_exercise` | Øvelse/drill, ikke en faktisk hendelse |
| `weapon`, `injury`, `severity` | Våpen, skade og alvorlighetsgrad |
| `outcome`, `persons` | Utfall (pågrepet, anmeldt …) og personer (kjønn, aldersgruppe) |
| `status`, `sentiment`, `confidence` | Pågår/avsluttet, tone, modellens sikkerhet |

Full kjøring: se `scripts/classify_llm.py` (skriver `data/incident_llm_class.parquet`).
Kilde: Politiet, www.politiet.no/politiloggen (NLOD 2.0).
