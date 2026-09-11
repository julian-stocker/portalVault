# Deployment

Wie SkyIsles öffentlich erreichbar wird — und was dabei **nicht** mitfliegt.

Stand: 2026-09-08. Aktuelle Stufe: **eigene Domain, noch nicht öffentlich**

    https://skyisles.app

**Die kanonische öffentliche Adresse.** Production-Deployment vom Branch `main`,
über Vercel eingerichtet, in der Supabase-Auth-Konfiguration als Site URL
hinterlegt. Kein offizieller Start: es gibt zwar seit B1 eine Kasse, aber
weder Zahlung noch Rechtstexte noch Transaktionsmails — `noindex` bleibt bis
zum Beta-Gate bestehen.

`https://portal-vault-lovat.vercel.app` bleibt als technische Vercel-Adresse
erreichbar, ist aber **nicht** mehr die kanonische Domain und wird nirgends
mehr als solche genannt. Eine mögliche `skyisles.de` ist weiterhin offen und
keine Voraussetzung für irgendetwas.

---

## Environment Variables

Der ausgelieferte Webcode liest genau zwei Variablen — nachgewiesen über
`grep -rn "process.env" src/`:

| Variable | Wo gelesen | Zweck |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `src/lib/supabase/{client,server,middleware}.ts` | Projekt-Endpunkt |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | dieselben drei Dateien | öffentlicher Schlüssel (ADR-0017) |

Beide sind öffentlich. Der Schutz liegt bei Supabase Auth und Row Level
Security, nicht bei ihrer Geheimhaltung.

### Lokal

`.env.local` (nie committen, siehe `.gitignore`), Vorlage: `.env.example`.
Lokal steht dort zusätzlich `SUPABASE_SERVICE_ROLE_KEY`, weil die Werkzeuge
unter `tools/` ihn brauchen (`npm run catalog:import`, `characters:import`,
`verify:rls`). Diese laufen ausschließlich auf dem Entwicklungsrechner.

### Auf Vercel

Nur die beiden `NEXT_PUBLIC_*`-Variablen, für **Production, Preview und
Development**.

**`SUPABASE_SERVICE_ROLE_KEY` gehört nicht nach Vercel.** Kein Pfad im
ausgelieferten Code liest ihn; er umgeht RLS vollständig. Erst wenn die
Anwendung selbst eine privilegierte Serveraufgabe bekommt, wird das neu
bewertet — und dann als bewusste Entscheidung mit eigenem ADR.

> `NEXT_PUBLIC_*`-Werte werden **zur Buildzeit** eingesetzt. Sie müssen vor
> dem ersten Build gesetzt sein, und eine Änderung wirkt erst nach einem
> erneuten Deployment.

---

## Supabase: URL-Konfiguration

Die App baut ihre Rücksprung-Adressen dynamisch aus der Origin, unter der sie
gerade läuft (`safeOrigin()` in `src/lib/auth/redirect.ts`, gefüllt aus
`window.location.origin`). Deshalb funktionieren lokal und deployed
gleichzeitig — nichts ist hartkodiert.

Erzeugt werden genau zwei Formen:

```
{origin}/auth/callback                              ← Registrierungsbestätigung
{origin}/auth/callback?next=%2Freset-password       ← Passwort zurücksetzen
```

Einzutragen unter **Authentication → URL Configuration**:

| Feld | Wert |
|---|---|
| Site URL | `https://skyisles.app` |
| Redirect URLs | `https://skyisles.app/**` |
| Redirect URLs | `http://localhost:3000/**` |

Die Site URL ist der Rückfall, wenn die App keine gültige Origin mitschickt
(Formular ohne Hydration). Sie zeigt deshalb auf die kanonische Domain, nicht
auf localhost. Der localhost-Eintrag hält die lokale Entwicklung am Leben.

Sollte der Reset-Link am Query-String scheitern, zusätzlich exakt
`https://skyisles.app/auth/callback` eintragen.

