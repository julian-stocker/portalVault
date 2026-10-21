# `supabase/checks/` — Prüf-SQL rund um eine Migration

Lesende SQL-Dateien, die eine Migration **umrahmen**: Preflight vor der
Anwendung, Postflight danach, Baselines für Vorher/Nachher-Vergleiche,
Diagnosen und Testpläne. Sie werden **von Hand im Supabase-SQL-Editor
ausgeführt**, nie automatisch, und sind kein Teil des Migrationsablaufs.

## Abgrenzung zu `supabase/tests/`

| Ordner | Was dort liegt |
|---|---|
| `supabase/migrations/` | der Schemazustand — wird angewendet |
| `supabase/tests/` | Laufzeitverifikation von Verhalten (`0015_runtime_verification.sql` …) |
| `supabase/checks/` | Katalog- und Rechteprüfungen **um** eine Migration, plus Baselines |

## Regeln für Dateien in diesem Ordner

1. **Nur lesend.** Kein `insert`, `update`, `delete`, DDL, `grant`/`revoke`.
   Einzige erlaubte Ausnahme: transaktionslokales `set_config(..., true)` für
   eine Claim-Simulation, immer in `begin; … rollback;`.
2. **Kein `set role`** ohne ausdrückliche Freigabe. `0125_function_test.sql`
   braucht es und ist deshalb **nicht freigegeben**; der Kopf der Datei sagt
   das.
