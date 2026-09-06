# Projektstatus — PortalVault

Stand: 2026-09-06 · beschreibt den **aktuellen** Zustand, nicht die Historie.
Die vollständige Änderungshistorie liegt in Git.

---

## Aktuelle Phase

**V1.2 abgeschlossen — Datenbankfundament steht und ist bewiesen.**
V1.1 (Fundament), V1.2A (Schemaentwurf), V1.2B (Ausführung) und V1.2C (funktionale
RLS-Verifikation) sind fertig.

`0001_initial_schema.sql` wurde am 2026-09-03 im Supabase-SQL-Editor ausgeführt und strukturell
verifiziert. Am 2026-09-04 hat `npm run verify:rls` mit **zwei echten JWT-Sessions**
**31 von 31 Prüfungen bestanden** (`Functional RLS verification passed.`).

Die Sicherheitsregeln sind damit nicht nur konfiguriert, sondern **nachgewiesen wirksam**:
`on_auth_user_created` legt je Benutzer genau ein Profil an, und ein angemeldeter Benutzer kommt
an fremde Profil- und Sammlungsdaten weder lesend noch schreibend heran.

Testfixture und beide Test-Auth-Benutzer wurden anschließend vollständig entfernt; alle fünf
Tabellen standen danach wieder auf **0 Zeilen**.

**Produktrichtung festgelegt (2026-09-04):** PortalVault V1 ist eine Sammler- und
Analyseplattform, **kein Marketplace** (ADR-0021). Zielbild: ein Sammler öffnet PortalVault am
Handy, sieht den visuellen Katalog, tippt die Figuren an, die er besitzt, und sieht seinen
Fortschritt. Details in `docs/ROADMAP.md`, Abschnitt „Produktvision".

**V1.5 abgeschlossen und vollständig verifiziert.** Der Katalog ist die Startseite: 600
Figuren ohne Konto sichtbar, Suche und Serienfilter im Browser, Owned-Toggle mit optimistischem
UI, Detailseiten unter `/skylanders/<slug>`, geschützte Sammlungsseite mit Fortschritt und
Sammlungswert, gemeinsame responsive Navigation. Die sichtbare Anwendung heißt **SkyIsles**
(ADR-0028).

Damit steht der **erste vollständige End-to-End-Produktfluss**: Katalog öffnen → Figur finden →
antippen → anmelden → eigene Sammlung sehen.

⚠️ **Offen und blockierend: `supabase/migrations/0002_characters.sql` ist geschrieben, aber
NOCH NICHT AUSGEFÜHRT.** Sie muss wie 0001 im Supabase-SQL-Editor laufen. Bis dahin schlägt
jede Katalogabfrage fehl, weil die Datenschicht `characters` mitliest, und `npm run verify:rls`
meldet 31/32 mit genau diesem Hinweis.

**Shop-Fundament vollständig entschieden (2026-09-05, ADR-0037) — nichts implementiert.**
Rollen in `shop_admins` plus `is_shop_admin()`, nie in `profiles` und nie per E-Mail-Konstante ·
`shop_inventory` ohne `user_id`, Schlüssel `(sky_id, condition)` mit genau `loose` und `boxed` ·
`inventory_movements` als Anhängejournal **ohne redundante `sky_id`** · gespeicherte Menge plus
Journal · atomares bedingtes Update gegen Doppelverkauf · öffentlich nur „Auf Lager" /
„Nicht auf Lager" aus `quantity - reserved` · `sale_price` manuell, `market_price` unangetastet ·
**kein `catalog_visible`**, `is_active` bleibt unverändert · SWAP-Hälften und Software werden in
V1 nicht verkauft · Reihenfolge Foundation → Legacy-Import → `/shop-admin`.

Zwei Legacy-Befunde dahinter: **46 der 561 Katalogzeilen sind Verpackungs-/Zweitexemplarvarianten
derselben Figur** — ihre Bereinigung ist ein eigener späterer Schritt (**Collector Catalog
Normalization**) und ausdrücklich kein Blocker —, und von 234 Bestandspositionen sind 16 gar
keine öffentlichen Sammelobjekte.

**Einstandswert geklärt (2026-09-05, ADR-0037 § 21).** Die Legacy-Excel kennt Einkaufspreise
nur als Summe je Einkauf, ohne SKY-ID und ohne Charge — für alle 234 Bestandspositionen ist der
Einstand unbelegbar, der Import kann also nichts verlieren. Ab dem ersten eigenen Wareneingang
wäre der Preis dagegen bekannt, deshalb bekommt `inventory_movements` zwei nullable Spalten
`unit_cost` und `currency`. Chargen bleiben ableitbar und werden nicht gebaut.

**Produktgruppen-Untertabs im Katalog (2026-09-06, ADR-0041).** Unter den sechs Serien steht eine
zweite, kleinere Navigationsebene: `Alle · Figuren · Trap Masters · Fallen · Minis · Items` — je
Serie nur die tatsächlich vorhandenen Gruppen, aus den Daten abgeleitet, mit Anzahl. Reihenfolge
und Labels zentral in `src/lib/catalog/group.ts`. Die Gruppe verengt denselben Pool wie der
Besitzfilter, weshalb Suche und serienübergreifende Suche sie ohne eigene Implementierung
mittragen. Serienwechsel setzt auf `Alle`. Zahlen beschreiben die Serie vor Suche und
Besitzfilter; die Adminansicht zählt verborgene Figuren mit, die öffentliche nicht. Eine Leiste
für beide Rollen, `NULL` bleibt unter `Alle`. Zustand bleibt clientseitig; `?group=` wird nur zum
Wiederherstellen nach einer Anmeldung gelesen.