**Der alte `vercel.app`-Eintrag wird entfernt.** Er hat keinen technischen
Zweck mehr: Bestätigungslinks sollen auf der kanonischen Domain landen, und
jeder zusätzliche Eintrag in der Allowlist ist eine weitere Adresse, auf der
ein Auth-Link ausgeliefert werden darf. Vercel-Preview-Deployments brauchen
ihn nicht — sie haben ohnehin wechselnde Hosts und sind hinter einer
Anmeldung; wer dort Auth testen will, tut das lokal.

---

## E-Mail-Versand

Registrierung und Passwort-Reset laufen über Supabase-Mails. Der eingebaute
Versand ist **stark ratenbegrenzt und nur für Tests gedacht** — für einige
Testkonten reicht er, für eine öffentliche Beta nicht.

**Vor der öffentlichen Beta: eigener SMTP-Anbieter** in Supabase
(Authentication → Emails → SMTP Settings). Bis dahin bewusst nicht
konfiguriert.

---

## Noindex — temporär, muss wieder weg

Die Testadresse soll nicht in Suchmaschinen landen. Umgesetzt in
`src/app/layout.tsx` als `metadata.robots` → `noindex, nofollow` auf **jeder**
Route.

Bewusst **ohne** `robots.txt`: Ein `Disallow` verhindert das Abrufen und
damit auch das Lesen des Noindex — eine verlinkte URL könnte dann trotzdem
als nackte Adresse im Index stehen. Crawlen erlauben und „noindex" antworten
ist die Variante, die tatsächlich draußen hält.

Vercel setzt `X-Robots-Tag: noindex` von sich aus nur auf **Preview**-
Deployments, nicht auf Production. Deshalb muss es aus der App kommen.

**Checkliste zum öffentlichen Beta-Start:**

1. `robots`-Block in `src/app/layout.tsx` entfernen
2. `src/lib/layout/robots.test.ts` entfernen (der Test schlägt sonst fehl —
   genau dafür ist er da)
3. diesen Abschnitt und `PROJECT_STATUS.md` aktualisieren

---

## Deployment-Prozess

**Production von `main`, keine Previews als Testadresse.** Vercel gibt einem
Production-Deployment eine stabile Adresse — hier `https://skyisles.app` —
die bei jedem Push auf `main`
automatisch neu gebaut wird. Preview-URLs enthalten den
Commit-Hash, ändern sich also bei jedem Push, und Vercel schützt sie
standardmäßig hinter einer Anmeldung — beides ist für „auf dem Handy öffnen"
das Falsche.

| Einstellung | Wert |
|---|---|
| Framework Preset | Next.js (wird erkannt) |
| Root Directory | `./` |
| Build Command | Vorgabe (`next build`) |
| Install Command | Vorgabe |
| Production Branch | `main` |

Keine `vercel.json` nötig; `next.config.ts` enthält nur den unveränderten
Cache-Header für die Figurenbilder.

---

## Was nicht ausgeliefert wird

`artwork/` (Quellbilder) ist in `.gitignore` und damit nicht im Repository —
ausgeliefert sind nur die Derivate unter `public/images/brand/`.
`../webpage`, `skylanders.xlsx`, Lager-, Order- und EÜR-Daten sind weder im
Repository noch in der Datenbank. Vollständige Liste: `docs/SECURITY.md`.

Die Shop-Grundlage existiert in der Datenbank (Migration `0003`), aber es gibt
keine Shop-Route, keine Shop-UI und keinen öffentlichen Zugriff:
`shop_admins` und `inventory_movements` sind für `anon` nicht einmal lesbar.

---

## Reservierungen aufräumen — `pg_cron`

`public.expire_stale_checkouts()` gibt abgelaufene Reservierungen frei und schließt die
Bestellungen, die mit ihnen verfallen sind.

**Auf `skyisles-staging` eingerichtet und verifiziert (2026-09-11). Auf Production noch NICHT
eingerichtet.**

**Was der Job tatsächlich tut — und was nicht.** Er ist *nicht* der Weg, auf dem Bestand
rechtzeitig zurückkommt: `create_order()` ruft `release_expired_reservations(p_inventory_ids)`
bereits synchron auf genau die Positionen, die es gleich sperrt. Ein Käufer wartet also nie auf
den Sweep. Was der Job erledigt, ist die **Buchhaltung** — Bestellung auf `expired`, offener
Versuch auf `expired`, `checkout_expired` in `order_events`. Deshalb sind fünf Minuten großzügig
und nicht knapp; eine Minutenfrequenz brächte nichts.