3. **Keine absichtlichen SQL-Fehler als Statusmeldung.** Ein konstanter Cast
   wie `'ABBRUCH'::int` wird von PostgreSQL **beim Planen** ausgewertet und
   feuert dann immer — auch in einem `CASE`-Zweig, der nie genommen wird
   (Handbuch, „Conditional Expressions"). Status gehört in eine Textspalte.
4. **Keine internen Zahlen im Quelltext.** Keine Lager-, Order- oder
   Einkaufszahlen aus Staging oder Production in Kommentaren — `CLAUDE.md`,
   Regel 3. Erwartungswerte gehören in den Prüfbericht, nicht in die Datei.
5. **Keine personenbezogenen Daten.** Keine Namen, Anschriften, E-Mail-Adressen,
   Benutzer-UUIDs — auch nicht gekürzt, auch nicht gehasht. Belegnummern aus
   Staging sind zulässig, wenn sie **als Staging-Testreferenz gekennzeichnet**
   sind.
6. **Dateinamen englisch**, Muster `NNNN_<zweck>.sql` mit der Migrationsnummer
   vorn (`CLAUDE.md`, Regel 5).
7. **Eine Anweisung je Prüfdatei**, wo es geht: ein `select`, das eine Tabelle
   mit `nr · bereich · pruefung · befund · erwartet · ok` liefert und als
   letzte Zeile `9999` mit der Zahl blockierender Abweichungen. `9999 = 0`
   heißt bestanden.

## Was hier liegt

| Datei | Zweck |
|---|---|
| `0124_preflight.sql` | Eingangszustand vor `0124`; setzt `0125` voraus |
| `0124_baseline.sql` | Ledger-Ausgabe über alle Filter, als Hash — sechs Läufe |
| `0124_baseline_guard.sql` | Diagnose, wenn die Baseline nicht `OK` sagt |
| `0124_rollback_check.sql` | nach einem abgebrochenen `0124`-Versuch: ist der Zustand von vorher wieder da? |
| `0124_postflight.sql` | Zielzustand nach `0124` |
| `0124_fingerprint_failure_isolated.sql` | **nur Wegwerf-Instanz**: erzwungener Fingerabdruck-Fehler |
| `0124_test_matrix.md` | Browser- und Datenfälle D1–D10, B1–B8, A1–A7, R1–R7 |
| `0125_preflight.sql` | Rechtezustand vor `0125`; lässt beide Normallagen zu |
| `0125_postflight.sql` | Zielzustand nach `0125`, streng |
| `0125_function_test.sql` | Eigentümerkette unter der Rolle `authenticated` — **nicht freigegeben** |
| `0125_test_plan.md` | Stufen S1–S7, V1–V5, N1–N4, F0–F2, U1–U3 |
| `0126_preflight.sql` | Eingangszustand vor `0126`; prüft die drei gerufenen Funktionen samt Schutzregeln |
| `0126_postflight.sql` | Trigger, Speicherfunktion, Rechte und unveränderter Bestand nach `0126` |
| `0127_preflight.sql` | Eingangszustand vor `0127`; Abhängigkeiten der Funktion, heutiger ACL, Zustandsbefund |
| `0127_postflight.sql` | eine Fassung mit sechs Parametern, wiederhergestellte Rechte, unveränderter Bestand nach `0127` |
| `0127_signature_diagnosis.sql` | nach dem Abbruch von `0127`: tatsächliche Signatur, Rückrollzustand, und der Ganzarray-Vergleich nachgestellt |
| `0127_swap_effect_check.sql` | nach einem unklaren Speichern: ist der Figurenwechsel in der Datenbank angekommen, und weicht ein Beleg jetzt ab? |
| `0128_preflight.sql` | Eingangszustand vor `0128`; Kettenstruktur aus `0122`, Eigentümerkette, Zustandsbefund |
| `0128_postflight.sql` | zwei Spalten, zwei Funktionen, Rumpf und unberührte Belege nach `0128` |
| `0128_test_plan.md` | die Schreibfälle K1–K10, darunter Nebenläufigkeit in zwei Fenstern |
| `0129_preflight.sql` | Eingangszustand vor `0129`; alle 38 Spalten, die der Export nennen wird |
| `0129_postflight.sql` | 28 Bereiche, Kette im Export, keine Kontoidentität, nichts geschrieben |
| `0129_restore_test.md` | Wiederherstellung mit drei Belegrevisionen — **Handprüfung auf isolierter Testdatenbank** |
| `0129_export_baseline.sql` | die Gegenzahl zum heruntergeladenen Backup: Zeilenzahl je Bereich, Belegkette, Prüfsummen, Lückenzählung |
| `0130_backup_extension_proposal.md` | der Vorschlag zu den 57 unentschiedenen Spalten — A1/A3/B umgesetzt, **A2 nicht freigegeben** |
| `0130_preflight.sql` | Eingangszustand vor `0130`; die 18 Spalten müssen existieren, die 9 privaten dürfen nicht im Export sein |
| `0130_postflight.sql` | die 18 Feldzeilen, die 9 privaten weiter draußen, Form und Vertrag unverändert |
| `0131_preflight.sql` | Eingangszustand vor `0131`; die 13 Rechtsangaben, genau eine aktive Verkäuferzeile |
| `0131_postflight.sql` | die 13 Feldzeilen, Bereich `seller` ohne Zeitstempel, frühere Ergänzungen intakt |
| `0131_state_diagnosis.sql` | nach dem Abbruch von `0131`: Stand `0130` oder teilweise `0131`, die 13 erwarteten gegen die erkannten `seller`-Schlüssel — **ohne Verkäuferwerte** |
| `0130_staging_order.md` | die Ausführungsreihenfolge für `0130`/`0131`: Preflight, Migration, Postflight, Download, Verifikation |
| `0130_export_keys_diagnosis.sql` | welche JSON-Schlüssel wirklich in welchem Bereich stehen — mit Selbsttest des Bereichsparsers |
| `0130_amendment.md` | **Nachtrag**: `0130` wurde nach der Ausführung geändert — Umfang, Beweis, Rezept für die ausgeführte Fassung. `0130` wird nicht erneut angewendet |
| `backup_architecture_two_tier.md` | die zweistufige Backup-Architektur: Geschäftsbackup und geschütztes Notfall-Backup, Abhängigkeitsmatrix, Implementierungsplan |
| `0131_function_body_check.sql` | der Anker gegen den Zirkel: `md5(prosrc)` der lebenden `seller_business_backup()` gegen die Fassung im Repository — rein lesend |
| `0131_restore_plan.md` | der Plan für den isolierten Wiederherstellungstest: Reihenfolge, Trigger, Identitäten, Lücken, Verifikation — **nichts davon ausführen** |
| `dr/*.sql` | die sechs rein lesenden Abfragen des Wiederherstellungstests — laufen unverändert auf Quelle und Ziel, verglichen wird hinterher |
| `disaster_recovery_pg_dump.md` | Plan für die logische Gesamtsicherung mit `pg_dump` und den isolierten Restore-Test — Werkzeuge, Verbindung, Lücken, Prüfungen, Abbruchkriterien |
| `production_inventory.md` | rein lesende Bestandsaufnahme des Production-Migrationsstands und der Supabase-Backuplage |
| `backup_evidence_check.sql` | sind die beiden Production-Sicherungen wirklich entstanden? Historie der Plattformsicherung, Gegenzahlen für das Business-Backup — ohne personenbezogene Daten |
| `receipt_lock_check.sql` | hält die Sperre der Belegausstellung? Jede API-Rolle einzeln, PUBLIC über den ACL — rein lesend |
| `release_0126_0131.md` | **die geltende Freigabeprüfung** für den Production-Rollout: gemessene Wirkung je Migration, Reihenfolge, Rücknahmefenster, Backuplücken, zwei getrennte Freigaben |
| `production_rollout_0126_0131.md` | die Bereitschaftsprüfung für Production: Messung zuerst, Backuplage, Reihenfolge, Abbruchkriterien, Rücknahme je Migration |
| `0132_preflight.sql` | Eingangszustand vor `0132`; die Fassung aus `0064`, und die Annahme: jede importierte Zeile trägt mindestens ein Herkunftsmerkmal und immer eine `source_row`. **Am 2026-10-18 berichtigt** — die Prüfungen 202 und 303 verlangten `reconciled_legacy` je Zeile und `quantity = sum(delta)`; beides war falsch (ADR-0127). Die Fassung hier ist nicht die gelaufene, ihr Kopf sagt das |
| `0132_postflight.sql` | die Herkunftsbedingung ist weg, die vier Zeilenbedingungen stehen, Bestand und Rechte unverändert |
| `0132_diagnose_production.sql` | rein lesende Diagnose der beiden Abweichungen aus dem **Production**-Lauf vom 2026-10-18: die 109 Zeilen aus `0067` samt ihrem Schutz, und der Eröffnungsbestand aus dem Cutover vom 2026-09-21. Beginnt mit einem Umgebungsstempel |
| `0133_production_readonly.sql` | lesende Nachprüfung zu `0133` auf Production: Form und Zustand des Triggers, und ob eine der sieben Funktionen, die `purchases` schreiben, die bezahlte Summe anfasst |
| `0132_staging_plan.md` | der Plan, Staging nachzuziehen — `0132`, der Schreibnachweis H1–H12, dann `0133`. Nichts davon ausgeführt |
| `state_audit_readonly.sql` | **für beide Projekte**: welche Migrationen sind in dieser Datenbank wirklich angewendet? Vergleicht `md5(prosrc)` jeder von `0126`–`0134` berührten Funktion gegen die Abdrücke aller bekannten Fassungen und nennt die Migrationsnummer. Dazu Trigger, Belegsperre, Lagerbild, Katalog und Zubehör |
| `open_verifications.md` | die Nachweise, die **fehlen** — Gegenstück zu `APPLIED.md`. Production P1–P7, Staging S1–S6, was gar keinen Nachweis hat, und in Abschnitt 0 die am 2026-10-18 bestätigten Production-Ergebnisse |
| `fixture_audit_readonly.sql` | die Testfigur auf Production: Identität, Serie, Anlagedatum und **jede** Verknüpfung (Lager, Bewegungen, Bestellungen, Reservierungen, Warenkorb, Sammlung, Ein- und Verkauf, Zuordnungen) — und drei blockierende Zeilen zur Außenwirkung |
## Vier Stufen der Prüfung — und was jede beweist

Am 2026-10-18 sind vier Prüfdateien im Production-Editor abgebrochen, nachdem
sie als „geprüft" gemeldet worden waren. Daraus folgt eine Unterscheidung, die
in jedem Bericht stehen muss:

| Stufe | Werkzeug | findet | findet NICHT |
|---|---|---|---|
| **Syntax** | `pglast` (libpg_query) | Syntaxfehler, Anweisungstypen | jeden Namens- und Typfehler — beide Abbrüche vom 2026-10-18 waren syntaktisch einwandfrei |
| **Statische Referenzprüfung** | `src/lib/admin/check-sql-references.test.ts`, `check-sql-hazards.test.ts` | erfundene Tabellen und Funktionen · Spalten hinter eindeutig gebundenen Aliassen · **nirgends gebundene Aliasse (42P01)** · **ungecastete Katalogspalten an einer Verkettung (42725)** | einen Alias, der in der falschen Unterabfrage steht · Spalten ohne eindeutige Aliasbindung |
| **Planprüfung** | `npm run verify:check-sql`, Stufe 2 — echtes PostgreSQL (PGlite) mit Stub-Schema aus den Migrationen | **alles davon**, plus jeden Typkonflikt und jede Signatur, über alle Geltungsbereiche | Laufzeitfehler an echten Daten · ob die Prüfung fachlich das Richtige misst · **Versionsunterschiede**: PGlite fährt 18.6, der Syntaxprüfer die Grammatik von 15, und Production ist hier nicht festgehalten |
| **Definitionslauf** | `npm run verify:check-sql`, Stufe 3 — jeder gefaltete Funktionsrumpf wird in PostgreSQL **erzeugt** | bei `language sql` jede Spalte, jeden Typ und jede Signatur IM RUMPF (`42703`, `42883`, `42P01`) — dort, wo die Planprüfung nicht hinsieht | bei `language plpgsql` nur die Syntax: Namen darin sieht erst der Aufruf · ob die Funktion das Richtige TUT |
| **Probelauf** | `npm run verify:check-sql`, Stufe 4 — die noch nicht angewendeten Migrationen gegen **erfundene** Zeilen, mit Gegenproben | dass eine Migration in EINER Transaktion durchläuft, ohne Klammer abbricht, bei verändertem Zustand abbricht und nach einem Abbruch nichts zurücklässt; dass Rücknahmen nur in ihrer Reihenfolge gehen | alles Mengenmäßige: die Zeilen sind erfunden und sagen über die echten Bestände nichts |

**Keine dieser Stufen ist „erfolgreich ausgeführt".** Das ist erst der Lauf im
SQL-Editor, und nur er zählt als Nachweis.

**Verbindliche Reihenfolge, seit dem 2026-10-18:**

1. `npm run verify:check-sql` — **vor jedem** Lauf im SQL-Editor, und bei
   jeder Änderung an einer Datei unter `supabase/checks/`. Stufe 3 läuft
   außerdem in `npm run check` mit.
2. Erst danach die Datei in den SQL-Editor, mit der Projektkennung im
   Protokoll.
3. Ergebnis nach `open_verifications.md`.

`@electric-sql/pglite` ist seit dem 2026-10-18 eine feste `devDependency`.
Fehlt sie, **schlägt die Prüfung fehl** — sie überspringt sich nicht mehr
still. **Eine** Datei lässt sich begründet nicht planen und **ein**
Funktionsrumpf nicht erzeugen (`system_auth_inventory()` liest `auth.users`,
eine Tabelle, die keine Migration beschreibt); beide stehen mit ihrem Grund in
`NICHT_PLANBAR` bzw. `NICHT_ERZEUGBAR` in `tools/validate-check-sql.mts`, und
wenn eine von ihnen eines Tages doch durchgeht, bricht der Lauf ab und
verlangt das Kürzen der Liste.

### Drei Löcher, die der Definitionslauf aufgedeckt hat (2026-10-19)

Der Definitionslauf war nicht als Prüfung des Prüfwerkzeugs gedacht und ist es
geworden. Alle drei gingen in die **falsche** Richtung — stiller Erfolg statt
Fehlalarm:

* **Der Kopfkommentar blieb am Statement hängen.** Das Abschneiden verlangte,
  dass Kommentarzeilen aneinanderstoßen; eine Leerzeile im Kopf — in diesen
  Dateien die Regel — ließ den Rest stehen. Folge: die Anweisung wurde nicht
  als planbar **erkannt**, nie geplant, und die Datei meldete „OK".
  `0125_function_test.sql` hatte sein erstes SELECT nie geplant bekommen.
* **Der Stub-Schema-Generator folgte keiner Tabellenumbenennung.** `0026`
  benennt `business_settings` in `platform_settings` um — einmal in der ganzen
  Historie. Im Stub lebten danach beide: `platform_settings` mit nur den
  danach ergänzten Spalten, `business_settings` als Geisttabelle. Eine
  Prüfdatei auf `platform_settings.contact_email` hätte falschen Alarm
  gegeben, eine auf `business_settings` falschen Erfolg.
* **Temporärtabellen landeten im Stub-Schema.** `0135` legt ihren Abdruck in
  einer Temporärtabelle ab; ohne Schema-Angabe sah der Generator eine Tabelle
  in `public`. Eine Prüfdatei, die sie außerhalb ihrer Sitzung abfragt, hätte
  grün geplant.

Dazu kennt der Generator jetzt `create sequence` und `drop table`. Gefunden
wurden alle drei, weil eine neue Stufe dieselben Dateien mit **anderen Augen**
las — nicht durch genaueres Hinsehen auf dieselbe Weise.

## Zwei Dateien schreiben — niemals auf Production

| Datei | was sie tut |
|---|---|
| `0124_fingerprint_failure_isolated.sql` | legt eine Temporärtabelle und eine Funktion an, schreibt eine Zeile, rollt zurück — Fehlerfalltest, **nur Staging** |
| `0125_function_test.sql` | Funktionstest mit garantiertem Rollback, setzt Sitzungsparameter — **nur Staging** |

Alle übrigen Dateien unter `supabase/checks/` sind reine SELECTs.

| `Z0_catalog_accessories_readonly.sql` | **Bestandsaufnahme vor der Portal- und Spielintegration** (ADR-0128): die `display_name_override` der 39 Spiele im Wortlaut, der Nachweis dass `SKY-0615`–`SKY-0642` frei sind, Serien und Kategorien, Slug-Kollisionen, der Fortschritts-Nenner von heute, und der **Abdruck der Shop-Eignung** (Zeile 601–603), gegen den später bewiesen wird, dass kein Angebot sich geändert hat |
| `0135_preflight.sql` | Eingangszustand vor `0135`: `item_type` fehlt noch, die Kategorie `Spiele` steht, und die sechs Abdrücke (shopfähig, Angebote, Angebotsliste, Nenner, Nenner je Serie, Overrides). Trägt den **Z0-Vertrag** (Zeilen 901–915) |
| `0135_postflight.sql` | derselbe Satz Zeilen mit umgekehrten Erwartungen an den Zustand und **unveränderten** an alles andere — plus den Z0-Vertrag |
| `0136_preflight.sql` | Eingangszustand vor `0136`: die Sicherung ist der Stand `0131` (Abdruck, Länge, Kommentar, 28/352, Bereich `figures` mit neun Feldern), `0135` steht, Rechte und Ausschlüsse intakt |
| `0136_postflight.sql` | gegenläufig: Stand `0136`, 28/353, `figures` mit zehn Feldern, `item_type` direkt nach `card_type` — Rechte, Formatvertrag und die neun privaten Felder unverändert |
| `staging_pending_migrations.sql` | **nur Staging**: `0132` steht, `0133` und `0134` stehen **nicht** (Funktion, Trigger, Abdruck von `seller_purchase`), dazu ein Umgebungsstempel, der den Lauf im falschen Projekt abfängt |
| `0135_0136_staging_run.md` | **der Laufzettel** für die manuelle Ausführung von `0135`/`0136` auf Staging: Dateinamen, Reihenfolge S0–S11, Transaktionsrahmen, der Z0-Vertrag, Erwartungen und Abbruchkriterien je Schritt, Umgang mit `25P02`, Rücknahme in der Reihenfolge `R0136`→`R0135` |
| `staging-suite.json` | **die eine Quelle**, welche Prüfdateien `npm run db:check:staging` fährt, in welchem Modus, mit welchem Vertrag und unter welcher lesenden Vorbedingung. Daraus leitet `tools/lib/grant-plan.py` auch die Rechteliste des Prüfzugangs ab |
| `staging_agent_access_plan.md` | der Plan für den automatisierten Staging-Zugang in drei Phasen: lesende Prüfungen, Schreibtests über die bestehenden APIs, Migrationen über einen gesondert abgesicherten Weg |
| `staging_agent_role_diagnosis.sql` | **nur Staging, rein lesend**: der Abbruch von `staging-agent-setup.sql` vom 2026-10-19 — Rollenmitgliedschaften **in beiden Richtungen** mit allen Optionen, wie weit das Setup gekommen ist (Stempel, Grants, Policies), und ob die Belegsperre unverändert dicht ist. Zeile 9999 zählt nur die Sicherheitsfragen: ein vollständiges Zurückrollen ist ein gültiger Ausgang |
| `z0_overrides_diagnosis.sql` | **rein lesend**: warum der Z0-Vertrag „53 statt 39 Overrides" meldete. Unterscheidet über das Änderungsprotokoll aus `0004` zwischen falschem Sollwert (Z0 zählte die 39 **Spiele**) und echter Datenänderung. Blockierend sind nur die Zeilen, die eine Änderung bedeuten würden |
| `accessory_audit_readonly.sql` | Bestandsaufnahme für die Zubehörplanung: die 206 Einkaufspositionen ohne `sky_id` nach Zustand, Herkunft und Rohnamen, und was an den Spiele-Katalogzeilen operativ hängt |
| `0132_test_plan.md` | die Schreibfälle H1–H12 zu `0132`, über die Oberfläche gegen Staging — was die lesenden Prüfdateien nicht zeigen können. **Noch nicht durchgeführt:** `0132` ist auf Staging nicht angewendet, und auf Production werden keine Testzeilen angelegt |
| `0133_preflight.sql` | Eingangszustand vor `0133`; Grundlage aus `0115`/`0132`, Trigger fehlt noch |
| `0133_postflight.sql` | der Trigger steht, hat die Form BEFORE UPDATE FOR EACH ROW, hält drei Felder und kein viertes |
| `0132_platform_export_receipts_proposal.md` | **Vorschlag, nicht umgesetzt**: die Eigenbelege im Plattformarchiv |
| `inventory_accessories_readonly.sql` | **nur Staging, rein lesend**: was die Lagerübersicht nach der Zubehörerweiterung zeigt — Zeilen und Stück je Artikeltyp, welche davon einen Namen bekommen, und dass keine Zubehörzeile shopfähig, angeboten oder sammelbar ist. **Nicht in der Suite** (ruft `is_shop_eligible()`), gehört in den SQL-Editor |
| `accessory_assignment_readonly.sql` | **rein lesend**: die 206 Einkaufspositionen ohne `sky_id` gegen die 21 Portalartikel, auf **Zeichengleichheit**, nie auf Ähnlichkeit. Grundlage des Zuordnungsvorschlags |
| `accessory_assignment_proposal.md` | **Vorschlag, ausgeführt am 2026-10-20**: die 35 zeichengleichen Einkaufspositionen auf 11 Portalartikel, als ausgeschriebene Paare statt als Regel |
| `portal_assignment_run.md` | **der Laufzettel** zur Zuordnung der 35 Positionen, mit Vorher/Nachher-Raster, Abdruck über 15 Spalten und Rücknahme. **Ausgeführt am 2026-10-20** |
| `portal_release_run.md` | **der Laufzettel** zur öffentlichen Freigabe der 21 Portale, mit dem Abdruck über die Sichtbarkeit **jeder anderen** Zeile als Beweis der Zielgenauigkeit. **Ausgeführt am 2026-10-20** |
| `accessory_offer_readonly.sql` | **nur Staging, rein lesend**: was eine Lockerung von `is_shop_eligible()` **sofort** veröffentlichen würde. Bildet die vier Bedingungen von `shop_offers()` nach und ersetzt nur die Katalogeignung durch die hypothetische Regel. Zeile 305 ist die Zahl, auf die es ankommt. **Nicht in der Suite**, gehört in den SQL-Editor. Noch nicht gefahren |
| `accessory_offer_proposal.md` | **Bestandsaufnahme und Umsetzungsvorschlag** zu ADR-0129: die Angebotsarchitektur hat **ein** Tor, das jede Tür fragt, `create_order()` eingeschlossen; der Warenkorb ist bereits typneutral; die 13 gelisteten Spielezeilen tragen **zwingend einen Preis** (`0003`). Deshalb hängt die Freigabe an der **Lagerposition**. Teil D nennt die vier Fragen, die vor der ersten Freigabe zu entscheiden sind — USK-Quelle, Lieferumfang, Steuer, was „lose" bei einem Spiel heißt |
| `0139_preflight.sql` | **nur Staging, rein lesend**: Eingangszustand vor `0139` — die acht vorausgesetzten Funktionen, `item_type`, die zwei neuen Spalten fehlen noch, **die Altlast ausdrücklich gezählt** (welche Zubehörpositionen `is_listed` und bepreist sind), und die Abdrücke |
| `0139_postflight.sql` | **nur Staging, rein lesend**: der Zustand danach. Die eine Aussage, die zählt — **es ist nichts kaufbar geworden**: 0 freigegebene Positionen, 0 USK-Angaben, 0 Zubehörangebote, und jede Lagerposition antwortet am neuen Tor genau wie am alten |
| `../operations/staging-s1-preflight-0139.sql`, `…-s1a-accessory-offer.sql`, `…-s3-postflight-0139.sql` | **rueckfragenfrei ausfuehrbar**: Klammer, Z0-Vertrag und `rollback` schon darin, die Pruefdatei zeichengleich eingebettet. Entstanden, nachdem der Lauf am 2026-10-20 ohne `set_config` ausgefuehrt wurde und Zeile 902 zu Recht „der Modus fehlt" meldete |
| `production_release_0135_0141.md` | **der Release-Plan** fuer Production: der gemessene Ausgangszustand beider Datenbanken, die Reihenfolge `0135`→`0136`→`0137`→**Deployment**→`0138`→`0141` samt Beleg fuer jede der drei Vertraeglichkeitsbehauptungen (gelesen aus `git show origin/main`), Backup und Wiederherstellung in drei getrennten Faellen, neun Stopp-Kriterien, und was offen bleibt. **Nichts davon ausgefuehrt** |
| `production_release_checklist.md` | **die Checkliste zum Abhaken**: welche Datei wann, welche Ausgabe erwartet wird, wann gestoppt wird, ab wann gepusht werden darf, und zwoelf Handgriffe zur Kontrolle danach |
| `0139_0140_staging_run.md` | **der Laufzettel** für `0139`/`0140` auf Staging: fünf Schritte S1–S5, welche Datei wann in den SQL-Editor gehört, die erwarteten `NOTICE`-Zeilen und Prüfzeilen, die Rücknahme in der Reihenfolge `R0140`→`R0139`. **Noch nicht ausgeführt** |
| `accessory_sale_ui_plan.md` | **Plan, nicht umgesetzt**: Lageroberfläche (Freigabeschalter, Lieferumfangsauswahl, der Satz „warum noch nicht"), Zubehörangebote im Katalog samt neuer Detailseite `/zubehoer/[slug]`, und der Nachweis, dass Warenkorb, Checkout, Bestellung, Storno und Erstattung **nichts** brauchen — sie sind typneutral. Mit der Reihenfolge: kein Anwendungscode vor der Anwendung von `0139` |

## Bereichserkennung: zeilenweise, niemals mit einem mehrzeiligen Regex

**PostgreSQL bestimmt die Gierigkeit für den ganzen Zweig, nicht je Quantor.**
Handbuch 9.7.3.5: ein Zweig hat die Gierigkeit des **ersten** quantifizierten
Atoms mit Vorliebe. In

```
regexp_matches(d, '\n {6}''([a-z_0-9]+)'', coalesce\(\((.*?)\n {6}\), …', 'g')
```

ist das `[a-z_0-9]+` — gierig. `(.*?)` verhält sich damit wie `(.*)`, der erste
Bereich verschluckt den ganzen Rumpf, und heraus kommt **ein** Bereich
`shop_inventory` mit **321** Schlüsseln statt 28 Bereichen. In Python und
JavaScript funktioniert dasselbe Muster — wer dort testet, testet die falsche
Engine.

Deshalb gilt in allen Prüfdateien und Migrationen:

```
zeile  as (select z.nr, z.txt from code c,
             regexp_split_to_table(c.d, E'\n') with ordinality as z(txt, nr)),
anfang as (select z.nr, (regexp_match(z.txt,
             '^ {6}''([a-z_0-9]+)'', coalesce\(\($'))[1] as name
             from zeile z where z.txt ~ '^ {6}''[a-z_0-9]+'', coalesce\(\($'),
feld   as (select (select a.name from anfang a
                    where a.nr < z.nr order by a.nr desc limit 1) as name, …)
```

Jede Zeile einzeln, verankert, kein Ausdruck über Zeilengrenzen. Und **jede
Datei beweist den Parser in der Engine, die sie ausführt**: sie trägt eine Probe
mit zwei Bereichen (`alpha` mit zwei Feldern, `beta` mit einem). Ein gieriger
Parser liefert dort einen Bereich mit drei Feldern; die Prüfung blockiert.

Dazu in jeder Datei **blockierend**: genau 28 Bereiche, jede Feldzeile genau
einem Bereich zugeordnet, kein Bereich ohne Feld. Eine Parserabweichung kann
damit nie als bestandener Pre- oder Postflight durchgehen. `backup-sql-areas.test.ts`
hält die Form und die exakten Feldzahlen je Stand fest (321 / 339 / 352).

## Eine Syntaxprüfung sieht keine Spalten

`pglast` parst — es löst keine Namen auf. Ein Verweis auf eine Spalte, die ein
CTE nicht mehr liefert, kommt damit durch jede Syntaxprüfung und bricht erst in
PostgreSQL ab:

```
ERROR: 42703: column b.block does not exist
```

Genau das passierte beim Umbau von der block- auf die zeilenweise
Bereichserkennung: `bereich` lieferte nur noch `name`, zwei Prüfungen in der
Diagnose und eine im `0130`-Postflight verwiesen weiter auf `b.block`.

Geprüft wird das jetzt zweifach:

* **`src/lib/admin/check-sql-references.test.ts`** erhebt je Datei die CTEs mit
  ihren Ausgabespalten und prüft jede Referenz `alias.spalte`. Negativ
  kontrolliert: `b.block` wieder eingebaut → Test fällt.
* **Mit dem echten PostgreSQL-Parser** über den Syntaxbaum (`CommonTableExpr`
  gegen `ColumnRef`) wurden alle Prüfdateien und die eingebetteten
  CTE-Abfragen beider Migrationen durchgesehen. Befund: 0.

Ein lokales PostgreSQL gibt es auf dieser Maschine nicht (kein `psql`, kein
`initdb`, kein Container-Laufzeitsystem). Eine echte Ausführung bliebe die
stärkste Prüfung — dafür bräuchte es eine isolierte Testdatenbank mit allen
Migrationen.

## Eine Lehre, die zweimal Geld gekostet hat

**Ein Feldname im Funktionsrumpf sagt nicht, in welchem BEREICH er steht.**
`0129` hat `purchase_receipts` in den Export genommen, und ein Eigenbeleg friert
den Ankauf ein — Absender, Inserat, Kaufvereinbarung und die Kostenaufteilung
stehen dort berechtigt. Wer `position('''sender_name''' in v_code)` schreibt,
findet den Belegsnapshot und meldet ihn als Treffer im Einkaufsbereich: so
schlug `0130_preflight` auf Staging mit 5 und 4 Fehlalarmen an, und so hätte die
Nachbedingung von `0130` die Migration abgebrochen.

Deshalb schneiden alle Feldprüfungen den Bereich aus, bevor sie suchen:

```
bereich as (
  select (m.g)[1] as name, (m.g)[2] as block
    from code c,
         regexp_matches(c.d,
           $re$\n {6}'([a-z_0-9]+)', coalesce\(\((.*?)\n {6}\), '\[\]'::jsonb$re$,
           'g') as m(g)
)
```

In POSIX-Regex passt `.` auch auf einen Zeilenumbruch, solange der Flag `n`
nicht gesetzt ist; verankert wird mit `\n {6}` statt mit `^`.
`manifest-gap.test.ts` hält fest, dass keine Prüfdatei und keine Migration ein
mehrdeutiges Feld rumpfweit sucht.

## Und eine dritte Lehre: ein Prüfeintrag muss den Bereich NENNEN

Weil Feldprüfungen seit der zweiten Lehre bereichsweise arbeiten, prüfen die
Nachbedingungen von `0130` und `0131` Paare der Form `Bereich|Feldzeile`:

```
foreach v_key in array array[
  'seller|''register_court'', t.register_court', …] loop
  if not (v_key = any (v_paare)) then …
```

Beim Umbau auf diese Form bekamen in `0131` nur der **erste** und der
**letzte** der 13 Einträge das Präfix `seller|`. Die elf dazwischen waren
nackte Feldzeilen, passten auf kein Paar — und `split_part(v_key, '|', 2)`
gibt für einen Wert ohne Trenner die leere Zeichenkette zurück. Heraus kam
eine Meldung ohne Feldnamen:

```
ERROR: P0001: 0131 Abbruch:  fehlt im Bereich seller
```

Die Prüfung war nicht zu streng, sondern falsch gestellt. Sie bleibt
blockierend. Dazu kamen zwei Dinge:

* **In beiden Migrationen** steht vor der Suche eine Formprüfung. Ein Eintrag
  ohne Bereich bricht jetzt mit eigener Meldung ab, statt eine Lücke zu
  behaupten, die er nicht belegen kann.
* **`src/lib/backup/backup-sql-areas.test.ts`** verlangt für jede Schleife, die
  mit `v_key = any (v_paare)` arbeitet, dass jeder Eintrag die Form hat, dass
  sein Bereich einer der 28 ist und dass er auf ein Paar passt, **das der
  Rumpf derselben Migration wirklich hergibt**. Negativ kontrolliert: ein
  `seller|` entfernt → vier Prüfungen fallen.

Wichtig an der Abgrenzung: die **anderen** `foreach v_key`-Schleifen derselben
Dateien suchen nackte Feldnamen mit `like`-Mustern oder Verbotsmarker mit
`position(v_key in v_code)`. Deren Einträge haben zu Recht kein `|`. Ein Test,
der dort eines verlangte, würde das Falsche prüfen — er zählt sie getrennt.

## Betriebliche Schalter liegen nicht hier

`supabase/operations/` enthält zwei Dateien, die Production **ändern** —
die Sperre der Belegausstellung und ihre Rücknahme. Sie sind keine
Migrationen und keine Prüfungen; `supabase/operations/README.md` erklärt sie.
Der zugehörige **lesende** Nachweis ist `receipt_lock_check.sql` in diesem
Ordner.

## Prüfsummen

Eine Liste für beide Ordner: **`supabase/SHA256SUMS.txt`** deckt jede
Migration **und** jede Prüfdatei ab. Die Pfade sind repository-relativ,
geprüft wird also vom Repository-Wurzelverzeichnis:

```
npm run verify:sums          # vollständig: fehlend, überzählig, abweichend
shasum -a 256 -c supabase/SHA256SUMS.txt    # dasselbe ohne Node
```

Nach einer **absichtlichen** Änderung: `npm run sums:write` — der Diff zeigt
dann, was sich geändert hat. `src/lib/admin/migration-integrity.test.ts`
rechnet die Liste bei jedem Testlauf nach, ein vergessenes `sums:write` fällt
also auf, statt zu verrotten.

Vor jeder Ausführung auf Staging oder Production gegenprüfen — ein Chatblock
oder eine Kopie aus einer Antwort ist nicht maßgeblich, die Datei ist es.

Welche Fassung einer Migration **tatsächlich gelaufen** ist, steht nicht hier,
sondern in `supabase/migrations/APPLIED.md`. Die Prüfsummenliste sagt „diese
Datei hat sich geändert"; `APPLIED.md` sagt „das ist die Fassung, die auf
Staging ausgeführt wurde".

## Reihenfolge

`0125` vor `0124`. `0125_preflight` → `0125` → `0125_postflight` →
`0124_preflight` → `0124_baseline` (Ränge 1–3) → `0124` →
`0124_baseline` (Ränge 1–3) → `0124_postflight` → Browser.

Bricht `0124` ab, kommt `0124_rollback_check` dazwischen: er sagt, ob die
Vorher-Baselines weiter gelten.

`0126` steht hinter beiden und hängt an keiner von ihnen: `0126_preflight` →
`0126` → `0126_postflight` → die vier Schreibfälle von Hand (siehe
`0126_preflight.sql`, Kopf).

`0127` setzt `0126` voraus — sie ersetzt deren Funktion durch eine mit einem
sechsten Parameter: `0127_preflight` → `0127` → `0127_postflight` → die
Schreibfälle von Hand. Der Preflight blockiert nicht, wenn `0127` schon
angewendet ist; Prüfung 210 sagt dann `NACH_0127` statt `VOR_0127`.

Der erste Anwendungsversuch von `0127` brach in der Nachbedingung ab
(`die Argumenttypen sind nicht die erwarteten`), weil die Prüfung den ganzen
`proargtypes`-Vektor mit einem `array[...]`-Literal verglich — nullbasiert
gegen einsbasiert. `0127_signature_diagnosis.sql` stellt das nach und sagt
zugleich, ob der Abbruch vollständig zurückgerollt wurde. Der Wächter gegen
diese Form steht in `src/lib/business/fingerprint-rights.test.ts` und gilt für
**alle** Migrationen und Prüfdateien; diese Diagnose ist die einzige
namentliche Ausnahme, weil sie den Fehlgriff absichtlich zeigt.

`0130` setzt `0129` voraus, `0131` setzt `0130` voraus — beide ersetzen
denselben Funktionsrumpf und müssen deshalb in dieser Reihenfolge laufen:
`0130_preflight` → `0130` → `0130_postflight` → `0131_preflight` → `0131` →
`0131_postflight` → Sicherung herunterladen → `npm run verify:backup`.

`0128` setzt `0122`/`0123` voraus und `0129` setzt `0128` voraus:
`0128_preflight` → `0128` → `0128_postflight` → die Schreibfälle aus
`0128_test_plan.md` → `0129_preflight` → `0129` → `0129_postflight` → der
Wiederherstellungstest aus `0129_restore_test.md`.

Der Export selbst wird nach `0129` mit `0129_export_baseline.sql` geprüft: sie
liefert die Zahlen, die in der heruntergeladenen JSON-Datei stehen müssen. Den
Vergleich macht dann ein Befehl:

```
npm run verify:backup -- --file ~/Downloads/skyisles-business-backup-….json
```

Er liest nur Dateien — keine Datenbank, kein Netz, kein Schlüssel —,
vergleicht alle 28 Bereichszähler, die vollständige Belegkette und seit dem
Feldabgleich **jedes Feld jedes Bereichs** gegen zwei Quellen: `manifest.ts`
und den Rumpf der letzten Migration. Drei getrennte Kategorien (fehlend,
unerwartet, ausdrücklich ausgeschlossen), leere Bereiche als `leer` statt `ok`
ausgewiesen. Er gibt **keine personenbezogenen Daten** aus. Liegt die Datei im Projektordner, bricht
er ab, statt sie zu lesen (`docs/SECURITY.md`).
**Sie ruft `seller_business_backup()` nicht auf** — die Funktion liefert
Käuferanschriften, und eine Prüfdatei schreibt keine personenbezogenen Daten in
ein Protokoll. Verglichen werden Zeilenzahlen, die Belegkette und Prüfsummen.

**Die Wiederherstellbarkeit ist beschrieben, nicht geprüft.** Es gibt keine
Importfunktion (`restore_supported` ist `false`), die Belegtabellen sind für
die Anwendung gesperrt, und ein ehrlicher Test braucht eine leere Datenbank.
`0129_restore_test.md` sagt Schritt für Schritt, was auf einer isolierten
Testdatenbank zu tun ist — einschließlich der vier Identity-Sequenzen, die
die Datei selbst nicht beschreibt. Das Ergebnisprotokoll am Ende der Datei ist
leer, solange niemand sie durchlaufen hat.

**Der Aufruf mit fünf benannten Argumenten ist der Fall, den keine lesende
Datei prüfen kann.** `0127` löscht die fünfparametrige Fassung und legt eine
sechsparametrige an; dass PostgREST einen Aufruf ohne `p_swap` weiterhin
auflöst, zeigt erst ein Speichern aus einem Client, der `p_swap` nicht
schickt. Der Postflight prüft nur die Voraussetzungen dafür: Namen, Typen,
fünf Defaults und genau eine Fassung.
