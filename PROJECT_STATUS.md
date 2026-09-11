# Projektstatus — PortalVault

Stand: 2026-09-10 · beschreibt den **aktuellen** Zustand, nicht die Historie.
Die vollständige Änderungshistorie liegt in Git.

---

## Aktuelle Phase

**Order-/Tracking-Hotfix gebaut, noch nicht angewandt (2026-09-11).** Nicht committet.

*Die Sendungsnummer war an das Versandereignis geschweißt* — an zwei Stellen: Der CHECK verlangte
eine bereits versendete Bestellung, und `orders_protect_fulfillment()` warf bei jeder Änderung
außerhalb des einen Übergangs. Die Nummer war damit nur im exakten Moment des Versands schreibbar
und danach nie wieder. Der reale Ablauf — Label kaufen, Nummer eintragen, später versenden,
gelegentlich ein Label stornieren und tauschen — war strukturell unmöglich.

*Jetzt zwei unabhängige Zustände* (ADR-0062): `fulfillment_status` beantwortet „ist es raus"
und wird unverändert bewacht, `tracking_number` beantwortet „welches Paket ist es" und ist vor wie
nach dem Versand setzbar. **`shipped_at` bewegt sich dabei nicht** — der Trigger pinnt es im
Nicht-Übergangs-Zweig ausdrücklich auf den alten Wert.

*Eine Korrektur verschickt nichts.* `admin_set_tracking_number()` ruft den Mailpfad gar nicht auf;
dahinter lägen ohnehin der Primärschlüssel von `order_mail` und die Endgültigkeit von `sent`.
Jede Änderung schreibt ein `tracking_updated`-Event — ohne die Nummer selbst in der Nutzlast, denn
ein Event wird von mehr Augen gelesen als die Bestellung.

*Der Trackinglink kommt aus einem zentralen Helfer*, benutzt von beiden Bestellseiten. Gebaut aus
`shipping_method_code`, nie aus dem Anzeigenamen, der umbenannt werden darf. Unbekannter Carrier →
**kein Link**, Nummer trotzdem sichtbar: Ein falscher Trackinglink schickt jemanden auf eine Seite,
die sagt, sein Paket existiere nicht. Die Referenz muss wie eine Sendungsnummer aussehen **und**
wird kodiert.

*Abmelden* steht jetzt auf der Einstiegsebene des Kontobereichs statt unter „Konto & Sicherheit" —
dort gehören Änderungen am Konto hin, und Gehen ist keine.

*Der Browser-Kauf im E2E ist sauber gelandet:* `SI-2026-001045`, `commerce_mode='sandbox'`, bezahlt
und versendet, Reservierung `converted`, **genau eine** `sale_skyisles`-Bewegung, SKY-0092/loose
1 → 0, beide Mails `sent` mit `attempts=1`, Ereigniskette `placed → payment_attempt_started →
payment_succeeded → order_shipped`. „Als Standard speichern" hat funktioniert, und die
Bestelladresse ist davon unabhängig als Snapshot festgeschrieben.

*Geprüft:* `npm run check` grün, **2010 Tests in 91 Dateien** (vorher 1960/89).

**Production unverändert.** `0019`–`0023` dort nicht angewandt.

---

**Account/Cart/Checkout-Hotfix gebaut, noch nicht angewandt (2026-09-11).** Nicht committet.

*Ein Befund aus dem manuellen Browsertest, und er ist der ernsteste bisher.* Artikel als Gast in
den Warenkorb, abmelden, mit einem anderen Profil anmelden — derselbe Warenkorb war noch da, und
das zweite Profil bekam die **offene Bestellung des ersten** angezeigt.

*Die Ursache ist ein Satz.* Jeder Zustand des Checkouts lag unter einem festen Schlüssel **ohne
Eigentümer**: der Warenkorb in `localStorage["skyisles.cart.v1"]`, die offene Bestellung und die
Capability in `sessionStorage`. Der Browser war die Identität, nicht das Konto — ein Kontowechsel
änderte an keinem dieser Schlüssel etwas.

*Die Datenbank hat nichts Falsches herausgegeben.* `authorize_order_payment()` hat die fremde
Bestellung korrekt verweigert; deshalb stand da überhaupt „gehört zu einer anderen Sitzung". Das
Leck war die Oberfläche, die eine fremde Bestellnummer anzeigte — und im ungünstigen Fall die
Capability desselben Tabs, denn die Autorisierung ist ein ODER aus Konto **oder** Capability.

*Der Warenkorb eines Kontos liegt jetzt in der Datenbank* (`cart_items`, RLS, dieselben vier
Eigentümer-Policies wie `collection_items` seit `0001`). Ein Schlüsselname verbirgt einen fremden
Warenkorb; eine Policy macht ihn unerreichbar. Gäste behalten `localStorage` — unter
`skyisles.cart.v2.guest`, mit dem Eigentümer im Namen. Der alte Schlüssel wird **verworfen, nicht
migriert**: Es lässt sich nicht feststellen, wem er gehörte, und zu raten ist genau der Fehler.
ADR-0043 hatte den serverseitigen Warenkorb unter „Nicht in dieser Runde" — es ist diese Runde.

*Jeder Browser-Schlüssel trägt einen Principal* (`guest` oder `u.<user_id>`), und bei jedem
Identitätswechsel fliegt der Zustand jedes anderen Principals aus dem Tab. Eine offene Bestellung
wird außerdem **erfragt statt geglaubt**: Ohne Bestätigung durch `order_payment_state()` wird der
Hinweis verworfen und der lokale Schlüssel gelöscht.

*Der Zahlungs-CTA kommt aus dem Zahlungszustand.* `order_payment_state()` liefert jetzt
`attempts`: 0 Versuche → „Zahlung starten", ≥ 1 → „Zahlung erneut starten", bezahlt oder geprüft →
gar kein CTA. Vorher wurde die Beschriftung daraus abgeleitet, *dass* eine Bestellung existierte.

*Gespeicherte Lieferdaten sind eine eigene Tabelle* (`customer_contacts`), nicht Spalten auf
`profiles`: Ein Profil ist die öffentliche Hälfte einer Identität, dies ist eine Postanschrift.
Speichern ist opt-in und standardmäßig aus. **Die Bestelladresse bleibt ein Snapshot** — `0022`
fasst `create_order()`, `order_addresses` und den Immutability-Trigger nicht an, und ein Test
prüft das am Migrationstext.

*Der Kontobereich hat eine Struktur.* `/account` mit vier Zielen — Profil · Kontakt &
Lieferadresse · Meine Bestellungen · Konto & Sicherheit. `/settings` ist ein permanenter Redirect.
„Meine Bestellungen" gab es bisher überhaupt nicht.

*Geprüft:* `npm run check` grün, **1960 Tests in 89 Dateien** (vorher 1876/84).

**Der Commerce Test Mode aus ADR-0060 bleibt vollständig erhalten** — `0022` fasst weder den
Modus, noch `commerce_testers`, noch die Stripe-Guards, noch den Sandbox-Stempel an.

**Production unverändert.** `0019`–`0022` dort nicht angewandt.

---

**Commerce Test Mode gebaut, noch nicht angewandt (2026-09-11).** Nicht committet.

*Eine Spalte, eine kleine Tabelle, ein Prädikat* (ADR-0060). `commerce_settings.mode` kennt
`closed`, `sandbox` und `live`; `commerce_testers(user_id)` sagt, wer im Sandbox-Modus kaufen
darf; `commerce_checkout_allowed()` ist die eine Antwort, die `create_order()` als **allerersten**
Ausdruck einholt — vor jeder Formprüfung, vor jeder Preisabfrage. Gastbestellung im Sandbox-Modus
ist strukturell aus: Ein Gast hat keine `user_id`, und `is_commerce_tester_for(NULL)` ist falsch.

*Kein Rollensystem.* Dieselbe Form wie `shop_admins` seit ADR-0032 — Tabelle mit `user_id`,
`is_…()`-Funktion, RLS an, alle Clientrechte entzogen. **Admin ist nicht automatisch Tester.**
Die Adminsuche darf eine Adresse lesen, um ein Konto zu *finden*; freigeschaltet wird die
`user_id`, und `admin_set_commerce_tester()` nimmt nichts anderes entgegen.

*Durchsetzung liegt in der Datenbank, nicht in der Oberfläche.* `create_order()` ist über
PostgREST mit dem Anon-Key erreichbar. Zwei weitere Stellen fragen noch einmal:
`authorize_order_payment()` verlangt im Sandbox-Modus, dass die Bestellung einem **aktuellen**
Tester gehört — ein entzogenes Recht stoppt damit auch schon geöffnete Checkouts —, und
`start_payment_attempt()` verlangt, dass der Modus der Bestellung noch der aktuelle ist.

*Der Modus steht auf der Bestellung und bleibt dort.* `orders.commerce_mode`, vom
Immutability-Trigger eingefroren, ohne Default, bestehende Zeilen wahrheitsgemäß auf `sandbox`
nachgetragen — es gab nie einen Live-Stripe-Schlüssel in irgendeinem Deployment. Eine
Testbestellung bleibt als solche erkennbar, auch Jahre nachdem der Shop live gegangen ist.

*Stripe hat genau eine Wahrheit.* Beide Edge Functions lesen den Modus aus der Datenbank.
`create-payment` vergleicht ihn mit dem Präfix des eigenen Schlüssels und verweigert **jede**
Unklarheit; der Webhook vergleicht ihn mit `STRIPE_LIVEMODE` und verarbeitet bei Widerspruch gar
nichts — `503`, damit Stripe die Zustellung behält. Es gibt bewusst keine `COMMERCE_MODE`-Variable.

`STRIPE_LIVEMODE` wird als `=== "true"` gelesen: Für `sandbox` und `closed` genügt es, die
Variable nicht zu setzen. Nur die exakte Zeichenkette `true` schaltet Live-Events frei.

*Testbestand: echter Bestand, mit einem Knopf zurück.* Ein Sandbox-Kauf läuft durch den echten
Reservierungs- und Bewegungspfad — das ist der Zweck — und `admin_revert_sandbox_stock()` bucht
für jede tatsächlich konvertierte Position eine `return`-Bewegung. Korrigiert wird durch neue
Bewegungen, nie durch Bearbeiten (ADR-0037). Idempotent über ein Order-Event, und jede Bestellung,
die nicht im Sandbox-Modus entstand, wird verweigert.

*Geprüft:* `npm run check` grün, **1869 Tests in 84 Dateien** (vorher 1798/82), alle fünf
Staging-Verifier grün, Secret-/PII-Scan sauber.

**Der Default ist `closed`.** Das Anwenden von `0021` schließt den Checkout, bis jemand ihn
bewusst öffnet — auf Production ist Schweigen die sichere Antwort. Auf Staging muss der Modus
nach dem Anwenden auf `sandbox` gesetzt werden, sonst schlagen die Commerce-Verifier fehl.

**Production unverändert.** `0019`, `0020` und `0021` dort nicht angewandt.

---

**Transactional Mail V1 auf Staging fertig und nachgewiesen (2026-09-11).**

*Drei Mails, und keine davon wird von der Datenbank verschickt.* Zahlungsbestätigung und
Versandbestätigung an den Kunden, Prüfhinweis an den Betreiber. Versendet wird ausschließlich in
`send-order-mail`, der dritten Edge Function — dem einzigen Ort, der `RESEND_API_KEY` kennt.
Vercel bekommt weiterhin kein Secret (ADR-0051).