Einrichten — bevorzugt die Extension über *Database → Extensions* im Dashboard einschalten
(anbieternativ, ADR-0054), sonst im SQL-Editor:

```sql
create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'expire-stale-checkouts',
  '*/5 * * * *',
  $$select public.expire_stale_checkouts();$$
);
```

Fünf Minuten bei zwanzig Minuten Haltedauer. Der Job läuft als `postgres` und darf die Funktion
deshalb aufrufen, **ohne dass ein Grant geöffnet werden muss** — genau das ist der Grund gegen
einen öffentlichen HTTP-Endpunkt.

**Vorher abmelden, statt sich auf Namensverhalten zu verlassen.** Eine frühere Fassung dieses
Abschnitts behauptete, `cron.schedule` mit gleichem Namen aktualisiere den bestehenden Job. Das ist
in der pg_cron-Dokumentation **nicht zugesichert**, und Quellen widersprechen sich — pg_cron lässt
doppelte Jobnamen grundsätzlich zu. Deshalb wird nicht darauf gebaut:

```sql
select cron.unschedule('expire-stale-checkouts')
 where exists (select 1 from cron.job where jobname = 'expire-stale-checkouts');
```

Danach erst `cron.schedule(...)`. Prüfen mit
`select jobid, jobname, schedule, active from cron.job;` — dort darf der Name **genau einmal**
stehen. Läufe kontrollieren über
`select jobid, status, return_message, start_time from cron.job_run_details order by start_time desc;`

**Überlappende Läufe sind unschädlich — durch Konstruktion, nicht durch pg_cron.** Ob pg_cron
gleichzeitige Läufe desselben Jobs verhindert, ist hier *nicht* geprüft und wird deshalb auch
nicht behauptet (ADR-0054, Punkt 3). Es trägt aber nicht: beide Funktionen sind idempotent,
`release_expired_reservations()` sperrt in derselben festen Reihenfolge wie der Checkout
(`order by r.inventory_id, r.id`, also kein Deadlock), und jeder Schreibvorgang hat ein
Zustandsprädikat (`and state = 'active'`, `and payment_status = 'pending'`). Ein zweiter Lauf
wartet auf die Sperre und findet dann nichts mehr.

### Verifikation auf Staging (2026-09-11)

Frische Gast-Bestellung `SI-2026-001016` über `create_order()`, 1× SKY-9101/loose + Hermes,
9,31 €. Ohne jeden manuellen Eingriff, geprüft mit
`tools/verify-payment-smoke.mts --before` und `--expired`:

| | Ergebnis |
|---|---|
| vor Ablauf | 13/13 — `pending`, Hold aktiv mit 19,9 min Rest, `reserved=1`, `available=1` |
| nach Ablauf | 13/13 — `payment_status=expired`, Reservierung `released`, `reserved=0`, `available=2`, `movement_id` null |
| Wiederholung 7 min später | 13/13, identisch — `checkout_expired` steht **genau einmal**, `reserved` unverändert |
| Bestandsbewegungen | **keine `sale_skyisles`**, projektweit 0 |

`released_at` war `09:05:00.044` — exakt ein Cron-Tick. Die Reservierung lief um 09:00:40 ab, der
Lauf um 09:00:00 sah sie also noch als gültig und ließ sie in Ruhe; der Lauf um 09:05:00 räumte
sie ab. Verzug: 4,3 Minuten, innerhalb des erwarteten Fensters von maximal fünf.

Zuvor hatte derselbe Job die drei liegengebliebenen Bestellungen `SI-2026-001013` bis
`SI-2026-001015` nachgeholt, darunter eine mit offenem `payment_attempt` aus dem B2.2b-Smoke —
dieser wurde korrekt auf `expired` geschlossen, ohne dass etwas verkauft wurde.

---

## Rollout mit zwei `create_order()`-Signaturen (B2.2a)

