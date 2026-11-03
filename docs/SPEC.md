# Network Manager – dokumentasjonsstatus: spesifikasjon

Dette er kravgrunnlaget for appen. UI-tekst skal være norsk bokmål. Kode, filnavn og identifikatorer kan være engelske.

## Formål

Nettverksavdelingen (prosjektledere og teknikere) trenger én oversikt over om dokumentasjonen er ok per lokasjon og per kunde som helhet, vist som trafikklys. Appen er en prototype av en utvidelse av Network Manager. Bygg den slik at komponenter og datamodell kan flyttes inn i Network Manager senere.

## Kilder

- Publish: «Nettverksoppsett | Standard Dokumentasjonskrav» (bindende standard, fasit)
- LAN-ansvarlig-sjekklisten
- SAT-malen (Site Acceptance Test, tidligere i Loop)
- `docs/checklist.seed.json`: samlet katalog med 40 sjekkpunkter (LOK, KUN, SAT) med nivå, fase, betingelse, ansvarlig, QA, kilde og verifiseringstype. Dette er fasit for innholdet og skal brukes som seed-data.
- `docs/skisser/*.dc.html`: tre skjermskisser. Filene er designkilde (markup og CSS), ikke noe som skal kjøres. Les dem for layout, komponenter, farger og tekst. Eventuelle PNG-eksporter i samme mappe er det beste visuelle referansepunktet.

## Domenemodell

- **Kunde** → **Lokasjon**. Prosjekt-nivå er ikke med i v1. Pre GO-LIVE-punktene ligger på kundenivå (KUN-05, KUN-06, KUN-07).
- **Sjekkpunkt (katalog):** id, level (location | customer), phase, title, condition, responsible, qa, source, verification.
- **Punktstatus (per lokasjon eller kunde):** punkt-id, status, resultat (fritekst eller typet verdi), ansvarlig, utført av og når, QA-godkjent av og når, kommentar, frist.
- **Testprofil (per lokasjon):** boolske felt som styrer betingelser: `has_xwlan`, `has_dot1x`, `has_print`, `has_av`, `has_backup_line`, `wan_mbps`, `uses_meraki`, `is_shared_location`, `has_non_standard_equipment`. Skal på sikt utledes fra inventar, nett og WAN-data. I v1 settes de manuelt med mulighet for overstyring.
- **Implementasjonsmatrise (per kunde):** ti typer (se seed-filen), hver med status: ikke aktuell, mangler, delvis eller dokumentert.
- **Oppfølgingspunkt:** punkt, ansvarlig, frist, kommentar. Samme liste som «utestående punkter» (LOK-17).
- **Fase per lokasjon:** Planlagt → Under utrulling → Operativ støtteperiode → Handover godkjent → Drift.

## Statusregler

Fem statuser: **åpen** (ikke vurdert ennå, vises som stiplet ring), **grønn** (ok), **gul** (delvis, eller restpunkt med navngitt ansvarlig, frist og plan), **rød** (mangler eller fail), **grå** (ikke aktuell).

- Farge skal aldri være eneste bærer av informasjon. Vis alltid tekstetikett i pillen.
- Et punkt med betingelse som ikke er oppfylt i testprofilen blir grått automatisk.
- Punkter med QA-rolle følger flyten: åpen → utført (ansvarlig) → venter QA → grønn. QA kan avvise med påkrevd kommentar. Punkter uten QA-rolle går rett fra utført til grønn. Lagre hvem som signerte og når.
- **Lokasjon, Dok-lys:** dårligste farge blant HAP-punktene (alt som ikke er `sat`), der grå ignoreres og åpen ikke teller som rød.
- **Lokasjon, Test-lys:** samme regel for SAT-punktene. SAT-bandbredde (SAT-05) vurderes automatisk mot bestilt hastighet med toleranse (foreslå 10 %, gjør det konfigurerbart).
- **Kunde:** eget lys for kundenivå-punktene, pluss «andel lokasjoner grønne» (for eksempel 5 av 14) og en segmentert fargebar. Ikke bruk bare «dårligste farge» for kunden.
- **Handover blokkert:** en lokasjon blokkerer handover når den har minst ett rødt punkt, eller har åpne punkter uten ansvarlig og frist. KUN-07 (HAP godkjent) kan bare settes når alle andre krav er grønne eller gule med plan.
- Fase påvirker tolkningen: rødt under utrulling er forventet, rødt ved handover er en blokkering.

## Skjermer (se skissene)

1. **Lokasjonsside** (`1-lokasjonsside`): eksisterende Network Manager-widgets (General Information, Images, Floor Plans, WAN Circuits, Network Assets, Workplace Assets, SSID, Networks, Service Cards, Tickets, Processes) utvidet med en statuslinje nederst i hver widget, og med en ny widget «Dokumentasjonsstatus» øverst. Dok- og Test-lys vises i topplinjen. Filter: Alle, Mine punkter, QA-kø.
2. **Kundeoversikt** (`2-kundeoversikt`): aggregerte lys, kundenivå-punkter (KUN), implementasjonsmatrise og lokasjonstabell med fase, Test, Dok og handover-status. Filter: Alle, Røde, Venter QA, Blokkerer handover, Mine lokasjoner.
3. **Detalj: SAT og signoff** (`3-detalj-sat-signoff`): testprofil, testpunkter med typede resultatfelt, signoff-flyt, oppfølgingspunkter.

Skissene bruker anonymisert eksempeldata (Eksempel Kunde AS). Seed-data skal også være anonymisert.

## Roller

tekniker, pm, wan_ansvarlig, tech_lead, olm_pm, prosjektteam. «Mine punkter» viser punkter der innlogget bruker er ansvarlig. «QA-kø» viser punkter som venter på QA fra innlogget bruker.

## Integrasjoner (senere)

I v1 er alle punkter manuelle eller seedet. Definer likevel et `CheckProvider`-grensesnitt per kilde (monitoring/Orion/DNAC, Netbox, CMDB, ROT, NPC, Company Service, Publish), med mock-implementasjoner, slik at punkter merket `auto` i seed-filen kan kobles til ekte data uten å endre UI eller statuslogikk. Ingen ekte kilder skal kalles i v1.

## Ikke i scope for v1

Prosjekt-nivå, eksport til PDF, varsler, ekte integrasjoner, redigering av katalogen i UI.

## Åpne spørsmål (ikke implementer, bare gjør det enkelt å endre)

1. IMP og alarmrutine (LAN-listen) mot IMP og kontaktinformasjon (Publish) for LOK-11: hva er riktig?
2. Service cards (LOK-09) og billing card (LOK-10) i NPC: ett punkt eller to?
3. Skal ROT erstattes av Netbox for bilder og lokale kontaktpersoner?
4. Terskel for «større prosjekter» (informasjonsmøte og allmøte): artikkelen sier «> 8 lokasjoner?».
5. Skal handover-godkjenning låses i systemet, eller være rådgivende?
6. Hva skal gjøres med at Orion og Monitoring/DNAC brukes om hverandre?