*Was die Datenbank beisteuert, ist die eine Frage, die der Anbieter nicht beantworten kann:*
haben wir diese Mail schon übergeben, und dürfen wir sie noch einmal übergeben. `order_mail` hält
eine Zeile je (Bestellung, Art) mit vier Zuständen — und der vierte ist der eigentliche Entwurf:
**`unresolved`** heißt, dass niemand es sagen kann (409 auf dem Idempotenzschlüssel, Timeout,
abgestürzter Request). `sent` ist endgültig, auch gegen das Force-Flag: Resends Idempotenzfenster
sind 24 Stunden, danach wäre ein zweiter Versand eine zweite Mail im Postfach.

*Zwei Schranken übereinander.* `confirm_order_payment()` liefert `confirmed` genau einmal — ein
erneut zugestelltes Stripe-Event bekommt `duplicate_event` oder `already_confirmed`, und keiner
der beiden steht in der Mail-Zuordnung des Webhooks. Dahinter der Primärschlüssel von
`order_mail`. Dazu Resends eigener `idempotencyKey`, stabil je logischer Mail
(`skyisles/payment-confirmation/SI-…`), nie zufällig je Versuch.

*Mailfehler berührt keine Zahlung.* Der Versand liegt hinter dem committeten RPC, hält keine
Transaktion, fasst weder Bestellung noch Reservierung noch Bewegung an und wirft nie nach oben —
ein schlechter Moment beim Mailanbieter darf keine bestätigte Zahlung in einen Webhook-Retry
verwandeln.

*Unternehmensdaten als eigene Entität (ADR-0059).* `business_settings`, nicht zwei Spalten auf
`shop_settings`: die eine Tabelle sagt, was SkyIsles verlangt, die neue, wer SkyIsles ist. Heute
zwei Felder, weil heute zwei gebraucht werden; Betreibername, Anschrift und Steuerangaben kommen
mit dem Legal-Block in dieselbe Tabelle. Der einzige Weg nach außen ist
`business_settings_public()`, das seine Spalten **wörtlich** aufzählt und heute **an niemanden
vergeben** ist — eine Steuernummer kann nicht dadurch öffentlich werden, dass sie neu ist.
Die alte Regel „die Geschäfts-E-Mail kommt im Schema nicht vor" ist präzisiert: **Adressen
autorisieren nie**, und das gilt unverändert.

*Geprüft:* `npm run check` grün, **1798 Tests in 82 Dateien** (vorher 1691/77), alle fünf
Staging-Verifier grün, Secret-/PII-Scan sauber, keine Unternehmensangabe in Quelltext, Fixture
oder Test.

*Auf Staging end-to-end nachgewiesen (2026-09-11).* `0019` angewandt, Runtime-Suite 0–9 bestanden,
`send-order-mail` deployt. Eine echte Sandbox-Zahlung über Stripe (`SI-2026-001042`, 6,38 €):
Bestellung `paid`, Reservierung `converted`, **genau eine** `sale_skyisles`-Bewegung, Bestand
3 → 2, `reserved` zurück auf 0 — und **genau ein** `order_mail`-Satz `payment_confirmation`,
`sent`, mit Resend-Message-ID, vier Sekunden nach der Bestätigung.

*Die Wiederholung ändert nichts.* Dasselbe Event erneut an `confirm_order_payment()` →
`duplicate_event`, **keine** zusätzliche `payment_events`-Zeile. `claim_order_mail()` → `already_sent`,
**auch mit `force`**: `sent` ist endgültig, weil Resends Idempotenzfenster 24 Stunden sind. Bewegungen,
Bestand, `sent_at` und Message-ID unverändert.

*Versand und Betreiberhinweis.* Zweiter `admin_mark_order_shipped()`-Aufruf → `23514 already
shipped`. Zweiter und dritter Mailversuch → `already_sent`. Die geflaggte Fixture `SI-2026-001041`
bekam **ausschließlich** `resolution_alert` und **keine** Kundenbestätigung. Kein Mailpfad hat
Zahlung oder Bestand angefasst: `inventory_movements` und `payment_events` über alle Mailversuche
konstant.

> ### Dabei gefunden: `order_events` blockiert die Löschung eines Kontos
>
> `inventory_movements` erlaubt seit ADR-0037 **eine** Ausnahme von seiner Append-only-Regel: bei
> Löschung des Auth-Users darf `created_by` auf NULL anonymisiert werden, sonst wäre ein Konto, das
> je gebucht hat, dauerhaft nicht löschbar. **`order_events` hat diese Ausnahme nicht** — es nutzt
> das pauschale `deny_write()` aus `0010`, das jedes UPDATE verweigert, auch das der
> `on delete set null`-Fremdschlüsselaktion.
>
> Folge: Wer eine Bestellung aufgegeben (`placed`) oder versendet (`order_shipped`) hat, dessen
> Konto lässt sich nicht mehr löschen. Im E2E belegt: der temporäre Administrator, der versendet
> hatte, blieb stehen (`Database error deleting user`); der, der nur eine Mail auslöste, ließ sich
> entfernen. **Nicht von `0019` verursacht** und ein Datenschutzthema.
>
> **Behoben in `0020`, auf Staging angewandt und verifiziert am 2026-09-11.** Dieselbe Ausnahme
> wie bei `inventory_movements`: `actor_user_id` darf **nur verloren gehen**, und nur wenn `id`,
> `order_id`, `event_type`, `actor_kind`, `payload` und `created_at` unverändert bleiben. Alles
> andere bleibt verweigert — `DELETE` ohne Ausnahme, jedes gewöhnliche `UPDATE`, und auch eines,
> das die Anonymisierung mit einer Änderung zusammen schmuggeln will. `order_lines` und
> `order_addresses` behalten `deny_write()`: beide tragen keine Kontoreferenz und können deshalb
> keine Löschung blockieren. Damit ist `order_events` die dritte und letzte Tabelle, die diese
> Ausnahme braucht.
>
> Das gestrandete Konto ist entfernt: kein `@staging.invalid`-Konto mehr vorhanden. Sein
> `order_shipped`-Ereignis auf `SI-2026-001042` steht unverändert in der Historie, jetzt mit
> `actor_user_id = NULL` — 28 Ereignisse insgesamt, keines verloren. Die Regel gilt ab jetzt für
> jede neue Tabelle mit Kontoreferenz und Schreibschutz; nachgetragen in `docs/AUTH.md`.

*Die beiden Punkte, die nur von Hand zu prüfen waren, sind geprüft.* Eine **echte
Stripe-Sandbox-Redelivery** des `checkout.session.completed` zu `SI-2026-001042` erzeugte
**keine** zusätzliche `payment_events`-Zeile (5 Zeilen, 5 verschiedene `provider_event_id`) und
**keinen** zweiten Mailversuch: `payment_confirmation` steht weiterhin auf `attempts = 1`,
`sent`, mit unverändertem `sent_at`. Die Zustellung aller drei Mails ist im Anbieter-Dashboard
bestätigt; die Zahlungsbestätigung gilt dort als zugestellt. Gesendet wurde ausschließlich an die
eigene Testadresse.

**Production unverändert.** `0019` und `0020` dort nicht angewandt, keine Function deployt, kein
Secret gesetzt.

---

**Staging trägt jetzt den echten Katalog (2026-09-11).** Noch nicht committet.

*Warum überhaupt.* Staging enthielt zwei Figuren. Damit ließ sich kein Raster, keine Serie, kein
Namensumbruch und kein Shop-Zustand visuell beurteilen — der UX-Smoke wäre eine Prüfung an einer
leeren Bühne gewesen.

*Vier Schritte, alle aus dem Repository reproduzierbar.* Katalog (600 Zeilen, 561 Sammelfiguren,
6 Serien, 30 Kategoriezeilen) · 19 kuratierte Charaktere mit 104 Verknüpfungen · 24 freigegebene
Produktgruppen · 26 Shop-Positionen auf 21 Figuren. Keine Migration, keine Production-Daten,
keine erfundene Figur.

*Der Production-Guard davor.* `tools/lib/staging-guard.mts` vergleicht Origin **und**
Service-Role-Key exakt gegen `.env.local` und erlaubt nur das in `.env.staging` genannte Projekt.
Jedes staging-only Werkzeug ruft ihn **vor** der Client-Erzeugung. Nachgewiesen: fünf Werkzeuge
mit `--env-file=.env.local` gestartet → alle Exit 1, „Nothing has been written"; ein absichtlich
auf Production gebogenes `.env.staging` → ebenfalls Exit 1. Es gibt keinen umgebungsneutralen
schreibenden npm-Namen mehr (`:prod` / `:staging`).

*Produktgruppen und Shop gehen durch den echten Schreibpfad.* Beide Seeds legen einen temporären
Administrator an, rufen `admin_set_catalog_group()` bzw. `record_inventory_movement()` und
`set_shop_listing()` wie die Adminoberfläche, und entfernen das Konto im `finally`. Bestand
entsteht **ausschließlich** über Bewegungen; keine Zeile setzt `quantity` direkt.

*Idempotenz gemessen, nicht behauptet.* Zweiter `--apply`-Lauf des Shop-Seeds:
`inventory_movements` 32 → 32, Positionen 29 → 29, Gesamtbestand 69 → 69, „No movement was booked
and no stock changed." Der Seed bucht Differenzen, nie Zielwerte.

*Die Smoke-Historie ist unberührt.* `SI-2026-001041` weiterhin `needs_resolution`,
`SI-2026-001022` und `SI-2026-001040` weiterhin versendet, `SKY-9101` und `SKY-9998` mit
unveränderten Beständen. `image_override_path` ist auf **0** Figuren gesetzt und wird von keinem
Seed und keinem Import genannt; kein Werkzeug im Repository berührt den Storage-Bucket.

*Zwei Verifier-Kollisionen, beide älter als dieser Seed, beide behoben.* `verify:editorial` wollte
`series.position = 98`, das seit dem 2026-09-10 dem `SMOK`-Fixture gehört — auf 97 geändert.

*Der `verify:rls`-Idempotenzdefekt.* Sein Setup `insert`te die Serie `TEST` bedingungslos. Die
steht aber seit dem 2026-09-09, weil sein **eigenes** permanentes `SKY-9998` daran hängt und die
Fremdschlüssel `on delete restrict` sind — der Teardown konnte sie nie entfernen, prüfte seine
`delete`-Ergebnisse nicht und meldete trotzdem „catalog fixture removed". Jeder spätere Lauf starb
in Zeile eins des Setups an `series_pkey`.