Migration `0013` fügt `create_order()` ein sechstes Argument hinzu — die
Zahlungsfähigkeit. Eine Argumentliste lässt sich in PostgreSQL nicht in place
erweitern, und die alte Fassung einfach zu ersetzen würde ein Loch von der
Länge eines Deployments öffnen: Die Migration liegt, Vercel liefert noch den
vorherigen Commit aus, dessen Kasse ruft die Fünf-Argument-Funktion, und
PostgREST antwortet `PGRST202`. Jede Bestellung in diesem Fenster schlägt fehl.

**Deshalb existieren beide für die Überfahrt.** `0013` droppt nichts.

| Aufrufende Argumentnamen | Aufgelöst auf |
|---|---|
| `request_id, email, items, address, shipping_method` | alte Fassung (0011), Shim |
| … `+ payment_token` | neue Fassung (0013), kanonisch |

**Warum das eindeutig ist:** Die beiden unterscheiden sich in Stelligkeit *und*
Argumentnamen, und `p_payment_token` hat **keinen DEFAULT**. Mit einem Default
würde ein Fünf-Namen-Aufruf auf **beide** passen, und PostgREST wiese ihn als
mehrdeutig zurück, statt eine zu wählen. Ein Test hält das fest.

**Bestellungen über den Shim** tragen `payment_token_hash = NULL`. Das ist die
ehrliche Folge und bewusst nicht kaschiert: Es wurde keine Fähigkeit vorgelegt,
also wird keine vermerkt. Ein serverseitig erfundener Hash, dessen Klartext
niemand besitzt, wäre keine Fähigkeit, sondern nur ein Wert, der wie eine
aussieht. Solche Bestellungen können **nie** per Gast-Fähigkeit bezahlt werden;
für angemeldete Besitzer bleibt der `user_id`-Pfad unberührt. Zahlung ist in
diesem Fenster ohnehin für niemanden freigeschaltet.

### Reihenfolge

1. `0013` anwenden — danach funktionieren **beide** Signaturen.
2. Runtime prüfen: alte und neue Signatur je aufrufbar, Spalte vorhanden,
   `authorize_order_payment()` für Clients gesperrt.
3. Neuen Code committen, pushen, deployen.
4. Smoke: Kasse lädt, der neue Build ruft nachweislich die Sechs-Argument-Fassung,
   Request-ID und Fähigkeit entstehen stabil im Browser.
5. **Erst danach** die Aufräum-Migration.

### Aufräum-Migration — `0014`, angewandt auf Staging und Production

`0014_remove_legacy_create_order.sql` besteht aus einer Anweisung:

```sql
drop function if exists public.create_order(text, text, jsonb, jsonb, text);
```

Eindeutig, weil sich die beiden in der Stelligkeit unterscheiden.

> **Achtung:** `supabase/migrations/` bildet sonst den produktiven Stand ab.
> `0014` ist die einzige Ausnahme und ist im Dateikopf entsprechend markiert.
> Nicht mit anderen Migrationen zusammen blind ausführen.

**Wann anwenden.** Technisch ab sofort sicher, und der Grund ist
architektonisch: `create_order` wird nie aus einem Browser gerufen, sondern aus
einer **Server Action**, die den aktuell ausgelieferten Servercode ausführt. Ein
Browser mit altem Bundle erreicht damit den neuen Server, nicht die alte
Funktion. Die übliche Sorge um veraltete Bundles greift hier also nicht.

Trotzdem **nicht sofort**: eine ungenutzte Funktion kostet nichts, ein Irrtum
auf dem Bestellpfad kostet viel. Sie läuft mit der nächsten Commerce-Migration
mit.

Bis dahin ist die alte Fassung **in der Datenbank selbst** als temporär
gekennzeichnet (`comment on function`), damit niemand später zwei
`create_order` findet und raten muss.

---

## Migration `0017` und der echte Zahlungsschritt (B2.4)

**`0017_order_payment_state.sql` ist auf `skyisles-staging` angewandt und verifiziert
(2026-09-11). Auf Production NICHT angewandt.**

Eine lesende Funktion, die der Browser aufrufen darf — die einzige der Payment-Familie. Details in
`docs/DATABASE.md`; die Sicherheitsgrenze in `docs/SECURITY.md`.

