# data/

## incident_llm_class.parquet

Alle 140 193 hendelser i Politiloggen (12. mai 2023 – 24. okt. 2026) klassifisert én gang med Claude Haiku 5.5
(`claude-haiku-5-5`, Message Batches API, strukturert JSON-utdata). Prompt og skjema står i `scripts/classify_llm.py`.
Én rad per hendelse (`thread_id`). Klassifiseringen bygger bare på teksten i meldingene.

| Kolonne | Innhold |
| --- | --- |
| `thread_id`, `input_hash` | Nøkkel og sha256 av teksten som ble klassifisert (for å oppdage endringer) |
| `classifier_version`, `model`, `classified_at` | Hvem som klassifiserte, og når |
| `primary_type`, `subtypes` | Hovedtype og undertyper (samme koder som `dim_taxonomy`, f.eks. `vold.kniv`) |
| `is_exercise` | Øvelse/drill, ikke en faktisk hendelse (596 hendelser) |
| `weapon`, `injury`, `severity` | Våpen, skade (ingen/lettere/alvorlig/dødsfall/ukjent) og alvorlighetsgrad (lav/middels/høy) |
| `outcome`, `persons` | Utfall (pågrepet, anmeldt …) og personer med oppgitt kjønn/alder |
| `status`, `sentiment`, `confidence` | Pågår/avsluttet, tone (negativ/nøytral/positiv), modellens egen sikkerhet |

Merk: det finnes ingen fasit. Verdiene er modellens vurdering, ikke politiets. `confidence` er modellens egen
angivelse og ikke en målt treffsikkerhet. Oppdater med `scripts/classify_llm.py` (bare nye og endrede hendelser,
sammenlignet på `input_hash`).

Kilde: Politiet, www.politiet.no/politiloggen (NLOD 2.0).