Behoben durch **Besitz statt Annahme**: Setup schlägt Serie, Kategorie und Charakter zuerst nach
und legt sie nur an, wenn sie fehlen; ein `owned`-Record hält fest, was *dieser* Lauf erzeugt hat;
der Teardown entfernt genau das und lässt alles Vorgefundene stehen — mit Begründung im Log
(„kept (pre-existing, pinned by SKY-9998)"). `delete`-Fehler werden jetzt gemeldet statt
verschluckt. Zusätzlich bleibt `SKY-9998` an seiner bestehenden Kategorie: die Hostwahl war ein
`.limit(1)` ohne `order by` und hätte das permanente Fixture nach dem Katalogimport auf eine
beliebige Kategorie verschieben können. **Keine Assertion und kein Buchungsaufruf geändert** —
`check(`- und `.rpc(`-Zeilen im Diff: 0 hinzugefügt, 0 entfernt. Zwei Läufe hintereinander:
**105/105**.

*Was `verify:rls` dabei bewusst verändert.* Der Bestand von `SKY-9998/loose` wächst pro Lauf um 4
(+3 Einkauf, −1 Externverkauf, +1 Einkauf, +1 Korrektur). Das sind seine eigenen Prüfungen gegen
ein append-only-Journal — genau der Grund, warum dieses Fixture permanent ist. Identität, Slug,
Serie, Kategorie, Preis, Listung und `is_active` bleiben unverändert.

**Production unverändert.** Weder gelesen noch geschrieben.

---

**UX-Beta-Gate Phase 1 + 2 gebaut, auf Staging geprüft (2026-09-11).** Noch nicht committet.

*Die Plattform hat jetzt einen Eingang.* Der Review vom 11.09. hat keine Feature-Lücke gefunden,
sondern eine Eingangslücke: sorgfältig gebaute Oberflächen ohne Tür, ohne Schild und ohne
Fußzeile. Diese Phase baut genau diese drei Dinge — und **ADR-0025 bleibt unangetastet**: `/` ist
weiterhin der Katalog, es gibt keine Landingpage (ADR-0058).

*Zehn Punkte, und keiner davon ändert eine Geschäftsregel.* Fußzeile (auf allen öffentlichen und
angemeldeten Seiten, **nicht** im Adminbereich) · `/ueber-skyisles` · Nutzenversprechen und zwei
CTAs im Katalog-Hero, ausschließlich für Ausgeloggte · kontextabhängige Erklärung auf `/login`
und `/register` · Vertrauensblock im Checkout mit Stripe beim Namen · feldgenaue
Checkout-Validierung · `needs_resolution` als Zähler auf `/admin` und als Badge in der Navigation
· Rückfrage vor „Als versendet markieren" · `/shop` · Token-Drift behoben.

*Was die Fußzeile bewusst nicht enthält.* Impressum, Datenschutz, Widerruf, AGB und Kontakt sind
**nicht verlinkt**, weil es sie nicht gibt — ein toter Link ist schlechter als ein fehlender. Die
Plätze stehen als Liste in `site-footer.tsx`; `beta-surfaces.test.ts` schlägt fehl, sobald einer
davon verlinkt wird, ohne dass die Seite existiert.

*Die Rückfrage vor dem Versand ist die Antwort auf einen Fehler, der bereits passiert ist.*
`SI-2026-001022` wurde beim Smoke-Test durch einen Klick auf die falsche Zeile versendet markiert,
und `orders_protect_fulfillment()` verweigert korrekterweise die Rücknahme. Die Rückfrage nennt
jetzt Bestellnummer und Empfänger und sagt, dass nichts davon zurückgeht. **Am Trigger, an
`admin_mark_order_shipped()` und an `shipBlocker()` wurde nichts geändert.**

*`/shop` ist eine Sicht, kein zweiter Shop.* Dieselben zwei Aufrufe wie `/`, verbunden in
`shopEntries()`. Keine Migration, keine RPC, keine Stückzahl, und verborgene Figuren fallen dort
heraus, wo sie überall herausfallen.

*Was diese Phase ausdrücklich NICHT tut.* **Keine Bestellmail.** Der Review nennt den Kundenbeleg
als P0, und er bleibt offen: Mailversand ist ein eigenes Release-Gate (ADR-0018, ROADMAP V1.7),
und ein improvisierter Versand wäre schlechter als keiner. Ebenfalls nicht: Bestellhistorie im
Konto, Onboarding, globaler „Fehlen"-Modus, Admin-Vokabular, N+1 im Lager, SEO, `noindex`.

*Staging-verifiziert, nicht browser-verifiziert.* `npm run check` grün, **1641 Tests in 75
Dateien** (vorher 1525/66). Gegen `skyisles-staging` per HTTP geprüft: alle neuen Routen
antworten `200`, `/impressum` und `/kontakt` weiterhin `404`, Fußzeile auf fünf Seiten vorhanden,
Gast-Hero mit Nutzenversprechen und beiden CTAs, die drei Login-Kontexte einzeln durchgespielt,
`noindex` unverändert. **Browser-Automation stand nicht zur Verfügung** — es gibt keine visuelle
Prüfung und keinen Mobile-Smoke.

**Production unverändert.** Keine Migration, kein Deployment, kein Commit.

---

**Commerce V1 · Admin Orders V1 abgeschlossen und auf Staging verifiziert (2026-09-11).**

*Der Betreiber kann jetzt arbeiten.* Vor diesem Schritt landete eine bezahlte Bestellung nirgends,
wo sie jemand sieht: `0010` entzieht die Commerce-Tabellen jeder Client-Rolle und gibt `select`
nur über `*_select_own` zurück, also sah der Administrator — ein gewöhnlicher `authenticated`
Nutzer — **ausschließlich seine eigenen** Bestellungen. `/admin/orders` und
`/admin/orders/[orderNumber]` schließen das, über drei `security definer`-Funktionen, die
`is_shop_admin()` selbst fragen (Migration `0018`).

*Die Übersicht sortiert nach Arbeit, nicht nach Datum:* zu prüfen → zu versenden → offen →
erledigt. Die Regel steht einmal, in SQL. Nur die oberste Stufe ist laut.

*Was Versand ausdrücklich nicht tut.* Er bewegt **keinen Bestand, keine Reservierung, kein Geld** —
der Verkauf wurde bei `confirm_order_payment()` gebucht. Auf Staging gemessen: `quantity` und
`reserved` unverändert, keine zusätzliche Bewegung, `payment_attempts` und `payment_events`
unverändert.

*Vier Verweigerungen, und die dritte ist die wichtige.* Kein Administrator · nicht bezahlt ·
**`needs_resolution`** · bereits versendet. Eine geflaggte Bestellung ist bezahlt, aber es wurde
nichts konvertiert und kein Bestand gebucht (ADR-0050); sie zu versenden hieße, Ware
herauszugeben, die das Journal noch als vorhanden führt. Das Flag ist hier eine **Sperre**, die
Fulfillment niemals löscht — dafür sorgt zusätzlich der Trigger.

*Der Trigger ist Defense-in-Depth, nicht die Geschäftsregel.* `orders_protect_fulfillment()`
erlaubt genau `unfulfilled → shipped`, setzt `shipped_at` aus der Serveruhr (ein Aufrufer kann
kein Versanddatum nennen), macht die Trackingnummer nach dem Versand unveränderlich und verbietet,
dass Fulfillment `needs_resolution` mitverändert. Vor dem Bau geprüft: **nichts in der Datenbank
schrieb `fulfillment_status`**, der Guard bricht also keinen Payment-, Expiry- oder Cleanup-Pfad —
Abschnitt 4 der Runtime-Suite spielt beide nach.

*Trackingnummer:* optional, roh gespeichert, nur getrimmt. Keine Carrier-Erkennung, keine
Formatprüfung, keine URL — Carrier widersprechen sich, und ein Validator, der DHL kennt, würde
Hermes ablehnen.

*Staging-verifiziert.* `0018` angewandt, Runtime-Suite **8/8** (jeder Abschnitt legt seine eigene
Fixture an und rollt zurück), dazu ein manueller Browser-Smoke mit zwei echten Fixtures:
`SI-2026-001040` versandbereit, `SI-2026-001041` über den Late-Payment-Pfad erzeugt und damit
gesperrt. Reihenfolge, rotes Banner, gesperrter Versand und verschwundener Button bestätigt.

**Noch nicht gebaut:** Storno, Retoure, Teilversand, `completed`, Carrier-APIs, Rechnung,
Mailversand.

---

**Zuvor: Phase B2.4 (2026-09-11).**

*Die Kasse bezahlt jetzt.* Nach `create_order()` ruft die Anwendung selbst `create-payment` auf
und leitet zur Stripe Hosted Checkout Session weiter — keine Dev-Harness mehr. Der Button heißt
**„Zahlungspflichtig bestellen"**, weil die Zahlungspflicht ab B2.4 an dieser Stelle entsteht
(§ 312j Abs. 3 BGB); bis B2.3 war die neutrale Beschriftung die richtige.

*Der Browser nennt eine Zahl.* `{ order_id }`, dazu bei Gästen die Capability. Kein Betrag, keine
Währung, keine Position — alles davon liest `start_payment_attempt()` unter der Sperre aus der
Bestellung.

*`/checkout/erfolg` behauptet nichts.* Server-Shell, die eigentliche Frage stellt der Browser über
**`order_payment_state()`** (Migration `0017`). Der Redirect ist kein Beweis: Stripe schickt den
Kunden zurück, wenn die Session abschließt, und das ist nicht dasselbe Ereignis wie „Geld
angekommen" — die URL kann ohnehin jeder tippen. `session_id` wird in `src/` in **keiner**
Codezeile gelesen. `needs_resolution` schlägt jeden Status, auch `paid`: eine spät bezahlte,
unreservierte Bestellung bekommt nie „unterwegs" zu sehen.

*Warum überhaupt eine neue Funktion.* Angemeldete Kunden lesen ihre Bestellung über
`orders_select_own`. **Gäste können das nicht** — `0010` hielt das ausdrücklich fest — und Gäste
sind der größere Teil des Shops. `0017` ist der fehlende Leser: `stable`, vier Spalten, keine PII,
keine IDs, kein `is_paid`, kein `currency`. Autorisierung **ruft `authorize_order_payment()` aus
`0013` auf statt sie zu kopieren**. Unbekannte und unautorisierte Bestellung liefern dasselbe
leere Ergebnis — die Antwort unterscheidet nichts.

> ### `SI-2026-001022` — die Referenzbestellung, und warum sie jetzt „versendet" ist
>
> Sie bleibt die **historische erste echte Stripe-E2E-Referenz**. Alles, was sie dazu macht, ist
> unverändert: der Zahlungsversuch, die `cs_test_…`-Session, `payment_succeeded`, `paid_at`, die
> konvertierte Reservierung und die eine `sale_skyisles`-Bewegung.
>
> Am 2026-09-11 wurde sie beim Admin-Orders-Smoke **zusätzlich** über die Oberfläche als versendet
> markiert — ein Klick auf die falsche Bestellung. **Das ist kein Datenfehler und wird nicht
> korrigiert.** Der Versand hat nachweislich weder Bestand noch Geld bewegt: `quantity` und
> `reserved` unverändert, keine zusätzliche Bewegung, `payment_attempts` und `payment_events`
> unverändert.
>
> Zurückgedreht wird nichts. `orders_protect_fulfillment()` verweigert `shipped → unfulfilled` und
> jede Tracking-Änderung — genau wie entworfen —, und `order_events` ist append-only: das
> `order_shipped`-Ereignis bliebe ohnehin stehen. Eine Zeile zurückzusetzen, deren Journal den
> Versand weiter zeigt, wäre unehrlicher als der Ist-Zustand. **Kein Trigger wird dafür
> abgeschaltet, keine Staging-Historie manipuliert.**

*Zwei Browser-Bugs, im manuellen Smoke gefunden.* Back von Stripe stellte das Dokument aus dem
**bfcache** wieder her, React-State eingeschlossen: `redirecting` blieb `true`, der Button blieb
gesperrt, die Bestellung unbezahlbar. Ein bfcache-Restore ist kein Mount — kein Effect läuft,
nichts initialisiert sich —, `pageshow` ist die einzige Stelle, an der es auffällt. Ohne bfcache
lud `/checkout` **ohne** `?order=` neu und zeigte „Warenkorb leer", während die Bestellung Bestand
hielt; `recallOpenOrder()` holt sie jetzt aus dem Tab-State zurück. Beide Pfade sind manuell
gegengeprüft.

*Staging-verifiziert.* `0017` angewandt, Autorisierung in zehn Prüfungen belegt (Eigentümer ja,
fremd nein, unbekannt nein, anon nein, Token ja, falsch/leer/null nein, Replay nein, kein direkter
Tabellenzugriff). Gast- und Auth-Checkout durchlaufen, Redirect zu Stripe, Abbruch und Rückkehr,
Wiederaufnahme derselben Bestellung — **ohne neuen Testkauf**.

**Production unverändert.** `0017` ist dort **nicht** angewandt, `stripe-webhook` nicht deployt,
kein Live-Stripe, `pg_cron` weiterhin nur auf Staging.

---

**Zuvor: Phase B2.3 (2026-09-11).**

*Der Kreis ist geschlossen.* `stripe-webhook` ist die zweite Edge Function und die einzige Stelle,
die sagen darf, dass Geld angekommen ist. Am 2026-09-11 lief zum ersten Mal die **vollständige
Kette über den echten Anbieter**: Kasse → `create_order()` → `create-payment` → Stripe Checkout
im Sandbox-Modus → **echte Testzahlung** → von Stripe **signierter** `checkout.session.completed`
→ `confirm_order_payment()` → Reservierung konvertiert → **Bestand genau einmal gebucht**.

Bestellung `SI-2026-001022`: Versuch `succeeded` über 9,31 EUR, Bestellung `paid` ohne
`needs_resolution`, Reservierung `converted` mit ihrer Bewegung, **eine** `sale_skyisles`-Zeile,
`quantity` 2 → 1, `reserved` zurück auf 0.

*Und die Probe, die zählt.* Dasselbe Event wurde über Stripe **erneut zugestellt**. Danach: immer
noch **eine** `payment_events`-Zeile mit unverändertem `received_at`, **ein** Verkauf, derselbe
`movement_id`, kein zweites `payment_succeeded`. Nicht „dasselbe Ergebnis noch einmal berechnet",
sondern dieselbe Zeile, unberührt. Das ist der Vertrag aus `0012`: nie halb verkauft, nie
überverkauft.

*Wie wenig die Function tut.* Signaturprüfung über das **offizielle Stripe-SDK**
(`constructEventAsync()` mit `createSubtleCryptoProvider()`, ADR-0054), Feldextraktion, ein Router
auf zwei bestehende Datenbankfunktionen. Kein eigener HMAC, keine eigene Idempotenzlogik, kein
CORS, kein Stripe-API-Key — die Function kann nicht abbuchen, erstatten oder verfallen lassen.
Die Zuordnung läuft ausschließlich über `checkout.session.id` gegen `provider_payment_id`;
`metadata` ist niemals Wahrheit. **Keine Migration.**

*Die Falle, die `payment_status` heißt.* `checkout.session.completed` bedeutet bei asynchronen
Methoden „Kunde fertig, Geld noch nicht da". Bestätigt wird nur bei `status = complete` **und**
`payment_status = paid`. **Asynchrone Zahlungsmethoden sind für V1 im Stripe-Dashboard
deaktiviert** (ADR-0055); die Handler für `async_payment_succeeded` und `async_payment_failed`
existieren trotzdem, defensiv.

*Über SQL runtime-verifiziert* (`supabase/tests/webhook_runtime_verification.sql`, sieben Abschnitte, alle
in `begin … rollback`, spurlos): Happy Path, fünffache Zustellung → ein Verkauf, Late Payment über
`expired → succeeded`, Betragsabweichung, unbekannte Session bleibt unverarbeitet und retrybar,
`expired`/`failed` schließen den Versuch ohne Bestellung und Hold anzufassen.

**Production unverändert.** `stripe-webhook` ist **nur** auf `skyisles-staging` deployt, es gibt
dort keinen Production-Webhook-Endpoint und kein Live-Secret. `pg_cron` bleibt ebenfalls
ausschließlich auf Staging.

---

**Zuvor: Phase B2.2b (2026-09-10).**
Migrationen `0014`, `0015` und `0016` sind auf `skyisles-staging` **und auf Production** angewandt
und in beiden Umgebungen gegen eine echte Datenbank geprüft — auf Production mit einem realen
Checkout-/Reservierungs-Smoke. **Der Checkout funktioniert dort damit wieder** (ADR-0053).
`pg_cron` ist ausdrücklich **nur auf Staging** eingerichtet und bleibt für Production ein eigener
späterer Release-Schritt.

*Neu und real:* die Edge Function `create-payment` (`supabase/functions/create-payment/`), deployt
auf `skyisles-staging` mit einem Stripe-**Test**schlüssel in den Function-Secrets. Sie ist der
einzige privilegierte Aufrufer der Payment-Funktionen; Service-Role-Key und Stripe-Secret
existieren im Webdeployment weiterhin nicht (ADR-0051). **Kein Stripe-SDK** — die Function spricht
Stripes REST-API direkt. **Weiterhin nicht vorhanden:** Webhook, Payment-Oberfläche, Production-Deployment der Function,
`pg_cron` auf Production.

*Der erste echte Zahlungsvorgang.* Order 16 (`SI-2026-001015`) auf Staging: ein Klick, genau ein
`payment_attempt`, Status `pending`, 9,31 EUR, eine Stripe Checkout Session (`cs_test_…`) mit
gespeicherter Checkout-URL — und **nichts sonst hat sich bewegt**: Bestellung weiter `pending`,
`paid_at` null, `needs_resolution` false, Reservierung `active` und nicht konvertiert,
`reserved = 1`, `available = 1`, **null `sale_skyisles`-Bewegungen**. Genau so soll es sein: eine
Checkout-URL heißt, dass jemand bezahlen *kann*, und sonst nichts. Verkauft wird erst durch
`confirm_order_payment()` — und den Auslöser dafür baut B2.3.

*Was zwei Läufe gekostet hat, und jetzt geprüft wird.* Erstens der Stock-Hold: 20 Minuten, und
`start_payment_attempt()` verlangt `expires_at > now()`. Nichts räumt abgelaufene Holds weg
(`pg_cron` ist aus), eine Reservierung steht also noch lange auf `active`, nachdem sie aufgehört
hat zu zählen — `verify-payment-smoke.mts` prüft deshalb die Uhr, nicht nur den Zustand. Zweitens
CORS: `x-client-info` fehlte in `Access-Control-Allow-Headers`, der Preflight antwortete `204`,
und der Browser verwarf den POST trotzdem stumm. Regel und Test dazu in `docs/SECURITY.md` §6.

> ### Der Checkout war seit `0010` funktionsunfähig
>
> `create_order()` legte die Bestellung mit Nullbeträgen an und aktualisierte sie unmittelbar
> danach — was `orders_protect_immutable()` aus derselben Migration verbietet. Jeder Aufruf warf
> `23001` und rollte zurück. **Es konnte keine Bestellung entstehen, in keiner Umgebung**, und es
> gab keine Eingabe, die daran vorbeikam. Dass Production bis dahin null Bestellungen zählte, war
> keine Aussage über Kundschaft. `0016` hat es behoben (ADR-0053) und ist angewandt — auf Staging
> wie auf Production.
>
> **Warum 1305 Tests das nicht sahen.** Jeder Test dieser Funktion ist eine Zusicherung über
> Dateitext. `schema.test.ts` behauptet in derselben Datei, dass der Trigger die Beträge einfriert
> *und* dass `create_order()` sie aktualisiert — beide Aussagen stimmen für sich, und kein
> Textvergleich sieht den Widerspruch. Ausgeführt worden war die Funktion nie. Gefunden hat es die
> neue Staging-Runtime-Suite im dritten Lauf.

*Neu in dieser Phase.* Ein wegwerfbares Staging-Projekt mit vollständig nachgespielter
Migrationskette `0001`–`0016` (`docs/DEPLOYMENT.md`) · `supabase/tests/0015_runtime_verification.sql`,
die erste Prüfung dieses Projekts, die Commerce-Schreibvorgänge **wirklich ausführt** · `0015` mit
dem Übergang `expired` → `succeeded` (ADR-0052), `amount_to_cents()`, dem erweiterten
`start_payment_attempt()` und dem Leser `pending_payment_expiries()` · `0016` mit den endgültigen
Beträgen vor dem INSERT (ADR-0053) · `0014` entfernt die alte `create_order`-Signatur.

*Was daraus folgt.* Statische Zusicherungen über SQL-Text finden diese Fehlerklasse nicht. Vor
jedem weiteren Commerce-Schritt gilt: erst Staging, dann Production.

**Zuvor: Phase B2.1 (2026-09-08).** Migration `0012` ist angewandt und runtime-verifiziert. Der
Payment-Core steht — **ohne Zahlungsanbieter**. Nichts in der Anwendung ruft ihn auf.

*Neu.* `payment_attempts` und `payment_events`, dazu `start_payment_attempt()`,
`attach_provider_payment()`, `confirm_order_payment()`, `fail_payment_attempt()` und
`expire_stale_checkouts()`. **Alle fünf sind allen Client-Rollen entzogen** — der privilegierte
Aufrufer wird eine Supabase Edge Function (ADR-0051).

*Der eine Vertrag.* Eine bestätigte Zahlung schließt die **ganze** Bestellung ab — Reservierungen
konvertiert, Bestand gebucht, eine `sale_skyisles`-Bewegung je Position — oder sie schließt
**keine** davon ab und markiert `needs_resolution`. Nie halb verkauft, nie überverkauft.

*Dreifach idempotent.* Das Event (`unique (provider, provider_event_id)`), die Bestellung
(`paid_at is null`) und jede Reservierung (unter Sperre beansprucht). Ein Anbieter, der dasselbe
Event fünfmal liefert, bucht einen Verkauf.

*Drei Defekte im Audit vor der Migration gefunden und behoben:* ein Event galt als erledigt, sobald
seine ID eingefügt war — ein Webhook vor `attach_provider_payment()` hätte die Bestellung dauerhaft
unbezahlt gelassen; ein abweichender Betrag ließ den Versuch offen hängen; der Sweep konnte eine
zur Prüfung markierte Bestellung stillschweigend ablaufen lassen.

*Runtime verifiziert (51 Prüfungen, ohne einen einzigen Schreibvorgang).* Alle Spalten vorhanden,
kein `payload`-Feld, alle fünf Signaturen exakt, keine Überladung nimmt einen Betrag oder ein
Secret entgegen, `anon` kann nichts lesen, schreiben, ändern, löschen oder ausführen, die
öffentliche RPC-Oberfläche ist unverändert — und alle fünf Funktionsrümpfe wurden tatsächlich
ausgeführt und griffen an ihren Wächtern. Bestellungen, Reservierungen, Versuche und Events stehen
weiterhin auf 0.

> **Nächster Schritt:** Transactional Mail (Resend, `mail.skyisles.app`) — Zahlungs- und
> Versandbestätigung plus interne `needs_resolution`-Warnung. Danach Rechtstexte, dann der Rollout
> nach Production als eigener Release-Schritt — Migrationen `0017` und `0018`,
> beide Edge Functions, Webhook-Endpoint, Live-Secret, `STRIPE_LIVEMODE=true`, `ALLOWED_ORIGINS`
> mit der echten Origin, `pg_cron`. Davor fehlen weiterhin Mailversand und die Rechtstexte.

### Voraussetzungen vor B2.3

| | Warum |
|---|---|
| ~~Stripe-Konto~~ **erledigt** | Testschlüssel liegt in den Function-Secrets von `skyisles-staging`; der Live-Schlüssel gehört ausschließlich nach Production. PayPal (EWR) steht weiterhin aus. |
| `pg_cron` aktivieren | Erst wenn echte Reservierungen entstehen. Exakte Anweisung in `docs/DEPLOYMENT.md` |
| ~~**Staging-Supabase-Projekt**~~ **erledigt** — `skyisles-staging` | War vor B2.3 zwingend. Production kann keinen echten Nebenläufigkeitstest tragen: Bestellzeilen sind append-only, Bestellungen `on delete restrict` — eine Testbestellung wäre unlöschbar. Stripes Testmodus hilft nicht, weil eine Test-Zahlung trotzdem echte Zeilen in die verbundene Datenbank schreibt. |
| Mailversand | Nicht blockierend für B2, aber vor echten Kunden nötig und vor öffentlichem Release Pflicht |

### Danach vorgemerkt: Account-/Profil-Phase

Der Profil-/Account-Bereich wird nach B2 neu strukturiert — **jetzt nicht zu bauen**, aber B2 darf
nichts dagegen arbeiten. Vorgesehene Unterbereiche: Übersicht · persönliche Daten · Kontakt- und
Lieferdaten · Einstellungen · Bestellungen · Sammlung · Warenkorb · Sicherheit.

**Die eine Regel, die dabei zählt:** Gespeicherte Lieferdaten dürfen den Checkout später
**vorbefüllen**, aber niemals den Adress-Snapshot der Bestellung ersetzen. Eine Bestellung
erinnert sich daran, was abgeschickt wurde (ADR-0049) — eine später geänderte Profiladresse darf
nicht rückwirkend verändern, wohin ein Paket ging. Die Bestellhistorie setzt auf der bestehenden
`orders`-RLS auf; Gastbestellungen brauchen den Token-Zugang.

**Commerce V1 · Phase B1 abgeschlossen und produktiv (2026-09-08).** Migration `0011` ist auf
Production angewandt und verifiziert. Die Kasse existiert: Adresse, Versandart, serverseitige Berechnung, Bestellung und Reservierung. **Ohne
Zahlung** — B1 endet bei einer angelegten, reservierten, unbezahlten Bestellung, und die
Oberfläche sagt das ausdrücklich.

*Feste Produktentscheidungen.* Lieferung **nur nach Deutschland**. Zwei Versandarten:
**Hermes 5,49 €** (vorausgewählt) und **DHL 6,49 €**. **Ab 75,00 € Warenwert** ist beides
kostenlos; die Schwelle misst `items_subtotal`, also den Warenwert vor Rabatten. Keine Gewichts-,
Größen- oder PLZ-Staffeln, keine Packstation — das kommt später.

*Steuermodell.* SkyIsles wird unter der **Kleinunternehmerregelung (§ 19 UStG)** betrieben. Die
Bestellung speichert das als unveränderlichen Snapshot `tax_regime = 'small_business_19'` —
**ausdrücklich kein `tax_rate = 0`**: ein Nullsatz wäre ein steuerbarer Umsatz mit 0 %, § 19 ist
die Nichterhebung. Der Unterschied ist in der Rechnung entscheidend. Kein Netto, keine USt-Zeile,
kein „inkl. MwSt." — nirgends.

*Eine Regel, ein Ort.* Der Versandpreis lebt ausschließlich in `shipping_amount_for()`. Die Kasse
zeigt an, was diese Funktion sagt, und `create_order()` berechnet damit, was tatsächlich berechnet
wird — der Browser wählt einen Anbieter und **niemals** einen Preis. In TypeScript steht kein
einziger Betrag.

*Reservierung unverändert.* Das Öffnen der Kasse hält nichts. Erst beim Absenden werden Preise neu
gelesen, Verfügbarkeit neu geprüft, der Versand bestimmt und der Bestand atomar reserviert — 20
Minuten, wie gehabt. Kein neuer Zeitgeber, keine neue Infrastruktur.

*Warenkorb.* Neuer CTA „Zur Kasse". Nach erfolgreicher Bestellung wird der Warenkorb geleert —
Bestellung und Reservierung existieren dann wirklich, und ein stehengebliebener Korb lüde dazu
ein, denselben Bestand ein zweites Mal zu blockieren. Bei **jedem** Fehler bleibt er unangetastet.

*Runtime verifiziert.* Gegen Production geprüft, ohne eine einzige Bestellung zu erzeugen:
Versandpreise an allen Schwellen (0 / 10 / 74,99 → 5,49 · 6,49; 75 / 75,01 / 200 → 0,00), Hermes
erste und vorausgewählte Option, die alte vierstellige `create_order()`-Signatur ist weg, ein
Nicht-DE-Land und eine unbekannte Versandart werden **vor** jedem Schreibvorgang abgewiesen, und
für `p_shipping_amount`, `p_total_amount`, `p_items_subtotal`, `p_discount_amount` und
`p_tax_regime` existiert schlicht kein Parameter. Alle neun internen Funktionen für `anon`
gesperrt, alle fünf Bestelltabellen weder les- noch schreibbar, Bestand unverändert.

*Ein Defekt, gefunden und behoben.* `shipping_quote()` war zunächst als INVOKER deklariert und rief
zwei für Clients gesperrte Funktionen auf — die Kasse hätte gar keine Versandarten angezeigt
(die Berechnung wäre korrekt geblieben, `create_order()` rechnet selbst). Behoben mit
`security definer`, wie es `shop_offers()` seit `0006` macht. Ein neuer Test fängt die Fehlerklasse
generisch ab: jede an Clients gegrantete Funktion, die eine gesperrte interne Funktion aufruft,
muss Definer sein.

*Domain.* Die kanonische Production-Adresse ist **`https://skyisles.app`**; die alte
Vercel-Adresse ist keine kanonische Domain mehr. `noindex, nofollow` bleibt bis zum Beta-Gate
aktiv.

> **Nächster Schritt:** Phase B2 (Zahlung). Blockierend bleiben Zahlungsanbieter, Mailversand und
> eine Staging-Umgebung für den Nebenläufigkeitstest.

**Commerce V1 · Phase A abgeschlossen und produktiv (2026-09-07).** Migration `0010` ist auf
Production angewandt, der Commerce-Kern liegt live in der Datenbank: Bestellungen können entstehen
und Bestand kann atomar reserviert werden — ohne Zahlungsanbieter, ohne Checkout-Oberfläche, ohne
Rechnung, ohne E-Mail. **Es gibt noch keine Oberfläche, die eine Bestellung auslöst**, entsprechend
0 Bestellungen und 0 Reservierungen im Normalbetrieb.

*Neu (Migration `0010`, angewandt und gegen Production verifiziert).* `orders`, `order_lines`,
`order_addresses`, `order_events`, `order_reservations`; dazu `create_order()`,
`reserve_for_order()`, `release_expired_reservations()`, `release_order_reservations()`,
`convert_order_reservations()` und die Abgleichs-View `reservation_reconciliation`.

*Zwei Zustandsachsen.* Zahlung und Erfüllung stehen getrennt. Widerruf, Retoure und Reklamation
sind ausdrücklich **keine** Bestellzustände und kommen später als eigene Vorgänge (ADR-0049).

*Reservierung.* Ein Warenkorb reserviert nichts, ein Checkout reserviert alles oder nichts.
Sperren in fester `id`-Reihenfolge, Verfügbarkeitsprüfung in der `WHERE`-Klausel, 20 Minuten
serverseitig, abgelaufener Halt wird synchron im Checkout geräumt (ADR-0050). `shop_inventory.reserved`
wird damit erstmals geschrieben — die Spalte existiert seit `0003` genau dafür.

*Bestand unverändert.* `quantity` sinkt bei einer Reservierung **nicht**, und es entsteht keine
Bewegung: verkauft ist noch nichts. `convert_order_reservations()` ist gebaut und idempotent, wird
aber von nichts gerufen — die Zahlungsphase ruft sie.

*Missbrauchsschutz.* `create_order()` hält echten Bestand und bleibt ohne Konto aufrufbar — ein
Skript könnte damit Einzelstücke dauerhaft blockieren. Die Grenze liegt deshalb **in der
Datenbank**: Server-Action und direkter RPC-Aufruf kommen über den öffentlichen Anon-Key als
dieselbe Rolle an, eine Prüfung in TypeScript wäre umgehbar. `enforce_checkout_limits()` zählt
offene Checkouts, gehaltene Stückzahl und Bestellungen pro Stunde je Identität — Konto, E-Mail
**oder** salted Client-Fingerabdruck. Keine rohe IP wird gespeichert, kein Zähler-Backend, kein
CAPTCHA.

*Invarianten.* `greatest(0, …)` ist raus: Freigabe und Konvertierung senken `reserved` nur unter
`where reserved >= quantity` und werfen sonst `data_corrupted`. Halbe Übergänge sind damit
unmöglich.

*Bewusst offen:* Steuer-/Rechnungssemantik (Steuerberater) und Zahlungsanbieter. Keine Steuerfelder,
keine Provider-Felder, `shipping_amount = 0`, kein SDK, keine Env-Variable, kein Webhook.

*Runtime-Security geprüft.* `npm run verify:commerce` läuft gegen Production und meldet **30/30**:
Reconciliation-Drift 0, `reserved` und `held` je 0 über 222 Positionen, alle Commerce-Tabellen für
`anon` weder les- noch schreibbar, alle acht internen Funktionen abgewiesen (42501), und
`create_order()` als einzige öffentliche Commerce-Schreibfläche erreichbar.

*Client-Fingerabdruck produktiv bestätigt.* `request.headers` und `x-forwarded-for` sind im
PostgREST-Aufrufpfad verfügbar, `request_client_hash()` liefert einen 64-stelligen Hex-Digest —
ohne dass dafür eine Bestellung erzeugt oder ein Recht geöffnet werden musste. Damit ist der offene
Runtime-Smoke der Vorrunde geschlossen.

*Eine Korrektur nach dem Anwenden.* `reservation_ttl()` und `next_order_number()` waren zunächst
für `anon` ausführbar: `0010` hatte sie nur `from public` entzogen, während Supabase über
Default-Privileges zusätzlich **explizite** EXECUTE-Grants an `anon` und `authenticated` vergibt.
Beide wurden produktiv nachgezogen, die Migration im Repository entspricht jetzt demselben Stand,
und ein neuer Test prüft die Regel generisch für **jede** Funktion der Migration — er hätte den
Fehler vor dem Anwenden gefunden.

> **Nächster Schritt:** Phase B (Checkout ohne Zahlung). Blockierend bleiben Steuerstatus,
> Zahlungsanbieter, Mailversand, Lieferländer und Versandkosten.

**V11 ausgeliefert (2026-09-07).** Zwei Warenkorb-Probleme. Migration `0009` ist angewandt,
der Code ist produktiv.

*Mengengrenze.* Der Warenkorb zählte, so hoch er wollte — das Zahlenfeld auf `/cart` nahm eine
getippte 99 entgegen, ohne dass jemand den Bestand gefragt hätte. Neu: `shop_quantity_available()`
(Migration `0009`) beantwortet „wäre **diese** Menge gerade möglich" mit einem **Boolean**. Keine
Bestandszahl verlässt die Datenbank; ein `allowed_quantity`-Feld wurde geprüft und verworfen. Alle
drei Add-Wege — Katalogpille, Figurenseite, Plus auf `/cart` — gehen durch denselben geprüften
Pfad und sind **fail closed**. Das freie Zahlenfeld ist einem Stepper `−  n  +` gewichen.

*„Schon im Warenkorb".* Die Katalogpille zeigt in kräftigerem Gold und mit einem Haken im
Warenkorbsymbol, dass diese Figur bereits im Korb liegt. Gleiche Geometrie, gleiche Bedeutung: der
Knopf bleibt **Hinzufügen**, kein Toggle, kein Mengen-Badge auf der Karte.

*Unverändert:* lokaler Warenkorb, ein Store, keine Reservierung, keine Bestellung, kein Checkout.

*Rollout.* Migration `0009` angewandt, danach `shop_quantity_available()` und
`max_cart_quantity()` direkt gegen Produktion geprüft (anon-Rolle, 18/18): Boolean-Contract,
`false` für unbekannte SKY-ID, unbekannte Condition, Menge 0/-1/100 und 99; `max_cart_quantity()`
= 99; `shop_inventory` und `inventory_movements` für `anon` weiterhin nicht lesbar (`42501`);
`shop_offers()` weist `quantity`, `reserved`, `available_quantity`, `note` und `unit_cost` an der
Signatur ab (`42703`). Bestand unverändert, Journal-Drift **0**. `verify:shop` 17/17,
`verify:inventory` 34/34, `verify:rls` 105/105. Deployment-Smoke gegen die Produktions-URL: `/`, `/cart` und eine
Figurenseite je HTTP 200, kein freies Zahlenfeld mehr auf `/cart`, Pille/FAB/Toast-Region wie
erwartet.

*Nachgezogene Prüfung.* `verify:rls` trug noch die Zusicherung „listing without a price is
refused" aus der Zeit vor `0008` und stand deshalb bei 102/103. ADR-0048 hat den Preiszwang aus
`set_shop_listing()` bewusst entfernt; die Prüfung ist jetzt umgedreht und prüft beide Hälften der
Entscheidung getrennt: eine Freigabe **ohne** Preis ist als Admin-Zustand erlaubt, und das
öffentliche `shop_offers()` führt trotzdem kein Angebot ohne effektiven Preis. Keine Migration,
keine Semantikänderung, `set_shop_listing()` unangetastet.

> **Offen — manueller Smoke auf einem echten Telefon (~390 px).** In dieser Umgebung ist keine
> Browser-Automatisierung verfügbar; alle Interaktionsschritte sind ungeprüft. Zu prüfen:
> Hinzufügen → Toast → Pille wird goldener und zeigt den Haken → FAB-Badge steigt → erneutes
> Hinzufügen meldet „Menge im Warenkorb erhöht" → `/cart` zeigt nur `−  n  +` → Plus erhöht erst
> nach Serverprüfung → an der Bestandsgrenze bleibt die Menge stehen und es erscheint „Keine
> weitere Menge verfügbar." ohne Stückzahl → Minus und Entfernen → zurück zum Katalog, Reload und
> Cross-Tab: Warenkorb bleibt erhalten.


**V10 gebaut (2026-09-07).** Reine Warenkorb-UX, keine Migration, keine Architekturänderung.

*Kaufknopf.* Er benennt sich nicht mehr kurzzeitig in „Im Warenkorb" um — vorher, während und
nachher steht dort derselbe Preis. Ein weiterer Tipp erhöht wie bisher die Menge.

*Toast.* Bestätigt wird stattdessen in einer dauerhaft im Baum stehenden Live-Region
(`role="status"`, `aria-live="polite"`): „Zum Warenkorb hinzugefügt" bzw. „Menge im Warenkorb
erhöht", mit einer kleinen Detailzeile. Ein Modul-Store derselben Bauart wie der Warenkorb hält
**eine** Nachricht und den Timer; die Komponente ist ein reiner Leser ohne Effekt. 2,6 s sichtbar,
blockiert nichts, kein Dialog.

*Schwebender Warenkorb.* Runder Knopf (3,25 rem) unten rechts, 10 px über der unteren Leiste,
mit Zähler-Abzeichen oben rechts. **Immer sichtbar** auf dem Telefon, nicht erst mit Inhalt — das
Abzeichen kommt mit dem ersten Artikel. Nicht auf `/cart`, nicht für Admins, nicht ab `md:`.
Knopf und Toast hängen jetzt **außerhalb** des `backdrop-blur`-Headers, damit `position: fixed`
in jeder Engine gegen den Viewport rechnet.


**V9 gebaut (2026-09-07).** Reine UX, keine Migration, keine Architekturänderung.

*Kartengeometrie.* Jede Sammlerkarte hat dieselben festen Zonen — Bild, Name, Informationszeile
(Marktpreis links, Element rechts) und eine gemeinsame **Fußzeile**: `Info` links, der Kauf
rechts, falls es einen gibt. Die Zeile wird bedingungslos gerendert und bringt ihr eigenes
`min-h-10` mit, der Rand darüber ist konstant — deshalb sind eine kaufbare und eine nicht
kaufbare Karte exakt gleich hoch, ohne einen einzigen zustandsabhängigen Rand. Gegenüber der
ersten V9-Fassung mit eigener Aktionszeile spart das rund 40 px je Karte.

*Kauf und Info.* Der Kauf ist eine kompakte Goldpille am rechten Ende — Warenkorbsymbol und
Preis, sonst nichts. `Info` steht links unten mit Icon, `text-xs font-medium`, 40 px
Trefferfläche und `shrink-0`, damit es die Pille nie aus der Zeile drängt. Der Zustandswähler
öffnet als Panel über der Fußzeile, sodass sich die Kartenhöhe nicht bewegt.

*Mobiler Warenkorb.* Ein schwebender Zugang unten rechts, **nur** mit Inhalt, nur unter `md:`,
nicht für Admins und nicht auf `/cart`. Er sitzt über der unteren Leiste und dem Home-Indikator
und liest denselben Store wie das Header-Symbol — kein zweiter Warenkorb.


**V8 gebaut, Migration `0008` NOCH NICHT ausgeführt (2026-09-07, ADR-0048).** Der Shop wird
**Opt-out statt Opt-in**: vorhandener Bestand wird angeboten, sofern niemand widerspricht.

*Was sich ändert.* `shop_inventory.is_listed` bekommt den Vorgabewert `true` — eine Position
entsteht aus ihrer ersten Bewegung, und dieser Insert nennt keine Flags, also gilt der
Vorgabewert für **jeden** Erzeugungsweg (Quick Stock, ausführliche Buchung, Systempfad).
`set_shop_listing()` verlangt für eine Freigabe **keinen** Preis mehr; die Prüfung bleibt in
`shop_offers()`. `public.is_shop_eligible()` benennt die eine Regel („aktiv, sichtbar,
sammelbar"), die Projektion **und** die einmalige Freigabe benutzen.

*Was ausdrücklich gleich bleibt.* Es gibt keinen Shop-Snapshot und keinen
„Shop synchronisieren"-Knopf: `shop_offers()` liest den Bestand live. Bestand 0 schaltet die
Freigabe **nicht** ab — das Angebot verschwindet durch Arithmetik und ist nach dem Wiedereinbuchen
sofort zurück. Freigabe gilt je `(sky_id, condition)`.

*Preview gegen die echte Datenbank (schreibfrei):* 222 Positionen, **218 geeignet**, davon 2
bereits freigegeben → **216 würden aktiviert**. Ausgeschlossen bleiben **4** Fixture-Positionen
(`SKY-9998`, `SKY-9994`, je loose und boxed), weil ihre Figuren inaktiv sind — über die zentrale
Regel, nicht über eine Sonderliste. Keine Position ohne Preisbasis, keine mit Bestand 0.

⚠️ **`0008_shop_listing_opt_out.sql` ist geschrieben, aber NICHT ausgeführt.** Solange das so ist,
meldet `npm run verify:shop` **16/17** — die eine rote Prüfung ist genau „jede geeignete Position
ist freigegeben". Sie wird grün, wenn die Migration läuft.


**V7 gebaut: Navigation und Katalog-UX (2026-09-07).** Keine Migration, keine neue Architektur —
drei Verfeinerungen bestehender Entscheidungen (Nachtrag zu ADR-0038/0042/0043).

*Login-Ziel.* Ohne ausdrückliches Ziel landen **alle** Konten auf dem **Katalog** statt auf
`/collection`. `DEFAULT_SIGNED_IN_PATH` ist der gemeinsame Rückfall von Login,
E-Mail-Bestätigung und abgeschlossenem Onboarding; ein vor der Anmeldung gewünschtes Ziel
(`?next=`) bleibt erhalten, Onboarding schlägt weiterhin alles. Bewusst **nicht**
rollenabhängig.

*Besitzfilter.* `Alle · Besitz · Fehlen` statt des Umschalters „Besitz anzeigen", der
hervorgehoben war, während Besitz verborgen war. Vorgabe `Alle`, nichts gespeichert, nichts zu
migrieren. Verengt denselben Pool wie Serie, Produktgruppe und Suche, also sind alle
Kombinationen ohne Zusatzcode möglich. Für anonyme Besucher und für den Admin **gar nicht**
sichtbar, nicht deaktiviert.

*Shop auf der Katalogkarte.* Marktwert bleibt Information (Preis links, Elementchip rechts auf
einer Zeile), der Kauf wird eine goldene Aktion in der Fußzeile — ohne Markennamen, nur Preis
und Warenkorbsymbol. **Nur tatsächlich kaufbare Angebote erscheinen**: kein deaktivierter Knopf,
kein „Nicht auf Lager". Eine Kondition kauft direkt, zwei zu verschiedenen Preisen zeigen
„ab 4,49 €" und fragen beim Druck nach dem Zustand. Dieselbe Sprache auf der Detailseite. Kein
Kaufknopf im Adminkatalog. Warenkorb-Architektur unverändert.


**V6 gebaut, Migration `0007` NOCH NICHT ausgeführt (2026-09-06, ADR-0045/0046/0047).** Drei
Verbesserungen für die tägliche Verwaltung. Der Code ist vollständig, getestet und gebaut;
**er setzt `0007` voraus und läuft ohne sie nicht.**

*Quick Stock (ADR-0047).* Die Lagerkarte trägt `−  7  +` direkt an der Menge: ein Tipp, eine
Bewegung, kein Dialog. Intern unverändert `record_inventory_movement()` mit `delta = ±1` und
`reason = 'correction'` — Bestand und Journalzeile in einer Transaktion, Akteur `auth.uid()`,
Journal append-only, `quantity` wird nie zugewiesen. Dem Server wird ein **Delta** genannt, kein
Zielwert, deshalb können schnelle Mehrfachtipper nichts verlieren; in der Datenbank serialisieren
sie am `select … for update`. Die Untergrenze ist `reserved`, geprüft in der Datenbank. Der
ausführliche Dialog bleibt vollständig erhalten als **„Weitere Buchung"**.

*Shoppreise (ADR-0045).* `shop_settings` hält **eine** Zeile mit dem Prozentsatz, initial
**90 %**, im Admin änderbar. Der effektive Preis ist der manuelle Override oder
`market_price × Prozent`, auf Cent gerundet, berechnet in **einer** Datenbankfunktion
(`shop_price()`) auf `numeric`. **Kein abgeleiteter Preis wird gespeichert** — eine
Marktpreis- oder Prozentsatzänderung wirkt sofort auf alle Auto-Positionen, ohne ein einziges
Update. `shop_inventory.sale_price` ist ab jetzt der **Override**, keine zweite Preisspalte. Der
CHECK `shop_inventory_listed_needs_price` entfällt; die Regel steht jetzt in `set_shop_listing()`
und in `shop_offers()`, die beide den Marktpreis sehen. Im Admin heißt das Feld **„Shop-Preis"**;
öffentlich bleibt „SkyIsles 9,90 €".

*Bilder (ADR-0046).* `skylanders.image_override_path` plus der öffentliche Storage-Bucket
`catalog`. Auflösung zentral in `src/lib/catalog/image.ts`: Override → importiertes `image_file`
→ leere Bühne. Der Import fasst die Override-Spalte nie an. Upload, Ersetzen und Zurücksetzen auf
`/admin/catalog/[skyId]`; Dateityp aus den **ersten Bytes**, höchstens 2 MB, content-adressierter
Pfad, kein Service-Role-Key im Browser — geschrieben wird über Storage-Policies mit
`is_shop_admin()`.

⚠️ **`0007_shop_pricing_and_images.sql` ist geschrieben, aber NICHT ausgeführt, und der
Storage-Bucket existiert noch nicht.** Anders als bei `0006` gibt es **keine** stille
Rückfallebene: der Katalog liest `image_override_path` mit, also antwortet die Anwendung ohne die
Migration mit einem Fehler. **Reihenfolge zwingend: erst `0007` anwenden, dann deployen.**
Danach: `npm run verify:shop` und `npm run verify:inventory`.


**V5 abgeschlossen und produktiv: öffentliches Angebot, Warenkorb und der Legacy-Anfangsbestand
(2026-09-06, ADR-0043/0044).** Migration `0006` ist angewendet, der Legacy-Import ist real
ausgeführt, alle Verifikationen sind grün.

*Öffentliches Angebot (ADR-0043).* `public.shop_offers()` in Migration `0006` ist die einzige
öffentliche Lesefläche auf `shop_inventory`: vier Werte — `sky_id`, `condition`, `sale_price`
und ein **boolesches** `available` —, `security definer`, ausführbar für `anon` und
`authenticated`. Kein Tabellenrecht, keine Policy, keine Spalte, kein `alter table`.
Stückzahlen, Reserviertes, Notizen, Kosten und Bewegungen bleiben unerreichbar. Angeboten wird
nur, was `is_listed` ist **und** im öffentlichen Katalog steht (`is_active`, `catalog_visible`,
keine Software) — Fixtures sind inaktiv, SWAP-Hälften existieren im Katalog nicht.
Die Karte zeigt „SkyIsles 9,90 €" bzw. „ab 9,90 €" unter dem Marktwert, die Figurenseite eine
Zeile je Zustand mit Kaufknopf. **Ein** Aufruf für 561 Karten; keine zweite Karte, keine zweite
Pipeline, im Adminmodus keine Angebotszeile.

`0006_public_shop_offers.sql` ist am 2026-09-06 ausgeführt; `npm run verify:shop` besteht
**15/15**. Die Spaltengrenze ist an der Funktionssignatur selbst belegt: `sky_id`, `condition`,
`sale_price` und `available` sind abfragbar, und alle neun verbotenen Namen — `quantity`,
`reserved`, `available_quantity`, `note`, `unit_cost`, `currency`, `created_by`, `inventory_id`,
`id` — werden von PostgREST mit `42703` abgewiesen, unabhängig davon, ob gerade ein Angebot
existiert.

*Warenkorb V1 (ADR-0043).* Lokal im Browser (`localStorage`, Modul-Store, `useSyncExternalStore`,
tabübergreifend), anonym nutzbar. Identität `sky_id + condition`. Er schreibt **keine** Tabelle,
bucht **keine** Bewegung und reserviert **nichts**. Beim Anzeigen gewinnen die Serverdaten: der
gespeicherte Preis dient nur dem Hinweis „Preis geändert". Ausverkaufte oder ausgelistete Zeilen
bleiben sichtbar, mit Begründung, und zählen nicht zur Summe. Route `/cart`, Symbol mit Zähler im
Header — **kein fünfter Tab** in der Leiste, für Admins nicht angeboten. Kein Checkout, keine
Bestellung, keine Zahlung.

*Legacy-Anfangsbestand (ADR-0044).* `tools/import-legacy-inventory.mts`
(`npm run inventory:import-legacy`) liest die Arbeitsmappe **read-only** — nur Spalte F der sechs
Serienblätter, nie `Order *` oder `EÜR *`, nie die privaten Spalten P–S/U–X — und bucht
`initial_import`-Bewegungen über `system_record_inventory_movement()`. Kein direktes `quantity`,
`unit_cost` NULL, `sale_price` NULL, `is_listed` false, keine Namensheuristik, alles als `loose`
(begründete Annahme: die Arbeitsmappe kennt keine Verpackungsinformation).

**Real ausgeführt am 2026-09-06:** 614 Artikelzeilen · 234 mit Bestand · **218 Positionen /
762 Stück importiert**, 218/218 Bewegungen gebucht, 0 Konflikte · ausgeschlossen 8
Softwarepositionen (10 Stück) und 8 SWAP-Hälften ohne Katalogzeile (13 Stück) · 0 Fixtures ·
0 inaktiv.

**Idempotenz real bewiesen.** Ein zweiter identischer `--apply` meldete
`218 already initial-imported · 0 changes`: 0 neue Positionen, 0 neue Bewegungen, 0 Stück
Änderung, 0 Konflikte, Exit 0. Entschieden wird je Position aus dem Journal: existiert nicht →
importieren · hat `initial_import` → überspringen · existiert **ohne** `initial_import` →
**Konflikt**, nicht importieren. Ein nach 100 von 218 Positionen abgebrochener Lauf setzte beim
nächsten Mal mit genau den fehlenden 118 fort (Testnachweis). Der Unique-Index
`inventory_movements_one_initial_import` bleibt als letzte Sicherung.

**Datenbankstand nach dem Import, gegen die echte DB geprüft:** 218 Legacy-Positionen mit
`initial_import`, Summe der Anfangsmengen **762**, alle `condition = loose`, alle
`unit_cost = NULL` und `currency = NULL`, alle `created_by = NULL` (Systemweg), **keine**
gelistet, **kein** `sale_price`, höchstens eine Eröffnungsbuchung je Position.
Abstimmung `SUM(inventory_movements.delta) = shop_inventory.quantity` gilt für **alle 222**
Positionen; kein negativer Bestand, kein `reserved < 0`, kein `reserved > quantity`,
`reserved = 0` überall.

**Die importierte Ware ist bewusst noch nicht öffentlich.** Ohne `sale_price` und ohne
`is_listed` erzeugt sie keine Angebote — `shop_offers()` liefert derzeit **0 Zeilen**. Der erste
echte Shopartikel wird manuell über `/admin/inventory` gelistet. Keine Massenlistung, keine
automatische Preisbildung.


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

`supabase/migrations/0002_characters.sql` ist ausgeführt; `characters` hält 19 kuratierte
Zeilen und 90 SKY-IDs tragen eine `character_id` (gegen die laufende Datenbank geprüft,
2026-09-06).

**Shop-Fundament vollständig entschieden (2026-09-05, ADR-0037).** Rollen in `shop_admins` plus
`is_shop_admin()`, nie in `profiles` und nie per E-Mail-Konstante · `shop_inventory` ohne
`user_id`, Schlüssel `(sky_id, condition)` mit genau `loose` und `boxed` · `inventory_movements`
als Anhängejournal **ohne redundante `sky_id`** · gespeicherte Menge plus Journal · atomares
bedingtes Update gegen Doppelverkauf · öffentlich nur „Auf Lager" / „Nicht auf Lager" aus
`quantity - reserved` · `sale_price` manuell, `market_price` unangetastet · SWAP-Hälften und
Software werden in V1 nicht verkauft · Reihenfolge Foundation → Legacy-Import → Lagerverwaltung.
Umgesetzt in `0003`, `0005` und `0006`; das damals verworfene `catalog_visible` kam später mit
ADR-0039 aus einem anderen Grund — redaktioneller Sichtbarkeit, nicht Shoplogik.

Zwei Legacy-Befunde dahinter: **46 der 561 Katalogzeilen sind Verpackungs-/Zweitexemplarvarianten
derselben Figur** — ihre Bereinigung ist ein eigener späterer Schritt (**Collector Catalog
Normalization**) und ausdrücklich kein Blocker —, und von 234 Bestandspositionen sind 16 gar
keine öffentlichen Sammelobjekte.

**Einstandswert geklärt (2026-09-05, ADR-0037 § 21).** Die Legacy-Excel kennt Einkaufspreise
nur als Summe je Einkauf, ohne SKY-ID und ohne Charge — für alle 234 Bestandspositionen ist der
Einstand unbelegbar, der Import kann also nichts verlieren. Ab dem ersten eigenen Wareneingang
wäre der Preis dagegen bekannt, deshalb bekommt `inventory_movements` zwei nullable Spalten
`unit_cost` und `currency`. Chargen bleiben ableitbar und werden nicht gebaut.

**Lagerverwaltung Phase 1 gebaut und live (2026-09-06, ADR-0037).**
`/admin/inventory` zeigt dem Betreiber Bestand, Reserviert, Verfügbar, Marktpreis,
Shop-Preis (so seit V6 benannt) und Angebotsstatus je Position; Bestand ändern, Preis und Listing gehen direkt
von der Karte. Die Navigation lautet für ihn **Katalog · Lager · Admin · Profil** — „Lager" ist
ein eigenes Ziel mit der Bedingung `viewer.admin`, kein umbenannter Sammlungstab. Positionen
entstehen **on demand** aus der ersten Bewegung; `quantity` wird nie zugewiesen, `reserved` von
nichts geschrieben, `initial_import` ist keine Adminoption. Preis und Angebot laufen über
`set_shop_listing()`, Bestand über `record_inventory_movement()` — beides aus `0003`.

`0005_inventory_admin_read.sql` ist am 2026-09-06 ausgeführt und mit `npm run verify:inventory`
verifiziert. Sie fügt nur zwei `security definer`-Lesefunktionen hinzu (`admin_shop_inventory`,
`admin_inventory_movements`), weil Clients auf `shop_inventory` und `inventory_movements`
weiterhin keine Tabellenrechte haben — ein Admin konnte seinen eigenen Bestand sonst nicht
lesen. Keine Tabelle, keine Policy, keine Spalte.

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
`https://skyisles.app` als Production-Deployment von `main`, damit die Adresse
stabil bleibt. Keine hartkodierten Entwicklungsadressen im Anwendungscode: Auth-Rücksprünge entstehen
zur Laufzeit aus der Origin (`safeOrigin()`), Redirects im Callback und in der Middleware sind
relativ. Vercel braucht **nur** `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_ANON_KEY`;
der Service-Role-Key wird von keinem ausgelieferten Codepfad gelesen und bleibt lokal.
**Die Testadresse trägt `noindex, nofollow`** über `metadata.robots` in `src/app/layout.tsx` —
bewusst ohne `robots.txt`, weil ein `Disallow` das Lesen des Noindex verhindern würde. Beim Start
zum öffentlichen Beta-Start muss beides bewusst entfernt werden; ein Test erzwingt die
Entscheidung. Die eigene Domain allein ist dafür **nicht** der Auslöser.
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

**Die Migration ist angewandt** — auf Production wie auf Staging, geprüft mit
`npm run verify:rls`. Der damalige Nachsatz („kein `/shop-admin`, kein öffentlicher Shop, kein
Import, keine Rollenvergabe, keine Bestellungen") beschrieb den Stand vom 2026-09-05 und gilt
nicht mehr. Ist-Zustand auf Production (2026-09-11, lesend geprüft): 222 Lagerpositionen, davon
219 mit `initial_import`, **218 öffentliche Angebote** über `shop_offers()`, ein Eintrag in
`shop_admins`, eine Bestellung (`cancelled`, nie bezahlt) und **null** `payment_attempts`.
Der Adminbereich heißt `/admin`, nicht `/shop-admin` (ADR-0039).

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
| `tools/verify-rls.mts` — funktionale RLS-Prüfungen, `npm run verify:rls` | ✅ **ausgeführt, 103/103 bestanden** |
| `src/lib/catalog/slug.ts` — Slug-Regel nach ADR-0011, 15 Unit-Tests | ✅ |
| `tools/import-catalog.mts` — Katalogimport, `npm run catalog:import` | ✅ **ausgeführt**, 636 Zeilen geschrieben |
| Katalogdaten in Supabase: 6 Serien, 30 Kategorien, 600 Figuren | ✅ |
| `data/catalog/products.json` — Import-Input, 600 Artikel | ✅ |
| `public/images/skylanders/` — 475 WebP, 11 MB | ✅ |
| Vitest als Unit-Test-Werkzeug (ADR-0013), `npm test` | ✅ 628 Tests |
| `@supabase/ssr`, Browser-/Server-/Proxy-Clients | ✅ |
| Auth-Routen: Registrierung, Login, Logout, Bestätigung, Passwort-Reset | ✅ |
| Onboarding und Benutzernamenänderung (ADR-0016) | ✅ |
| Geschützter Bereich `/dashboard`, `/settings` über `src/proxy.ts` | ✅ |
| Sichere Redirect-Validierung gegen offene Weiterleitungen | ✅ |
| Katalog als Startseite `/`, ohne Konto nutzbar (ADR-0025) | ✅ |
| Suche und Serienfilter clientseitig (ADR-0026) | ✅ |
| Besitzfilter `Alle · Besitz · Fehlen`, nur für angemeldete Sammler | ✅ |
| Kaufaktion auf der Katalogkarte, nur für kaufbare Angebote | ✅ |
| Owned-Toggle, Mutation als Endzustand (ADR-0027) | ✅ |
| Detailseite `/skylanders/<slug>` | ✅ |
| `/collection` mit Fortschritt und Sammlungswert | ✅ |
| Entfernen im Katalog **und** auf `/collection`, mit Rückgängig (ADR-0031) | ✅ |
| `characters` + `skylanders.character_id`, RLS und Grants (Migration 0002) | ✅ **ausgeführt**, 19 Charaktere, 90 verknüpfte SKY-IDs |
| 19 kuratierte Pilotcharaktere, 104 verknüpfte SKY-IDs (ADR-0034) | ✅ Datei + Werkzeug |
| `tools/import-characters.mts`, `npm run characters:import` | ✅ Dry-Run geprüft |
| Charakterbereich und verwandte Figuren auf der Detailseite | ✅ |
| Gemeinsame responsive Navigation, mobile-first | ✅ |
| SkyIsles als sichtbarer Produktname (ADR-0028) | ✅ |
| Supabase-Projekt in EU-Region, 5 Tabellen, RLS, 10 Policies, 5 Trigger, 3 Funktionen | ✅ |
| `supabase/migrations/0006_public_shop_offers.sql` — `shop_offers()`, `non_collectible_categories()` | ✅ **ausgeführt und verifiziert** |
| `supabase/migrations/0007_shop_pricing_and_images.sql` — Preise, Bilder, Storage-Policies | ⚠️ geschrieben, **nicht ausgeführt** |
| Quick Stock `−  7  +` auf der Lagerkarte (ADR-0047) | ✅ Code, wartet auf `0007` |
| Abgeleitete Shoppreise, `/admin` → Shop-Einstellungen (ADR-0045) | ✅ Code, wartet auf `0007` |
| Bild-Upload im Admin, zentrale Bildauflösung (ADR-0046) | ✅ Code, wartet auf `0007` + Bucket |
| Angebotszeile auf der Katalogkarte und Angebotsblock auf der Figurenseite (ADR-0043) | ✅ |
| Warenkorb `/cart`, Header-Symbol mit Zähler, `localStorage` (ADR-0043) | ✅ |
| `tools/verify-shop.mts` — schreibfreie Shop-Verifikation, `npm run verify:shop` | ✅ **15/15 bestanden** |
| `tools/import-legacy-inventory.mts` + `tools/lib/xlsx.mts` + `src/lib/shop/legacy-plan.ts` (ADR-0044) | ✅ **ausgeführt: 218 Positionen, 762 Stück**; zweiter Lauf 0 Änderungen |
| Legacy-Geschäftsbestand im Lager: 218 Positionen `loose`, `unit_cost` NULL, ungelistet | ✅ |

## Noch nicht implementiert

- `@supabase/ssr` und die Cookie-basierte Session-Anbindung in Next.js — **bewusst offen**,
  kommt mit dem Auth-UI (V1.4); für den RLS-Test war sie nicht nötig
- Supabase CLI (nicht initialisiert, kein Remote-Link — Migration lief über den SQL-Editor)
- Mengen-/Duplikat-UI — `quantity` wird korrekt gerechnet, ist aber nicht bedienbar (V1.6).
  Entfernen löscht deshalb immer die ganze Zeile, und ein „Rückgängig" setzt auf 1 zurück
- LightCore-Normalisierung und weitere Datenqualitätsfälle (ADR-0030, „bewusst nicht behandelt")
- Playwright-End-to-End-Tests (ADR-0013, sobald die Sammlungs-UX steht)

---

## Technischer Zustand

| Bereich | Zustand |
|---|---|
| Frontend | Katalog, Detailseiten, Auth-UI und Sammlung lauffähig; 15 Routen im Build |
| Datenbank | Schema ausgeführt und strukturell verifiziert. Supabase-Projekt (EU-Region) vorhanden, 0 Datenzeilen. Repository-Datei und Datenbankstand sind identisch. |
| Auth | Kein UI. Die Datenbankseite ist fertig und funktional verifiziert: Trigger, Policies und Rechte greifen nachweislich (`tools/verify-rls.mts`, 31/31). Konzept in `docs/AUTH.md` |
| Deployment | nicht eingerichtet, ausdrücklich noch nicht vorgesehen |
| Tests | Lint / Typecheck / Build, 628 Unit-Tests (`npm test`) und die funktionalen Prüfungen (`verify:rls`, `verify:editorial`, `verify:inventory`, `verify:shop`) |

Konten vorhanden: GitHub, Supabase, Vercel. Das Supabase-Projekt ist angelegt (**EU-Region**,
ADR-0015). Vercel ist eingerichtet, die kanonische Domain ist **`https://skyisles.app`**
(noch `noindex` bis zum Beta-Gate).

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
| `npm run verify:rls` | ✅ **103/103** (Stand 2026-09-06) |

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

Drei Hinweise ohne Handlungsbedarf:

- **`MODULE_TYPELESS_PACKAGE_JSON`** beim Start der lokalen Werkzeuge
  (`inventory:import-legacy`, `verify:shop`, `catalog:import`). Node meldet, dass es eine
  `.ts`-Datei aus `src/` lädt, deren `package.json` kein `"type"` deklariert, und sie deshalb
  einmal zusätzlich parsen muss. **Rein kosmetisch und rein lokal:** die Warnung erscheint
  weder in `next dev` noch im Production Build noch auf Vercel — verifiziert, 0 Treffer im
  Dev-Log. Die naheliegende „Lösung", `"type": "module"` in `package.json`, ist **bewusst nicht**
  umgesetzt: sie stellt die Modulauflösung des gesamten Next.js-Projekts um, samt aller
  `.js`-Konfigurationsdateien. Aus demselben Grund heißt die Vitest-Konfiguration
  `vitest.config.mts` — die Datei sagt es in ihrer ersten Zeile. Ein Modulformat-Refactor wäre
  eine eigene, isolierte Änderung mit eigener Verifikation, kein Nebeneffekt eines Feature-Commits.
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
| **0043** | **Öffentliches Angebot als Projektion (`shop_offers()`, vier Werte, `available` boolesch); Warenkorb lokal im Browser, ohne Reservierung** — Code fertig, Migration `0006` **nicht ausgeführt** |
| **0044** | **Legacy-Anfangsbestand als `initial_import`-Bewegungen, alles `loose`, ohne Kosten, ohne Preis, ohne Listung; wiederholbar und fortsetzbar, bestehende Handbestände sind Konflikte statt Additionen** — **real ausgeführt: 218 Positionen, 762 Stück**, zweiter Lauf 0 Änderungen |
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
| — | Welcher Payment-Provider? | vor jedem Checkout |
| — | Sind eBay-beigelegte Rabattcodes nach den dann geltenden eBay-Richtlinien zulässig? | vor jedem Werbemittel in eBay-Paketen |

---

## Nächster geplanter Schritt

**Zuerst: `0007` anwenden** (siehe oben), dann `npm run verify:shop` und
`npm run verify:inventory`, dann deployen.

**Danach: der erste echte Shopartikel.** Der Legacy-Bestand liegt im Lager, ist aber bewusst
ungelistet und ohne Preis. Der nächste Schritt ist eine bewusste Einzelentscheidung des
Betreibers in `/admin/inventory`: Preis setzen, listen — und damit das erste öffentliche
Angebot erzeugen. Keine Massenlistung, keine automatische Preisbildung (ADR-0037, ADR-0043).

Danach offen und **nicht** gebaut: Bestellungen, Checkout, Zahlung, Versand, Reservierungen,
Rabatte, Coupons.

**V1.6 — Ausbau.** Weitere Sammlungsansichten (kompakt, Tabelle), Fortschritt je Serie,
Mengen-/Duplikat-UI (**dabei die offene Grenze aus ADR-0031 mitlösen: ein „Rückgängig" setzt
die Menge heute auf 1 zurück**), Kategorie-Zwischenüberschriften im Katalog, Filter und Sortierung
innerhalb der Sammlung, Mobile-Feinschliff. Und Playwright, sobald die Sammlungs-UX steht
(ADR-0013).

Danach **V1.7** — Beta-Reife: Impressum, Datenschutzerklärung, produktiver E-Mail-Versand
(ADR-0018) und erst dann ein Deployment.

**Wartet auf die ausdrückliche Freigabe des Nutzers.**