**`ALLOWED_ORIGINS` ist der Punkt, der beim Rollout leicht übersehen wird.** Die Secrets von
`create-payment` nennen heute nur `http://localhost:3000`, was für `npm run dev:staging` genau
richtig ist. Sobald die Kasse von einer anderen Origin aus bezahlt — eine Vercel-Preview, die
Produktionsdomain —, muss deren Origin dazu. Fehlt sie, antwortet der Preflight sauber und der
Browser verwirft den POST **stumm**: kein Fehler in den Logs, keine Zeile in der Datenbank. Genau
so ging der erste B2.2b-Smoke verloren, damals an `x-client-info`.

---

## Edge Function `stripe-webhook` (B2.3)

**Auf `skyisles-staging` deployt und runtime-verifiziert (2026-09-11). Auf Production NICHT
deployt, und es existiert dort kein Webhook-Endpoint und kein Live-Secret.**

Sie ist die einzige Stelle, die bestätigen darf, dass Geld angekommen ist. Was sie selbst tut, ist
wenig: Signatur über das offizielle Stripe-SDK prüfen, Felder lesen, eine von zwei
Datenbankfunktionen aufrufen, Antwortcode setzen (ADR-0054).

**Deploy.** Kein `supabase link`, Project-Ref immer explizit:

```bash
npx supabase functions deploy stripe-webhook \
  --project-ref <staging-ref> --no-verify-jwt --use-api
```

`config.toml` setzt `verify_jwt = false`, und zwar aus einem anderen Grund als bei
`create-payment`: Stripe schickt überhaupt keinen Supabase-JWT. Mit Verifikation würde die
Plattform jede Zustellung abweisen, bevor die einzige Authentifizierung, die zählt, überhaupt
stattfinden kann.

**Secrets.**

| Name | |
|---|---|
| `STRIPE_WEBHOOK_SECRET` | `whsec_…`, **pro Endpoint verschieden**. Staging und Production teilen ihn nie. Ohne ihn antwortet die Function auf jeden POST `503` und prüft nichts — fail closed. |
| `STRIPE_LIVEMODE` | ungesetzt auf Staging (Default `false`). Eine Production-Deployment braucht `true`, sonst verwirft sie jedes Live-Event als `livemode_mismatch`. |

> **Seit `0021` muss `STRIPE_LIVEMODE` mit dem Commerce-Modus übereinstimmen** (ADR-0060). Die
> Function liest `commerce_mode()` bei jeder Zustellung und verarbeitet **gar nichts**, solange
> die beiden sich widersprechen: `live` verlangt den *effektiven* Wert `true`, `sandbox` und
> `closed` verlangen `false`. Die Antwort ist `503`, nicht `200` — Stripe behält das Event, und
> eine korrigierte Konfiguration holt die Zustellung nach, statt sie zu verlieren.
>
> **Für `sandbox` und `closed` genügt es, die Variable nicht zu setzen; sie muss nicht
> ausdrücklich auf `false` stehen.** Gelesen wird `Deno.env.get("STRIPE_LIVEMODE") === "true"` —
> ein Boolean, nie `undefined`. „Ungesetzt" und „`false`" sind damit derselbe Wert, es gibt
> keinen dritten Zustand, auf den man fail-closed reagieren könnte, und der einzige Eingabewert,
> der Live-Events überhaupt freischaltet, ist die **exakte** Zeichenkette `true`. Die
> Asymmetrie zeigt bewusst in die sichere Richtung.
>
> Umgekehrt heißt das: Ein Tippfehler (`TRUE`, `1`, `yes`) wird als `false` gelesen. Für
> `sandbox` ist das ohnehin der gewollte Zustand. Für `live` ist es ein **Ausfall, kein
> Geldfehler** — jedes Event wird mit `503` abgewiesen, und die Logzeile
> `commerce_mode_live_but_STRIPE_LIVEMODE_false` benennt die Ursache genau.
>
> **Es gibt keine `COMMERCE_MODE`-Variable und soll keine geben.** Der Modus hat eine Quelle: die
> Datenbank. Eine zweite könnte von der abweichen, die `create_order()` auf die Bestellung
> stempelt — und die Abweichung wäre erst sichtbar, wenn jemand echtes Geld bezahlt hat.
>
> Dasselbe gilt für `create-payment` in der anderen Richtung: Es vergleicht den Modus mit dem
> **Präfix des eigenen `STRIPE_SECRET_KEY`** (`sk_test_`/`rk_test_` gegen `sk_live_`/`rk_live_`)
> und antwortet bei jeder Unklarheit `503 provider_unconfigured` — unlesbarer Modus, unlesbarer
> Schlüssel, fehlender Schlüssel, geschlossener Shop. Ein Sandbox-Deployment kann damit keinen
> Live-Schlüssel benutzen, und ein Live-Shop keinen Testschlüssel.