**Adminverwaltung im Katalog (2026-09-06, ADR-0042).** Der Geschäfts-Admin arbeitet auf derselben
Website wie jeder Sammler: `/` bleibt eine Route, eine Datenbasis, eine Karte. Für ein Adminkonto
trägt dieselbe `FigureCard` andere Interaktion — Anzeigename **inline** bearbeitbar (Stift, Enter
speichert, Escape bricht ab, leer setzt auf die ADR-0030-Ableitung zurück), `Verbergen`/`Anzeigen`
als benanntes Bedienelement statt Tap auf die Karte, `Details` in den bestehenden Editor. Keine
zweite Katalogkomponente, keine zweite Mutation: beides ruft die Server Actions aus
`src/lib/admin/actions.ts` und damit die `is_shop_admin()`-Funktionen aus `0004`.
**Verborgene Figuren bleiben für den Admin sichtbar** (abgedunkelt, Chip „Verborgen") — ein
ausgelassener Filter, `is_active` und Softwareausschluss gelten weiter. Im Adminmodus entfallen
Besitzfilter, Sammlungsaktion und Besitzrahmen; die Navigation zeigt **Katalog · Admin · Profil**.
Ein goldener „Admin"-Chip neben der Wortmarke macht den Modus erkennbar. Der Sammlerkatalog ist
unverändert.

**Adminbereich Phase 1 gebaut und live (2026-09-06, ADR-0039/0040/0041).**
`/admin`, `/admin/catalog`, `/admin/catalog/[skyId]` und `/admin/catalog/categories` existieren;
Nicht-Admins bekommen **404**. Berechtigung bleibt `shop_admins` + `public.is_shop_admin()` —
trotz des Namens die allgemeine Adminberechtigung —, gelesen über `src/lib/auth/admin.ts`.
Vergabe über `npm run admin:grant` (lokal, Service Role, Dry-Run, `--apply`, idempotent, keine
Adresse im Quelltext). **Noch kein Konto freigeschaltet.**

Migration `0004_catalog_editorial.sql` ist geschrieben und nach einem Security-Review
überarbeitet, aber **noch nicht ausgeführt**. **Der Befund:** Ein Tabellen-Grant kennt keine
Spalten — `select=*` liefert einem anonymen Client jede Spalte von `skylanders`, RLS filtert nur
Zeilen. Der erste Entwurf hätte `admin_note` dorthin gelegt und damit veröffentlicht. Jetzt
liegen auf `skylanders` nur die zwei **öffentlichen** Spalten (`catalog_visible`,
`display_name_override`); die interne Notiz steht in der eigenen Tabelle `catalog_editorial`
(anon ohne jedes Recht, `authenticated` nur über eine `is_shop_admin()`-Policy).
`edited_at`/`edited_by` sind ersatzlos entfallen — `catalog_admin_changes` beantwortet das
bereits. Zusätzlich **ersetzt** `0004` die Policy `skylanders_select_public` (`using (true)`):
verborgene Zeilen verschwinden auch aus der API, außer für Admins und für den Besitzer der
Figur. Dazu `categories.catalog_group` mit Backfill der 24 Kategoriezeilen, das Append-only-
Journal und vier `security definer`-Funktionen, die jede selbst `is_shop_admin()` fragen.

**Produktgruppen** (`figure`, `giant`, `swapper`, `trap_master`, `sensei`, `vehicle`, `trap`,
`creation_crystal`, `mini`, `item`) liegen auf der Kategorie, nicht auf der SKY-ID: der Audit
hat belegt, dass jede Kategorie vollständig in genau eine Gruppe fällt. Sie sind **orthogonal**
zu Varianten und zu Completion — `variant_kind`, `is_special` und ein Specials-Filter bleiben
ungebaut, und die öffentliche zweite Tab-Leiste kommt in einem eigenen Schritt.

**Verborgene Figuren zählen weder im Zähler noch im Nenner** des Fortschritts (ADR-0040), bleiben
aber in der Sammlung und in ihrem Wert. `owned > total` kann dadurch nicht entstehen.

⚠️ **Bis die Migration ausgeführt ist, laufen Katalog und Sammlung nicht**: die Abfragen lesen
`catalog_visible` und `catalog_group`. Reihenfolge: `0004` ausführen → `npm run verify:editorial`
(echte anonyme/Nutzer-/Admin-Sitzungen) → committen und pushen → optional Admin freischalten.

**V4.4 umgesetzt (2026-09-06, ADR-0038).** Drei Nachbesserungen. **Der Besitzfilter steht still:**
Das Häkchen im Ein-Zustand machte den Button breiter und schob ihn auf 390 px in die nächste
Zeile — jetzt unterscheidet nur Farbe die Zustände, `aria-pressed` und Text bleiben.
**Gesammelte Katalogkarten haben einen goldenen Grund** (`--card-owned`, flacher Verlauf, kein
Blur): außen goldener Rahmen, innen goldene Kachel, dazwischen die unveränderte weiße Bildplatte
mit neutralem Ring — das Foto wird nicht getönt. Sammlungskarten bleiben neutral.
**Katalog → Sammlung startet sofort:** `/collection` ist dynamisch und wurde deshalb gar nicht
geprefetcht, solange es keine `loading`-Grenze gab; mit `loading.tsx` liefert der Prefetch jetzt
18,5 KB Hülle statt 324 B Nichts, und das erste Byte der Navigation kommt nach 71 statt 209 ms.
Der Prefetch lädt die Sammlung **nicht** mit (nachgemessen: gleich schnell bei 5 wie bei 448
Figuren) und ist für abgemeldete Besucher abgeschaltet; `useLinkStatus` gibt Rückmeldung, falls
doch gewartet wird.

**V4.3 umgesetzt (2026-09-06, ADR-0038).** Vier Nachbesserungen. **Login:** Ein falscher
Versuch leert nur noch das Passwort, die E-Mail-Adresse bleibt stehen — Ursache war der
React-Formularreset nach einer Server Action, die Regel steht in `src/lib/auth/preserve.ts`
(Kennung bleibt, Geheimnis nie, nichts wird gespeichert). **Katalogfilter umgedreht:**
**„Besitz anzeigen", standardmäßig an** — an ist der volle Katalog, aus zeigt nur, was noch
fehlt; nicht persistiert, wirkt in Raster und serienübergreifender Suche, und eine gerade
gesammelte Figur verschwindet sofort. **Sammlung schneller:** Die Seite lädt den Katalog nicht
mehr in den Browser (sechs Zahlen statt 561 Figuren) und zeigt Kopf und Gerüst über eine
`<Suspense>`-Grenze, bevor die Daten da sind; dazu eine Nutzerabfrage je Anfrage statt drei bis
vier. Gemessen mit 448 Figuren: HTML 1.502 → 1.260 KB, RSC-Payload 496 → 245 KB, erstes
sichtbares Gerüst nach 210–260 ms statt gar nichts vor 420–670 ms. Die Bilder waren nicht die
Ursache (sie sind bereits `lazy`, mit festen Maßen). **Filterposition:** Der Duplikatfilter
steht jetzt in der Kontrollzeile zwischen Anzahl und Symbole/Tabelle.

**Deployment vorbereitet (2026-09-06).** Das Repository ist bereit für ein erstes Vercel-Deployment
auf eine temporäre Testadresse. Sie läuft seit 2026-09-06 unter
`https://portal-vault-lovat.vercel.app` als Production-Deployment von `main`, damit die Adresse
stabil bleibt. Keine hartkodierten Entwicklungsadressen im Anwendungscode: Auth-Rücksprünge entstehen
zur Laufzeit aus der Origin (`safeOrigin()`), Redirects im Callback und in der Middleware sind
relativ. Vercel braucht **nur** `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_ANON_KEY`;
der Service-Role-Key wird von keinem ausgelieferten Codepfad gelesen und bleibt lokal.
**Die Testadresse trägt `noindex, nofollow`** über `metadata.robots` in `src/app/layout.tsx` —
bewusst ohne `robots.txt`, weil ein `Disallow` das Lesen des Noindex verhindern würde. Beim Start
von `skyisles.de` muss beides bewusst entfernt werden; ein Test erzwingt die Entscheidung.
Einzelheiten, Supabase-URL-Konfiguration und Schrittfolge: `docs/DEPLOYMENT.md`.
**Vor der öffentlichen Beta fehlt weiterhin ein eigener SMTP-Anbieter.** `skyisles.de` ist noch
nicht verbunden.

**V4.2 umgesetzt (2026-09-06, ADR-0038).** Der Besitzrahmen im Katalog ist **scharf**: kein
Weichzeichner mehr, `--gold-glow` heißt `--gold-frame` und enthält keinen Unschärferadius (ein
Test liest das aus `globals.css`); Rahmen, feine Innenlinie, vier Funken und Krone bleiben. Der
Katalog-Abschnittskopf trägt neben `Serie · n Figuren` den Anzeigefilter **„In Besitz"**
(standardmäßig aus, abgemeldet gar nicht vorhanden, wirkt auch in der serienübergreifenden
Suche, ändert nichts an den Daten). Die Sammlungsseite heißt **„Sammlung"**, öffnet in der
**Tabelle** (gespeicherte Wahl schlägt den Standard) und die Tabelle hat eine Spalte **„Aktion"**
mit zurückhaltendem `Entfernen` — dieselbe Mutation und dasselbe Rückgängig wie auf der Karte,
weiterhin ohne Bestätigungsdialog. **Duplikate sind kein Serien-Tab mehr, sondern ein Filter**,
kombinierbar mit `Alle` und mit einer einzelnen Serie, in beiden Ansichten und mit der Suche;
die Duplikatzahlen erscheinen als eine kompakte Zusatzzeile in der bestehenden
Zusammenfassung. Serienabschnitte gelten jetzt überall, auch unter Filter; die Abschnittszahlen
bleiben Sammlungsstand. **Ein Elementfilter und der Special-Umschalter fehlen weiterhin
bewusst** (Datenlage, ADR-0034); die Filterkomponente ist auf Erweiterung angelegt. Ohne
Migration, ohne Datenänderung.

**V4.1 umgesetzt (2026-09-06, ADR-0038).** Gesammelte Katalogkarten behalten Bild und Fläche
unverändert — das Gold liegt um die Karte, nicht als Filter darüber. „Filter zurücksetzen"
erscheint nur bei echtem Filter. Serienabschnitte auch bei einzelner Serie. Tabellenansicht mit
44-px-Miniaturen und zentrierten Werten. Katalogsuche findet über den aktiven Tab hinaus, ohne
ihn zu wechseln: aktive Serie zuerst, weitere Serien als eigene Abschnitte.

**Audit ergab: Special-Umschalter ist noch nicht baubar.** Nur 104 von 561 aktiven
Sammelobjekten (18,5 %) haben einen Charakterlink, 19 Charaktere existieren insgesamt, und kein
Feld unterscheidet Basisausgabe von Sonderedition. Vor dem Umschalter braucht es einen eigenen
Daten-/Klassifikationsschritt (ADR-0038, Abschnitt 10d). **V4.1 selbst kam ohne Migration aus.**

**Visual V4 umgesetzt (2026-09-06, ADR-0038).** Eigenes SkyIsles-Emblem als SVG, Wortmarke und
Titel in einer System-Display-Serif, Navigation links neben der Wortmarke. Gesammelte
Katalogkarten tragen Gold über die **ganze** Karte plus eine goldene Krone als Siegel; in
`/collection` bleibt beides aus. Katalog und Sammlung nutzen **dauerhaft verschiedene Artworks**
(Portal gegen Weltblick). Neu in der Sammlung: Umschalter **Symbole / Tabelle** (seit V4.2
öffnet die Tabelle; echte Tabelle
auf Desktop, gestapelte Zeilen mobil, Wahl im `localStorage` über `useSyncExternalStore`) und
eine Gruppierung der Ansicht **Alle nach Spielen** mit Abschnittsüberschrift und `owned / total`.
Basis-/Special-Klassifikation bewusst nicht vorbereitet.

**Visual V3.3 umgesetzt (2026-09-05, ADR-0038).** Das eigene **Portal-Artwork** liegt als
`WorldZone` hinter der gesamten oberen Seite — hinter Kopf, Titel, Suche und Serienpillen — und
verläuft in eine ruhige **Deep-Navy-Vitrine**, auf der die elfenbeinfarbenen Karten stehen;
keine sichtbare Bildkante mehr. Gemountet von beiden Collector-Layouts, damit die Navigation
zwischen den Route Groups sie nicht verliert (struktureller Test). `color-scheme: dark` plus ein
dunkler Inline-Grund am `<html>`, damit weder ein helles Systemthema noch ein fehlendes
Stylesheet die Seite weiß werden lässt. Die Detailseite hat eine eigene Deep-Fläche für Name und
Preis. Der Besitzrahmen ist auf Sichtweite verstärkt (drei Ringe, Lichtkante, Schein), die
Overlays über dem Artwork sind lokal statt flächig, und die Sammlungs-Zusammenfassung ist rund
40 % flacher — eine Zeile aus Segment, Zahl und drei Kennzahlen statt fünf gestapelter Zeilen. Das allgemeine Weltbild trägt jetzt die Auth-Seiten. Fehlende Figuren bekommen
eine **Bronzekante**, eigene eine doppelte **Goldfassung** mit Schein. Der Sammlungs-Hero ist
eine nahezu deckende Vitrinenplatte mit doppeltem Goldrahmen, Eckwinkeln, goldenem
Fortschrittsbalken und getrennten Kennzahlen. Kopf mit Goldkante und goldener Unterstreichung
statt heller Pille. Assets: 135 KB / 45 KB (Portal), 112 KB / 43 KB (Welt), Quellen unter
`artwork/` unversioniert. Das
Farbschema kippt nicht mehr die Welt, sondern die Tageszeit — hell ist Dämmerung, dunkel ist
Nacht, beide mit denselben hellen Karten. Der Besitzrahmen im Katalog ist deutlich verstärkt
(Goldrand plus innere Haarlinie); in `/collection` gibt es ihn weiterhin nicht.

**Design V2.1 umgesetzt (2026-09-05, ADR-0038).** Besitz trägt **ausschließlich im Katalog** der
Kartenrahmen (warmes Amber, `aria-pressed` plus `sr-only`-Text), nicht mehr ein Text-Chip; in
`/collection` bleiben die Karten neutral, weil dort ohnehin alles Besitz ist. **Die Karte selbst
ist der Umschalter**; „Info" ist eine eigene Aktion im Kartenfuß und als Geschwisterelement
sauber davon getrennt. In `/collection` sind die sechs Serienfortschrittskarten entfallen; der
Hero folgt stattdessen dem aktiven Filter — je Serie eigene Zahlen; die Duplikatzahlen (Figuren
mit Duplikaten, zusätzliche Exemplare, Marktwert nur der Zusätze) sind seit V4.2 eine Zusatzzeile
in derselben Zusammenfassung statt einer eigenen Form. Die Suche filtert das Raster, verändert
aber die Hero-Zahlen nicht.

**Design V2 umgesetzt (2026-09-05, ADR-0038).** Katalog und Sammlung sind fachlich getrennt:
Der Katalog zeigt alle Sammelobjekte **einer immer gewählten Serie** (kein „Alle", ausgeschriebene
Namen), die Sammlung ausschließlich Figuren mit `quantity >= 1`. Das Häkchen über der Figur und
der `✓ Gesammelt`-Button sind weg; Besitz ist ein ruhiger Chip „In deiner Sammlung", der zugleich
die Aktion zum Entfernen bleibt. Karten ohne Rahmen, Bild als Hero, Preis vor Metadaten. Die
Sammlung hat einen dunklen Vitrinen-Kopfbereich mit Anzahl, Fortschritt, Marktwert und „fehlen
noch", darunter kompakte Serienfortschrittskarten, die zugleich der Serienfilter sind. Neue
Wortmarke mit Monogramm, getönter Aktivzustand in der Navigation. Keine neue Abhängigkeit, keine
Migration, keine Änderung an Datenmodell, Auth, RLS oder Shop-Fundament.

Dabei gefunden und behoben: Der Hinweis „… Einträge sind Spiele" konnte nie erscheinen, weil die
Statistik die bereits herausgefilterten Zeilen bekam.

**Shop Foundation implementiert (2026-09-05, `supabase/migrations/0003_shop_foundation.sql`).**
Drei Tabellen (`shop_admins`, `shop_inventory`, `inventory_movements`), eine Reconciliation-View
und sieben Funktionen. Kein Client hat ein Tabellenrecht; der gesamte Schreibzugriff sind
`record_inventory_movement()` (Shop-Admin), `system_record_inventory_movement()` (nur
`service_role`, für den späteren Import) und `set_shop_listing()` (Preis und Listing).
`inventory_movements` ist unveränderliche Audit-Historie: kein `DELETE` für irgendeine Rolle,
keine Änderung an einer Sachspalte, und eine Position mit Historie ist wegen
`on delete restrict` ebenfalls nicht löschbar. Einzige erlaubte Änderung ist die Anonymisierung
`created_by → NULL` bei Kontolöschung — ohne sie wäre jedes Konto mit Buchungshistorie dauerhaft
unlöschbar. `initial_import` gilt je Position genau einmal.
`tools/verify-rls.mts` prüft das in einem neuen Abschnitt 9.

**Die Migration ist noch nicht angewandt.** Sie muss im Supabase SQL Editor ausgeführt werden;
danach zeigt `npm run verify:rls`, ob sie greift. Kein `/shop-admin`, kein öffentlicher Shop,
kein Import, keine Rollenvergabe, keine Bestellungen.

**Collection Experience implementiert (Phase H, 2026-09-05).** `/collection` ist eine
Sammlerübersicht statt einer Liste: Gesamtfortschritt, geschätzter Marktwert, Serienfortschritt
für alle sechs Spiele, die Filter **Alle · Gesammelt · Fehlend · Duplikate** und alle 561
Sammelobjekte — fehlende inbegriffen. Mengen werden ab 2 auf der Karte gezeigt.
**Der V1.5-Fehler ist behoben:** „Rückgängig" nach dem Entfernen stellt die ursprüngliche Menge
wieder her, nicht 1. Semantik vollständig in `docs/DATABASE.md` festgehalten.

**Visual Pass Phase F implementiert (2026-09-05).** Der Katalog hat einen kompakten Kopf
(„Skylanders Katalog"), eine Serienleiste aus Kurzcodes — **alle sieben Tabs passen auf 360 px**,
statt „Swap Forc…" als Dauerzustand —, eine Kontextzeile („Trap Team · 141 Figuren"), einen
Empty State mit Zurücksetzen und Skeleton- sowie Fehlerzustände. Suchwerkzeuge sind ab `md:`
sticky, mobil nicht. **Keine Serienfarben** — begründet in `docs/ARCHITECTURE.md` 3c und
ADR-0035. Dabei ein Architekturbefund: eine `loading.tsx` über einer Route mit `notFound()`
zerstört den 404-Status; der Katalog liegt deshalb in einer eigenen Route-Group.

**Visual Pass Phase E implementiert (2026-09-05, ADR-0035 Nachtrag).** Die kuratierten
Elementdaten erscheinen als zweite, sehr zurückhaltende Ebene: 2 px Akzentkappe an der
Kartenoberkante und ein benannter Badge neben dem Marktwert, dazu derselbe Badge im
CharacterPanel. **102 der 561 Sammelobjekte** tragen ein Element (104 verknüpft, davon Kaos
bewusst ohne); die übrigen 459 bleiben neutral — der Standard, nicht der Mangel.

**Visual Pass Phase D implementiert (2026-09-04, ADR-0036).** Die Hauptnavigation trägt drei
Ziele — Katalog, Sammlung, Profil. Abmelden ist in `/settings` gewandert, die aktive Route wird
aus dem Pfad abgeleitet statt je Layout durchgereicht, und die Wortmarke steht jetzt auch auf
dem Telefon. Bodenleiste und Abstandhalter berücksichtigen `env(safe-area-inset-bottom)`.

**Visual Pass Phase A implementiert (2026-09-04, ADR-0035).** Die Oberfläche hat eine
Token-Grundlage: Flächen, Text, Linien, Akzent, Status, Radius, Schatten und die zehn
Elementfarben (definiert, noch nicht verwendet). Tragender Token ist **`plate`** — die helle
Bildbühne, die die weißen Produktfotos im Dark Mode zur Vitrine macht statt zum weißen Quadrat.
Dazu ein globaler `:focus-visible`-Stil, der die größte Accessibility-Lücke schließt, und
`prefers-reduced-motion`. **Keine Funktionalität verändert.** Phasen B–I folgen nach Review.

**Charakter-Pilot implementiert (2026-09-04, ADR-0034).** Der Katalog hat eine zweite
Identitätsebene: den Charakter. 19 kuratierte Charaktere verbinden 104 der 561 Sammelobjekte —
Drobot über drei Auflagen, Spyro über drei Serien inklusive Eon's Elite, `Fire Bone Hot Dog`
zum Charakter Hot Dog. Detailseiten zeigen einen optionalen Charakterbereich und „Weitere
Figuren dieses Charakters"; die Suche kennt den Charakternamen als vierte Schreibweise.
Zuordnungen sind **kuratiert, nicht geraten** — an den echten Daten scheitert jede Namensregel.

**Fachliche Shop-Architektur festgehalten (2026-09-04, ADR-0032/0033) — nichts implementiert.**
Die Domänengrenze zum späteren First-Party-Shop, das Rollenkonzept `shop_admin` und die fünf
Preisebenen sind dokumentiert, damit ein späterer Shop auf dem Tracker aufsetzt statt in ihn
hinein. **Keine Migration, keine Tabelle, keine Rolle, kein Checkout, keine Importlogik.**
ADR-0021 (kein Marketplace) und ADR-0008 (kein Legacy-Lagerbestand) bleiben unverändert.

**Nachtrag 2026-09-04 — Entfernen ist vollständig (ADR-0031).** Eine Figur lässt sich jetzt
auch **auf `/collection`** direkt entfernen, ohne den Umweg über den Katalog. Ohne
Bestätigungsdialog, dafür mit „Rückgängig" an der abgeblendeten Karte und 44 px Tippfläche.
Zählung, Fortschritt, Sammlungswert und die Hinweiszeilen aktualisieren sich sofort mit.
Die Server Action `setCollected` war bereits korrekt und wurde **nicht verändert**.

**V1.4 abgeschlossen und vollständig verifiziert.** Auth steht: Registrierung,
E-Mail-Bestätigung, Login, Logout, Passwort vergessen und zurücksetzen, Onboarding mit
Benutzernamen, geschützter Bereich, Einstellungen zum Ändern von Benutzername und Passwort.
46 Unit-Tests, 13 Routen im Build, Smoke-Test gegen den Produktionsserver **und ein manueller
Durchlauf mit einer echten E-Mail-Adresse** — alles grün. Die Zustellstrecke ist damit belegt.

**V1.3 abgeschlossen.** Der Katalog steht in der Datenbank: am 2026-09-04 wurden
**6 Serien, 30 Kategorien und 600 Figuren** importiert und mit 18 rein lesenden Prüfungen
verifiziert. Ein zweiter Dry-Run direkt danach belegte die **Idempotenz** (`new 0, changed 0`).
Benutzerdaten blieben unberührt: `profiles` und `collection_items` stehen weiterhin auf 0.

**Meilenstein-Reihenfolge entschieden (ADR-0023):** V1.3 Import → V1.4 Auth + `@supabase/ssr`
→ V1.5 Katalog mit Owned-Toggle und minimaler Sammlungsseite (**dort steht der
End-to-End-Fluss**) → V1.6 Ausbau → V1.7 Beta-Reife.

Wartet auf Freigabe für **V1.3 — Katalogimport**.

---

## Aktuell implementiert

| | |
|---|---|
| Next.js 16.3.4, App Router, Turbopack | ✅ |
| React 19.2.8, TypeScript 5 (`strict`) | ✅ |
| Tailwind CSS v4, ESLint 9 (`eslint-config-next`) | ✅ |
| Import-Alias `@/*` → `src/*` | ✅ |
| Sichere `.gitignore` (Secrets, Excel, interne Legacy-Daten) | ✅ |
| `.env.example` mit Platzhaltern, ohne echte Werte | ✅ |
| npm-Skripte `dev` · `build` · `start` · `lint` · `typecheck` · `check` | ✅ |
| Wurzellayout mit `lang="de"`, Metadaten | ✅ |
| Englischer Codebase, deutsche Oberfläche (ADR-0019) | ✅ |
| Zentrale Texte `src/lib/i18n/de.ts` — Schlüssel englisch, Werte deutsch | ✅ |
| Formatierung `src/lib/format.ts`, Locale `de-AT` | ✅ |
| Vorläufige Startseite | ✅ |
| Vollständige Projektdokumentation in `docs/` | ✅ |
| `supabase/migrations/0001_initial_schema.sql` — geschrieben, **ausgeführt und strukturell verifiziert** | ✅ |
| `@supabase/supabase-js` als Abhängigkeit | ✅ |
| `tools/verify-rls.mts` — 31 funktionale RLS-Prüfungen, `npm run verify:rls` | ✅ **ausgeführt, 31/31 bestanden** |
| `src/lib/catalog/slug.ts` — Slug-Regel nach ADR-0011, 15 Unit-Tests | ✅ |
| `tools/import-catalog.mts` — Katalogimport, `npm run catalog:import` | ✅ **ausgeführt**, 636 Zeilen geschrieben |
| Katalogdaten in Supabase: 6 Serien, 30 Kategorien, 600 Figuren | ✅ |
| `data/catalog/products.json` — Import-Input, 600 Artikel | ✅ |
| `public/images/skylanders/` — 475 WebP, 11 MB | ✅ |
| Vitest als Unit-Test-Werkzeug (ADR-0013), `npm test` | ✅ 211 Tests |
| `@supabase/ssr`, Browser-/Server-/Proxy-Clients | ✅ |
| Auth-Routen: Registrierung, Login, Logout, Bestätigung, Passwort-Reset | ✅ |
| Onboarding und Benutzernamenänderung (ADR-0016) | ✅ |
| Geschützter Bereich `/dashboard`, `/settings` über `src/proxy.ts` | ✅ |
| Sichere Redirect-Validierung gegen offene Weiterleitungen | ✅ |
| Katalog als Startseite `/`, ohne Konto nutzbar (ADR-0025) | ✅ |
| Suche und Serienfilter clientseitig (ADR-0026) | ✅ |
| Owned-Toggle, Mutation als Endzustand (ADR-0027) | ✅ |
| Detailseite `/skylanders/<slug>` | ✅ |
| `/collection` mit Fortschritt und Sammlungswert | ✅ |
| Entfernen im Katalog **und** auf `/collection`, mit Rückgängig (ADR-0031) | ✅ |
| `characters` + `skylanders.character_id`, RLS und Grants (Migration 0002) | ⚠️ geschrieben, **nicht ausgeführt** |
| 19 kuratierte Pilotcharaktere, 104 verknüpfte SKY-IDs (ADR-0034) | ✅ Datei + Werkzeug |
| `tools/import-characters.mts`, `npm run characters:import` | ✅ Dry-Run geprüft |
| Charakterbereich und verwandte Figuren auf der Detailseite | ✅ |
| Gemeinsame responsive Navigation, mobile-first | ✅ |
| SkyIsles als sichtbarer Produktname (ADR-0028) | ✅ |
| Supabase-Projekt in EU-Region, 5 Tabellen, RLS, 10 Policies, 5 Trigger, 3 Funktionen | ✅ |

## Noch nicht implementiert

- `@supabase/ssr` und die Cookie-basierte Session-Anbindung in Next.js — **bewusst offen**,
  kommt mit dem Auth-UI (V1.4); für den RLS-Test war sie nicht nötig
- Supabase CLI (nicht initialisiert, kein Remote-Link — Migration lief über den SQL-Editor)
- Mengen-/Duplikat-UI — `quantity` wird korrekt gerechnet, ist aber nicht bedienbar (V1.6).
  Entfernen löscht deshalb immer die ganze Zeile, und ein „Rückgängig" setzt auf 1 zurück
- LightCore-Normalisierung und weitere Datenqualitätsfälle (ADR-0030, „bewusst nicht behandelt")
- Playwright-End-to-End-Tests (ADR-0013, sobald die Sammlungs-UX steht)
- Vercel-Projekt, Deployment

---

## Technischer Zustand

| Bereich | Zustand |
|---|---|
| Frontend | Katalog, Detailseiten, Auth-UI und Sammlung lauffähig; 15 Routen im Build |
| Datenbank | Schema ausgeführt und strukturell verifiziert. Supabase-Projekt (EU-Region) vorhanden, 0 Datenzeilen. Repository-Datei und Datenbankstand sind identisch. |
| Auth | Kein UI. Die Datenbankseite ist fertig und funktional verifiziert: Trigger, Policies und Rechte greifen nachweislich (`tools/verify-rls.mts`, 31/31). Konzept in `docs/AUTH.md` |
| Deployment | nicht eingerichtet, ausdrücklich noch nicht vorgesehen |
| Tests | Lint / Typecheck / Build, 211 Unit-Tests (`npm test`) und der funktionale RLS-Test (`npm run verify:rls`) |

Konten vorhanden: GitHub, Supabase, Vercel. Das Supabase-Projekt ist angelegt (**EU-Region**,
ADR-0015). Vercel ist weiterhin nicht eingerichtet.

---

## Zuletzt verifizierte Prüfungen

### Tatsächlich ausgeführt

**2026-09-04, Charakter-Pilot (ADR-0034) — teilweise verifiziert:**

| Prüfung | Ergebnis |
|---|---|
| `npm test` | ✅ 211 Tests (15 Dateien), davon 75 neu für Charaktere |
| lint / typecheck / build | ✅ alle exit 0, 15 Routen |
| `characters:import -- --validate-only` | ✅ 19 Charaktere, 104 Zuordnungen, 0 Probleme |
| kuratierte Datei gegen den echten Katalog | ✅ alle 104 SKY-IDs existieren, sind sammelbar und liegen in Figurenkategorien |
| abgeleitete „Erste Figur" für alle 19 | ✅ 19/19 korrekt |
| `npm run verify:rls` | ⚠️ **31/32** — die eine Fehlmeldung ist die noch nicht ausgeführte Migration 0002 |

**NICHT verifiziert, weil die Migration noch aussteht:** RLS und Grants auf `characters`,
der Fremdschlüssel samt `on delete restrict`, die vier CHECK-Constraints, der Import mit
`--apply`, Idempotenz gegen die Datenbank und die Detailseite im Browser. Die 13 zusätzlichen
Prüfungen in `tools/verify-rls.mts` stehen bereit und laufen, sobald die Tabelle existiert.

**2026-09-04, Entfernen aus der Sammlung (ADR-0031) — technisch verifiziert:**

| Prüfung | Ergebnis |
|---|---|
| `npm test` | ✅ 136 Tests (11 Dateien), davon 19 neu für das Entfernen |
| `npm run verify:rls` | ✅ 31/31 |
| lint / typecheck / build | ✅ alle exit 0, 15 Routen |
| Smoke-Test am Datenweg, echte Session, RLS aktiv | ✅ 23/23 Prüfungen |
| → hinzufügen → neu lesen → im Katalog entfernen → erneut hinzufügen → auf `/collection` entfernen | ✅ jeder Schritt wirksam |
| → zweimal hinzufügen, zweimal entfernen | ✅ kein Fehler, keine Doppelzeile, idempotent |
| → Figur ohne `market_price` | ✅ hinzufügbar und entfernbar |
| → Figur mit `quantity = 4` | ✅ die **ganze Zeile** verschwindet, nicht ein Stück |
| → nicht mehr erhältliche Figur (`is_active = false`) | ✅ entfernbar — eigens angelegte Testfigur, danach entfernt |
| Sammlung nach dem Durchlauf | ✅ 0 Zeilen, Testkonten gelöscht, `skylanders` wieder 600 |

Der Smoke-Test lief als eigenständiges Skript im Scratchpad, nicht im Repository. **Nicht
verifiziert:** der Browser-Durchlauf mit echtem Tippen auf dem Handy — Tippfläche (44 px),
Abblenden und „Rückgängig" sind nur im Code belegt, nicht visuell.

**2026-09-04, V1.5 — Katalog und Sammlung, technisch verifiziert:**

| Prüfung | Ergebnis |
|---|---|
| `npm test` | ✅ 76 Tests (15 Slug, 31 Auth, 30 Katalog/Sammlung) |
| `npm run verify:rls` | ✅ 31/31, jetzt gegen den gefüllten Katalog |
| lint / typecheck / build | ✅ alle exit 0, 15 Routen |
| `/` ohne Konto | ✅ 200, **600 Kartenlinks**, 534 Lazy-Bilder, 66 Platzhalter, 15 „Preis offen" |
| Login-Links für Gäste | ✅ 600, jeweils mit Serien-, Such- und Figurenkontext |
| Kontext aus der URL | ✅ `?series=G` → 86 · `?q=drobot` → 3 · `?series=G&q=bash` → 1 · `?series=UNSINN` → 600 (Rückfall) |
| Hervorhebung | ✅ gültige SKY-ID markiert genau eine Karte, ungültige keine |
| Detailseiten | ✅ 200 für echte Slugs, **404** für unbekannte |
| `/collection`, `/settings` anonym | ✅ 307 auf `/login?next=…` |
| `/dashboard` | ✅ leitet weiter, alte Links brechen nicht |
| Bild-Caching | ✅ `public, max-age=31536000, immutable` |
| Serverantwort `/` | ✅ 0,20 s, 619 KB HTML → 43,9 KB über den Draht |
| Fehler im Serverlog | ✅ 0 |

**Manueller Browser-Durchlauf (2026-09-04) — vollständig erfolgreich.** 34 Punkte über sechs
Bereiche: Katalog ohne Anmeldung, Anmeldung mit Kontextrückkehr, Sammeln, Sammlungsseite,
Detailseite, Navigation und Darstellung.

Drei Punkte waren dabei die eigentliche Prüfung, weil sie sich technisch nicht abdecken lassen:

| Punkt | Ergebnis |
|---|---|
| Scrollen mit 600 gerenderten Karten am Handy | ✅ flüssig — **keine Virtualisierung nötig**, ADR-0026 bestätigt sich in der Praxis |
| Sehr schnelles Mehrfachtippen auf den Toggle | ✅ endet im zuletzt gewünschten Zustand — die Mutation als Endzustand wirkt (ADR-0027) |
| Fehlerfall ohne Netz | ✅ springt zurück und meldet, statt falsch stehenzubleiben |

**2026-09-04, V1.4 — Auth gebaut und verifiziert:**

| Prüfung | Ergebnis |
|---|---|
| `npm test` | ✅ 46 Tests (15 Slug, 31 Auth) |
| `npm run lint` / `typecheck` / `build` | ✅ alle exit 0, 13 Routen |
| Öffentliche Routen erreichbar | ✅ `/`, `/login`, `/register`, `/forgot-password`, `/verify-email`, `/auth-error` → 200 |
| Geschützte Routen ohne Sitzung | ✅ `/dashboard`, `/settings`, `/onboarding` → 307 auf `/login?next=…` |
| `/auth/callback` ohne Code | ✅ → `/auth-error` |
| Offene Weiterleitung `https://evil.example` | ✅ verworfen |
| Offene Weiterleitung `//evil.example` | ✅ verworfen |
| Zulässiges Ziel `/dashboard` | ✅ übernommen |
| `getSession()` im Code | ✅ kommt nicht vor, nur `getUser()` |
| Deutscher Text direkt im JSX | ✅ keiner, alles über `de.*` (ADR-0019) |

**Manueller Durchlauf mit echter E-Mail-Adresse — 12 von 12 Schritten erfolgreich:**
Registrierung · Bestätigungsmail erhalten und Link geöffnet · Onboarding erreicht ·
Benutzernamen gesetzt · Dashboard erreichbar · Abmelden · erneut anmelden ·
Passwort-Reset-Mail erhalten · Passwort geändert · Anmeldung mit neuem Passwort ·
Benutzernamen unter Einstellungen geändert · Dashboard und Einstellungen danach weiterhin
funktionsfähig.

Der letzte Schritt belegt zugleich ADR-0016 in der Praxis: Nach dem Umbenennen funktioniert
alles unverändert, weil die Beziehungen an der UUID hängen und nicht am Namen.

**2026-09-04, V1.3 — Katalogimport ausgeführt und verifiziert:**

Eingabe: `products.json` vom Legacy-Build am 2026-09-04 07:40. Gegenüber dem vorherigen
Snapshot (2026-08-10 23:50) änderte sich **ausschließlich das Feld `generated`** — 0 Artikel
neu oder entfallen, 0 geänderte Namen, Preise, Bilder, Serien oder Kategorien. Die 475 WebP
waren bereits identisch.

| Prüfung nach dem Apply | Ergebnis |
|---|---|
| `series` | ✅ 6 |
| `categories` | ✅ 30 |
| `skylanders` | ✅ 600 |
| `profiles` | ✅ **0, unverändert** |
| `collection_items` | ✅ **0, unverändert** |
| eindeutige SKY-IDs | ✅ 600 |
| eindeutige Slugs | ✅ 600 |
| mit Preis / ohne | ✅ 585 / 15 |
| Bildzuordnungen / ohne | ✅ 534 / 66 |
| verschiedene Bilddateien | ✅ 475 (44 werden geteilt) |
| SKY-ID- und Slug-Format | ✅ alle gültig |
| kein Preis ≤ 0 | ✅ |
| nur die 6 öffentlichen Serien | ✅ G, I, SA, SC, SF, T |
| kein interner Namenssuffix (`- BESCHÄDIGT` usw.) | ✅ |
| jede Figur hat eine Kategorie | ✅ |
| **Summe** | **18/18** |

**Idempotenz belegt:** Zweiter Dry-Run unmittelbar danach → `series new 0 / changed 0 /
unchanged 6`, `categories 0 / 0 / 30`, `figures 0 / 0 / 600`. Alle 600 Slugs kamen aus der
Datenbank statt neu berechnet zu werden — die Stabilitätsregel aus ADR-0011 greift nachweislich.

**Dry-Run und Validierung vor dem Apply:**

| Prüfung | Ergebnis |
|---|---|
| Eingabe `data/catalog/products.json` | ✅ 6 Serien, 600 Artikel, Stand 2026-08-10 23:50 |
| Strukturvalidierung, Identität, Kategorien, Preise, Bildnamen | ✅ 0 Fehler, 0 Warnungen |
| Bildreferenzen | ✅ 475 referenziert, 475 auf der Platte vorhanden |
| Artikel mit Preis / mit Bild | ✅ 585 / 534 (entspricht dem Legacy-Export) |
| Slugs nach ADR-0011 | ✅ 515 aus dem Namen, 85 mit Serie qualifiziert, 0 mit SKY-ID, **600 eindeutig** |
| Geplante Änderungen | 6 neue Serien, 30 neue Kategorien, 600 neue Figuren, 0 geändert |
| Ablehnung kaputter Eingaben | ✅ 9 von 9 Fixtures mit Exit-Code 1 und präziser Meldung abgelehnt |
| `--validate-only` ohne Datenbankzugriff | ✅ belegt |
| Unit-Tests der Slug-Regel | ✅ 15/15 (`npm test`) |



**2026-09-04, V1.2C — funktionaler RLS-Test mit zwei echten JWT-Sessions:**

`npm run verify:rls` → **31/31 checks passed**, `Functional RLS verification passed.`

| Prüfgruppe | Prüfungen | Ergebnis |
|---|---:|---|
| `on_auth_user_created` legt je Benutzer genau ein Profil an, `username` startet `NULL` | 4 | ✅ |
| Eigenes Profil lesen und ändern | 3 | ✅ |
| Fremdes Profil weder lesen noch ändern (beide Richtungen) | 4 | ✅ |
| Eigenes Profil nicht löschbar (keine DELETE-Policy) | 1 | ✅ |
| Fremdes Profil nach allen Versuchen nachweislich unverändert | 1 | ✅ |
| Eigene `collection_items` anlegen, ändern, lesen | 4 | ✅ |
| Fremde Einträge weder lesen, ändern, löschen noch für andere anlegen | 4 | ✅ |
| Eintrag nicht auf fremde `user_id` umschreiben (`WITH CHECK`) | 2 | ✅ |
| Fremder Eintrag intakt, eigener löschbar | 2 | ✅ |
| Katalog für `authenticated` lesbar, weder änderbar noch erweiterbar | 3 | ✅ |
| `anon`: Katalog lesbar, Profile und Sammlungen nicht | 3 | ✅ |
| **Summe** | **31** | **31/31** |

Die beiden Testbenutzer entstanden über `admin.createUser + signInWithPassword` — das Projekt
verlangt E-Mail-Bestätigung, weshalb `signUp` keine sofortige Session liefert. Der Trigger
feuerte trotzdem, weil er an `INSERT ON auth.users` hängt. Für das Auth-UI (V1.4) bedeutet das:
nach der Registrierung gibt es keine sofortige Session.

**Aufräumen nach dem Lauf:** Testfixture (Serie `TEST`, eine Kategorie, `SKY-9999`) und beide
Test-Auth-Benutzer vollständig entfernt. Zeilenzahlen danach:
`series=0, categories=0, skylanders=0, profiles=0, collection_items=0`.
Es sind **keine Testartefakte** in der Datenbank verblieben.

**2026-09-03, V1.2B — gegen die laufende Supabase-Datenbank:**

| Prüfung | Ergebnis |
|---|---|
| `0001_initial_schema.sql` im SQL-Editor ausgeführt | ✅ `Success. No rows returned` |
| Tabellen | ✅ 5: `series`, `categories`, `skylanders`, `profiles`, `collection_items` |
| RLS | ✅ aktiviert auf 5/5, `forced = false` |
| Policies | ✅ 10, alle wie in `docs/DATABASE.md` Abschnitt 5 |
| Trigger | ✅ **5** (4 auf `public`, 1 auf `auth.users`) |
| Foreign Keys | ✅ **5** |
| Funktionen | ✅ 3, davon eine `SECURITY DEFINER` mit `search_path = ''` |
| `skylanders_sky_id_immutable` | ✅ korrekt als `BEFORE UPDATE OF sky_id` |
| Rechte `profiles / authenticated` | ✅ exakt `INSERT, SELECT, UPDATE` |
| Rechte `collection_items / authenticated` | ✅ exakt `DELETE, INSERT, SELECT, UPDATE` |
| Rechte Katalog / `anon` + `authenticated` | ✅ nur `SELECT` |
| Rechte `service_role` auf Katalog | ✅ Schreibrechte vorhanden (für den Import in V1.3) |
| Rowcounts | ✅ überall 0 |
| Kanonische Datei: Kopfzeile, Kodierung | ✅ erste Zeile `-- …`, kein BOM, nur LF, endet mit Zeilenumbruch |

Zwischenschritt: Ein erster Lauf ergab überzählige Rechte für `authenticated`
(`TRUNCATE, REFERENCES, TRIGGER`) aus Supabases Default-Privilegien. Die Migration wurde um
explizite `REVOKE` ergänzt, die Datenbank zurückgesetzt und die korrigierte Fassung erneut
ausgeführt. Hergang: `docs/DATABASE.md`, Abschnitt 3.9.

**2026-09-03, statisch vor der Ausführung:**

| Prüfung | Befehl | Ergebnis |
|---|---|---|
| Migration statisch geprüft | eigenes Prüfskript (nicht im Repo) | ✅ zuletzt 20 Prüfungen, 0 Fehler |
| Spaltenaudit der Migration | eigenes Prüfskript | ✅ 35 Spalten, alle englisch/snake_case, keine verbotene Spalte (`available`, `stock`, `ebay`, …) |

**2026-09-03, nach V1.1:**

| Prüfung | Befehl | Ergebnis |
|---|---|---|
| ESLint | `npm run lint` | ✅ 0 Fehler, 0 Warnungen |
| TypeScript | `npm run typecheck` | ✅ 0 Fehler |
| Production Build | `npm run build` | ✅ erfolgreich, 2 statische Routen (`/`, `/_not-found`) |
| Server-Smoketest | `npm run start` + `curl` | ✅ HTTP 200, `<html lang="de">`, Inhalte gerendert |
| `.gitignore` | `git check-ignore` | ✅ `node_modules`, `.next`, `.env.local`, `*.xlsx`, `data/internal/`, `images/master/` ignoriert; `.env.example` wird getrackt |
| Sprachkonvention | Bezeichner-Audit über `src/` | ✅ alle Bezeichner und i18n-Schlüssel englisch, keine Umbenennung nötig; Kommentare auf Englisch umgestellt |

**2026-09-03, read-only gegen `../webpage` (Grundlage der Dokumentation):**

| Prüfung | Ergebnis |
|---|---|
| Excel-Struktur | 13 Sheets, keine eingebetteten Bilder mehr |
| Öffentlicher Export `products.json` | 600 Artikel, 6 Serien, 30 Kategorien |
| Artikel mit Marktpreis / mit Bild | 585 / 534 |
| Bildzuordnungen `data/images.json` | 634 Zuordnungen → 554 Masterdateien |
| Masterbilder / Website-Derivate | 554 PNG (0 verwaist) / 475 WebP |
| Geteilte Bilder | 63 Dateien von 143 Artikeln (öffentlich: 44 von 103) |
| ID-Ledger | `highest_issued: 820` |
| Preis-Mapping | 393 gemappt, 8 unmatched, 0 ignored |
| Namenseindeutigkeit | je Serie eindeutig, global **nicht** (32 Mehrfachnamen) |

Die fünf Legacy-Testsuiten (134 Prüfungen) wurden **nicht** ausgeführt — das Legacy-Projekt ist
read-only; sie wurden zuletzt am 2026-08-11 grün gemeldet.

### Ausdrücklich NICHT verifiziert

- **Zustellraten unter echter Last.** Der manuelle Durchlauf belegt, dass Bestätigungs- und
  Rücksetzmail ankommen — über den **Supabase-Standardversand in der Entwicklung**. Für eine
  öffentliche Beta sagt das nichts über Zustellbarkeit und Limits aus; dafür braucht es einen
  eigenen Anbieter (ADR-0018).
- **Echte Atomarität des Imports.** Der Supabase-JS-Client kann keine Transaktion über mehrere
  Anweisungen aufspannen. Für den Erstimport in die leere Datenbank ist das ausdrücklich
  akzeptiert; vor regelmäßigen produktiven Importen wird es erneut bewertet
  (`docs/DATABASE.md`, Abschnitt 6).
- Keine Supabase CLI initialisiert, kein Remote-Link (die Migration lief über den SQL-Editor).

---

## Bekannte Probleme

**Keine offenen.** Die beiden im Pre-Flight vermuteten Supabase-Risiken rund um den Trigger auf
`auth.users` sind **nicht eingetreten**; das dabei tatsächlich gefundene Problem (überzählige
Rechte aus Supabases Default-Privilegien) ist behoben und verifiziert. Hergang:
`docs/DATABASE.md`, Abschnitt 3.9.

Lint, Typecheck und Build sind grün.

Zwei Hinweise ohne Handlungsbedarf:

- Beim `npm install` meldet npm, dass `unrs-resolver` (transitiv über ESLint) ein
  Postinstall-Skript hat, das nicht freigegeben ist. Die Installation ist trotzdem vollständig,
  Lint funktioniert. Keine Aktion nötig.
- `eslint@9.39.5` wird als „no longer supported" gemeldet — das ist die Version, die
  `create-next-app` mitbringt. Wird beim nächsten Abhängigkeits-Update mitgezogen.

---

## Risiken

| Risiko | Umgang |
|---|---|
| Interne Legacy-Daten könnten versehentlich ins Repository gelangen | Import nur über den validierten öffentlichen Export (ADR-0004); `.gitignore` sperrt `*.xlsx`, `data/internal/`, `images/master/`, `**/mappings/` |
| Excel und PostgreSQL könnten auseinanderlaufen | Zuständigkeit je Datenbereich, einbahniger Datenfluss (ADR-0003, ADR-0006) |
| Fehlerhafte RLS-Policy legt Benutzerdaten offen | RLS auf jeder Tabelle, `WITH CHECK` überall, Test mit zweitem Konto vor dem Deploy (ADR-0013) |
| Bildidentitäten beim Kopieren verlieren | content-adressierte Dateinamen unverändert übernehmen, Referenzen nach dem Import prüfen (ADR-0009) |
| Rechtliche Anforderungen vor der öffentlichen Beta | Impressum und Datenschutzerklärung sind Teil von V1.7 |
| E-Mail-Zustellung in der Beta | Supabase-Standardversand ist stark limitiert; produktiver Versand vor der Beta separat entscheiden (ADR-0018) |
| Legacy-Build könnte künftig nicht mehr laufen | Abhängigkeiten dokumentiert (Python 3, `cwebp`); Legacy bleibt unverändert erhalten |

---

## Entschieden (Freigaberunden 1 und 2, 2026-09-03)

**Alle Architektur- und Schemaentscheidungen für V1 stehen. Es blockiert nichts mehr.**

| ADR | Entscheidung |
|---|---|
| 0001 | SKY-ID bleibt kanonische Identität |
| 0002 | `sky_id` ist Primärschlüssel von `skylanders`, kein UUID-Surrogat |
| 0003 | Zuständigkeit je Datenbereich, einbahniger Datenfluss |
| 0004 | PortalVault liest nie direkt die Excel |
| 0005 | `collection_items`: Surrogat-PK, `user_id`, `sky_id`, `quantity`, Unique auf `(user_id, sky_id)` |
| 0006 | Katalog- und Preispflege bleiben in V1 im Legacy-System |
| 0007 | Preisupdate bleibt Legacy-Werkzeug |
| 0008 | `available`, Ankauffaktor und eBay-Daten werden nicht migriert |
| 0009 | Bilder statisch im Repository, Dateinamen unverändert |
| 0010 | `market_price numeric(10,2)`, **nullbar**, nie 0 statt unbekannt, keine `price_history` |
| 0011 | Lesbare Slugs, aber keine Datenbeziehung hängt am Slug |
| 0012 | Oberfläche nur Deutsch, i18n offengehalten |
| 0013 | Schlanker Testansatz: Lint, Typecheck, Build, Unit-Tests, RLS-Tests |
| 0014 | Kein zusätzlicher Backend-Service |
| 0015 | Supabase in der EU-Region |
| 0016 | Profile und Sammlungen privat, Katalog öffentlich lesbar und nicht benutzerseitig änderbar |
| 0017 | Anon-Key ist kein Secret; Grenze sind Auth, RLS und Policies |
| 0018 | SMTP-Anbieter erst vor der öffentlichen Beta |
| **0019** | **Technische Projektsprache ist Englisch. Oberflächensprache von V1 ist Deutsch.** |
| 0020 | Case-insensitive Benutzernamen über `unique index on lower(username)` statt `citext` |
| **0021** | **V1 ist Sammler- und Analyseplattform, kein Marketplace. Marketplace erst nach nachweislichem Nutzerwachstum** |
| 0022 | Free bleibt eigenständig nützlich; optionale Premium-Stufe als Richtung — Grenze und Preis **offen** |
| **0023** | **Meilenstein-Reihenfolge: Import → Auth → Katalog+Toggle+Sammlung → Ausbau → Beta** |
| **0011** | **Slug-Regel vollständig, an den echten 600 Artikeln verifiziert** |
| **0016** | **Benutzernamen sind änderbar; die UUID ist die Identität, `username` nie Schlüssel** |
| 0024 | Marktpreise gehören PortalVault; externe Quellen über stabile Kennung (Handle) statt Name — Umsetzung nach V1 |
| **0031** | **Entfernen ohne Bestätigungsdialog, dafür rückgängig zu machen; keine neue Toggle-Serverlogik** |
| **0032** | **Collector- und First-Party-Shop-Domäne sind getrennt; Berechtigung über eine echte Rolle, nie über eine E-Mail-Adresse** — dokumentiert, **nicht implementiert** |
| **0033** | **Fünf Preisebenen; Marktpreis ≠ Shoppreis; Bestellpositionen speichern einen Preis-Snapshot** — dokumentiert, **nicht implementiert** |
| **0034** | **Charakteridentität ≠ Sammelobjektidentität ≠ Anzeigevariante; Zuordnungen werden kuratiert, nicht aus Namen geraten** |
| **0035** | **Visuelle Richtung „Skylands Vitrine“; Token-System; `plate` als helle Bildbühne in beiden Themes** |
| **0036** | **Hauptnavigation mit drei Zielen; Abmelden gehört nach `/settings`; aktive Route aus dem Pfad** |
| **0038** | **Design V2: Katalog entdeckt (immer eine Serie), Sammlung zeigt nur Besitz; Karten ohne Rahmen, Besitz als Vitrinen-Chip statt Häkchen, dunkler Sammlungs-Kopfbereich** |
| **0037** | **Shop-Fundament: `shop_admins` statt `profiles.role`, Bestand ohne `user_id`, Menge + Bewegungsjournal, `condition` (`loose`/`boxed`) statt zweiter SKY-ID, öffentlich kein Stückzahl-Ausweis** — **umgesetzt in `0003`** |

## Offene Entscheidungen

Keine davon blockiert V1.2.

| ADR | Frage | nötig vor |
|---|---|---|
| 0022 | Welche Funktionen sind Premium, zu welchem Preis? Ist Menge/Duplikat Free oder Premium? | vor jeder Zahlungslogik, nicht vor V1.7 |
| — | Self-Service-Kontolöschung und Datenexport (DSGVO) in V1 oder später? | vor der Beta |
| 0032 | Wie wird `shop_admin` technisch getragen und vergeben? Fest steht nur, wo **nicht**: nicht an einer E-Mail, nicht auf `profiles` | vor jeder Shop-Schreiboperation |
| 0032 | Ist der Shop an dieselbe Wachstumsbedingung geknüpft wie der Marketplace (ADR-0021)? | vor jeder Umsetzungsplanung |
| 0033 | Sind Coupons mit automatischen Lager-Rabatten kombinierbar, und was hat Vorrang? | vor jeder Rabattlogik |
| 0033 | Endgültige Rabattschwellen und Prozentsätze (5/10/15 % sind Beispielwerte) | vor jeder Rabattlogik |
| 0033 | Coupon-Details: Gültigkeitszeitraum, Mindestbestellwert, Nutzungslimit, Einmalcodes | vor jeder Coupon-Struktur |
| — | Liefert das öffentliche Shop-Lesefenster eine Stückzahl oder nur einen Zustand? | vor jeder öffentlichen Shop-Anzeige |
| — | Welcher Payment-Provider? | vor jedem Checkout |
| — | Sind eBay-beigelegte Rabattcodes nach den dann geltenden eBay-Richtlinien zulässig? | vor jedem Werbemittel in eBay-Paketen |

---

## Nächster geplanter Schritt

**Zuerst: `supabase/migrations/0002_characters.sql` im Supabase-SQL-Editor ausführen**, danach
`npm run verify:rls` (erwartet 44/44) und `npm run characters:import -- --apply`.

**V1.6 — Ausbau.** Weitere Sammlungsansichten (kompakt, Tabelle), Fortschritt je Serie,
Mengen-/Duplikat-UI (**dabei die offene Grenze aus ADR-0031 mitlösen: ein „Rückgängig" setzt
die Menge heute auf 1 zurück**), Kategorie-Zwischenüberschriften im Katalog, Filter und Sortierung
innerhalb der Sammlung, Mobile-Feinschliff. Und Playwright, sobald die Sammlungs-UX steht
(ADR-0013).

Danach **V1.7** — Beta-Reife: Impressum, Datenschutzerklärung, produktiver E-Mail-Versand
(ADR-0018) und erst dann ein Deployment.

**Wartet auf die ausdrückliche Freigabe des Nutzers.**
