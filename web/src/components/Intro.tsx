/** Kort forklaring øverst, med «Slik leser du tallene». */
export function Intro() {
  return (
    <div className="intro">
      <p>Hendelser fra politiets operasjonssentraler, sortert i egne kategorier og plassert på kart. Velg område, type hendelse og periode – alle visninger følger valget.</p>
      <details>
        <summary>Slik leser du tallene</summary>
        <dl className="glossary">
          <dt>Hendelse</dt><dd>Én sak i Politiloggen. En hendelse kan ha flere meldinger (oppdateringer). Tallene her teller hendelser.</dd>
          <dt>Type og undertype</dt><dd>Vår egen inndeling, laget av en språkmodell (Claude Haiku) som har lest teksten i hver hendelse. Politiets egen kategori kan være en annen: et slagsmål kan stå som «Ro og orden» hos politiet, men telles som vold her. Én hendelse kan få flere undertyper, f.eks. ran med kniv.</dd>
          <dt>Område og sted</dt><dd>Stedet politiet oppgir, vasket og koblet til bydel (Oslo og Bergen) og kart. Veier og hendelser uten sted vises ikke på kartet.</dd>
          <dt>Alvorlighet, skade og tone</dt><dd>Språkmodellens vurdering av hver hendelse ut fra teksten: lav, middels eller høy alvorlighet, skade på personer, og om teksten er negativ, nøytral eller positiv. Politiloggen er saklig skrevet, så de fleste hendelser er nøytrale.</dd>
          <dt>Endring mot året før</dt><dd>Samme periode ett år tidligere. Endringer i hva politiet velger å publisere påvirker tallene.</dd>
          <dt>Viktig</dt><dd>Politiloggen viser det operasjonssentralene publiserer. Det er ikke kriminalstatistikk, og distrikter publiserer ulikt mye.</dd>
        </dl>
      </details>
    </div>
  );
}