Ein Stripe-**API**-Schlüssel wird nicht gesetzt und darf nicht gesetzt werden: der signierte Body
ist autoritativ, es wird nichts nachgeladen — und eine Function ohne API-Key kann nicht abbuchen,
erstatten oder Sessions verfallen lassen.

**Endpoint bei Stripe.** Genau vier Event-Typen abonnieren, nicht mehr:

```
checkout.session.completed
checkout.session.expired
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
```

`payment_intent.payment_failed` ausdrücklich **nicht**: das Objekt ist ein `pi_…` und gegen unsere
`cs_…`-Identität nicht auflösbar, und eine abgelehnte Karte ist kein beendeter Checkout.

**Reihenfolge bei der Einrichtung — Negativpfade zuerst.**

1. Deployen **ohne** Secret. Jeder POST muss `503 not_configured` geben, ein `GET` `405`. Das
   beweist, dass das Modul lädt (das SDK auflöst, der Crypto-Provider funktioniert) und dass es
   fail closed ist.
2. `supabase/tests/webhook_runtime_verification.sql` abschnittweise im SQL-Editor auf Staging.
3. Endpoint im **Testmodus** anlegen, `whsec_…` setzen.
4. Negativpfade: ohne Signatur `400 missing_signature`; Müll-Header, fehlendes `v1`, falsches
   Secret, alter Timestamp, Signatur über einen anderen Body → jeweils `400 invalid_signature`.
   **Erst danach** kommt Geld ins Spiel.
5. Sandbox-Zahlung, dann dasselbe Event über das Dashboard **erneut zustellen** und prüfen, dass
   der Bestand sich nicht bewegt.

> Das Stripe-Dashboard kann in der aktuellen Oberfläche **keine** Testevents selbst senden; es
> verweist auf die Stripe CLI. Die wird hier nicht installiert (ADR-0054) — der E2E-Test beweist
> ohnehin strikt mehr als ein `stripe trigger`.

**Verifikation auf Staging (2026-09-11).** Vollständige Kette über den echten Anbieter: Kasse →
`create_order()` → `create-payment` → Stripe Sandbox → echte Testzahlung → signierter
`checkout.session.completed` → `confirm_order_payment()`. Ergebnis: Versuch `succeeded`,
Bestellung `paid` ohne `needs_resolution`, Reservierung `converted`, **genau eine**
`sale_skyisles`-Bewegung, `quantity` 2 → 1, `reserved` 0. Erneute Zustellung desselben Events:
eine `payment_events`-Zeile mit unverändertem `received_at`, **kein** zweiter Verkauf.

---

## Staging — `skyisles-staging`

Ein zweites, wegwerfbares Supabase-Projekt. Es existiert, weil Production
**keine Commerce-Testdaten aufnehmen darf**: `order_lines` ist append-only und
`orders` steht auf `on delete restrict`, eine Testbestellung wäre dort für
immer unentfernbar.

**Aufbau.** Frisches Projekt, gleiche Region, eigenes Datenbankpasswort. Dann
`0001` bis `0016` **vollständig und in Reihenfolge** über den SQL Editor. Kein
Dump, kein selektives Kopieren einzelner Tabellen — der Sinn ist gerade, dass
die Migrationskette selbst bewiesen wird. Sie ist dafür geeignet: keine
`create extension`, keine datenabhängigen Backfills, keine Vorwärtsreferenzen,
und die drei Seed-Inserts sind Singleton-Zeilen mit `on conflict do nothing`.

Staging startet mit **leerem Katalog** — die 820 SKY-IDs stehen in keiner
Migration. Das ist richtig so; die Runtime-Suite legt an, was sie braucht.

**Environment.** Eine eigene Datei `.env.staging` im Projektwurzelverzeichnis
mit denselben drei Namen wie `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

`.gitignore` deckt sie über `.env.*` bereits ab. **`.env.local` wird dabei nie
angefasst** — sie zeigt weiterhin auf Production.

Die `verify:*`-Skripte fest verdrahten `--env-file=.env.local`. Gegen Staging
laufen sie deshalb nicht über `npm run`, sondern direkt:

```bash
node --env-file=.env.staging tools/verify-rls.mts
node --env-file=.env.staging tools/verify-commerce.mts
```

> `verify:rls` ist **nicht lesend** — es legt echte Auth-Benutzer an und räumt
> sie in einem `finally` wieder ab. Vor dem ersten Lauf prüfen, dass die URL
> in `.env.staging` wirklich das Staging-Projekt benennt.

**Staging-Administrator.** `skyisles-staging` hat **genau einen** Auth-Nutzer, und derselbe Account
ist seit 2026-09-11 der dauerhafte Staging-Administrator (`shop_admins`, Notiz
`staging admin for Admin Orders V1 smoke, 2026-09-11`). Gesetzt über den vorgesehenen Weg:

```bash
node --env-file=.env.staging tools/grant-admin.mts --list
node --env-file=.env.staging tools/grant-admin.mts --email <adresse> --apply
```

Ohne diesen Eintrag antwortet `/admin` mit 404 und `admin_orders()` mit
`insufficient_privilege` — beides korrekt, aber es macht jeden Admin-Smoke unmöglich. **Auf
Production wird die Rolle unabhängig davon vergeben; die beiden Projekte teilen keine Nutzer.**

**Regeln, die Staging und Production trennen.** Der Service-Role-Key bekommt
nie ein `NEXT_PUBLIC_`-Präfix und geht nie nach Vercel. Stripe-Testschlüssel
liegen ausschließlich in den Edge-Function-Secrets des Staging-Projekts,
Live-Schlüssel ausschließlich in denen von Production — nie beide in einem
Projekt. Staging behält `noindex` dauerhaft.

**Runtime-Suite.** `supabase/tests/0015_runtime_verification.sql`, abschnittweise
im SQL Editor. Jeder schreibende Abschnitt läuft in `begin … rollback`; was
nicht zurückrollt, sind Sequenzen (`next_order_number()`, Identity-Spalten), und
das ist in einer wegwerfbaren Umgebung folgenlos. Abschnitt 6 prüft am Ende, dass
nichts übrig geblieben ist. **Niemals gegen Production.**

---

## `0016` war eine Produktionsbehebung, keine Aufräumarbeit — angewandt

`0014`, `0015` und `0016` sind auf Staging **und auf Production** angewandt und verifiziert;
Production zusätzlich mit einem realen Checkout-/Reservierungs-Smoke. Von den dreien war `0016`
das dringende, und der Abschnitt bleibt stehen, weil er erklärt, warum:

**Der Checkout war in Production seit `0010` funktionsunfähig.** `create_order()`
legte die Bestellung mit Nullbeträgen an und aktualisierte sie danach, was
`orders_protect_immutable()` verbietet — jeder Aufruf warf `23001` und rollte
zurück. Es gibt keine Eingabe, die daran vorbeikommt. Dass Production null
Bestellungen zählt, ist keine Aussage über Kundschaft (ADR-0053).

Erschwerend: `23001` steht weder in `UNAVAILABLE` noch in `THROTTLED`
(`src/lib/commerce/actions.ts`), fällt also in den generischen `failed`-Zweig.
Ein Kunde hätte einen unerklärten Fehler gesehen und der Betrieb kein
spezifisches Signal bekommen.

Angewandt auf Production in dieser Reihenfolge: `0014` → `0015` → `0016`.
