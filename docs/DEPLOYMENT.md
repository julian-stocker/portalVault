# Deployment

Wie SkyIsles öffentlich erreichbar wird — und was dabei **nicht** mitfliegt.

Stand: 2026-09-08. Aktuelle Stufe: **eigene Domain, noch nicht öffentlich**

    https://skyisles.app

**Die kanonische öffentliche Adresse — und die einzige, die funktioniert.**
Production-Deployment vom Branch `main`, über Vercel eingerichtet, in der
Supabase-Auth-Konfiguration als Site URL hinterlegt. Erreichbarkeit zuletzt
bestätigt am 2026-09-20. Kein offizieller Start: es gibt zwar seit B1 eine
Kasse, aber weder Zahlung noch Rechtstexte noch Transaktionsmails — `noindex`
bleibt bis zum Beta-Gate bestehen.

**Die alte technische Vercel-Adresse `portal-vault-lovat.vercel.app` ist tot.**
Sie antwortet mit `DEPLOYMENT_NOT_FOUND` (geprüft am 2026-09-20) und ist damit
weder kanonisch noch überhaupt erreichbar. Sie steht hier nur, damit ältere
Verweise darauf einzuordnen sind — als Adresse taugt sie nicht mehr, und ein
Fallback auf sie gibt es nicht. Eine mögliche `skyisles.de` ist weiterhin offen
und keine Voraussetzung für irgendetwas.

---

## Environment Variables

Der ausgelieferte Webcode liest genau drei Variablen — nachgewiesen über
`grep -rn "process.env" src/`:

| Variable | Wo gelesen | Zweck |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `src/lib/supabase/{client,server,middleware}.ts`, `src/lib/catalog/image.ts` | Projekt-Endpunkt |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | dieselben drei Supabase-Dateien | öffentlicher Schlüssel (ADR-0017) |
| `VERCEL_GIT_COMMIT_SHA` | `src/lib/perf/permission.ts` | Build-ID der Messläufe (ADR-0072) |

Die beiden `NEXT_PUBLIC_*` sind öffentlich. Der Schutz liegt bei Supabase Auth
und Row Level Security, nicht bei ihrer Geheimhaltung.

**`VERCEL_GIT_COMMIT_SHA` setzt Vercel selbst** — es ist nichts einzutragen.
Es wird **serverseitig** gelesen, auf zwölf Zeichen gekürzt und nur an
Messwerte von Testkonten geschrieben, damit ein Vorher- und ein Nachher-Lauf
unterscheidbar sind. Kein `NEXT_PUBLIC_`-Präfix, also nichts davon im Bundle;
lokal gibt es keine Bereitstellung, und die Antwort ist dann `dev`.

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

`designs/artwork/` und `designs/cards/` (Quellbilder und Card-Templates) sind in `.gitignore` und damit nicht im Repository —
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
| `STRIPE_WEBHOOK_SECRET_SANDBOX` | `whsec_…` des **Test-Endpoints**. Ohne ihn werden Sandbox-Zustellungen als ungültige Signatur abgewiesen. |
| `STRIPE_WEBHOOK_SECRET_LIVE` | `whsec_…` des **Live-Endpoints**. Ungesetzt lassen, solange Live-Zahlung nicht eingerichtet ist — dann werden Live-Events abgewiesen, was in dieser Phase der gewollte Zustand ist. |

Sind **beide** ungesetzt, antwortet die Function auf jeden POST `503` und prüft nichts — fail
closed.

> **Seit `0077` entscheidet die Signatur, nicht eine Umgebungsvariable** (ADR-0100). Die
> Function probiert die konfigurierten Endpoint-Secrets der Reihe nach; **dasjenige, das die
> Signatur verifiziert, bestimmt die Welt**. Ein Endpoint-Secret gehört zu genau einem
> Stripe-Konto in genau einem Modus, und nur Stripe kann einen Body erzeugen, der dagegen
> verifiziert — die Welt ist damit nichts, was ein Absender wählen kann. **Keine URL, kein
> Query-Parameter, kein Header, kein Feld im Body.**
>
> `STRIPE_LIVEMODE` **gibt es nicht mehr und darf nicht wieder eingeführt werden.** Ein
> Deployment gehört seit `0077` zu beiden Welten gleichzeitig — Tester zahlen in der Sandbox,
> während Kundschaft live zahlt —, also kann ein einzelnes Flag die Frage gar nicht mehr
> beantworten. Es könnte nur noch irreführen.
>
> **Zwei weitere Schlösser hinter der Signatur**, beide `503`, damit Stripe das Event behält und
> eine korrigierte Konfiguration die Zustellung nachholt:
>
> 1. Das von Stripe **mitsignierte `livemode`** des Events muss zu dem Secret passen, das
>    verifiziert hat (`event_livemode_true_but_secret_is_sandbox`).
> 2. Die Bestellung, die das Event nennt, muss **in derselben Welt liegen**
>    (`attempt_is_live_but_event_is_sandbox`). Damit kann ein Sandbox-Webhook keinen
>    Live-Vorgang verändern und umgekehrt — nicht weil Session-IDs zweier Stripe-Konten
>    unwahrscheinlich kollidieren, sondern weil es geprüft wird.
>
> **Es gibt keine `COMMERCE_MODE`-Variable und soll keine geben.** Der Modus hat eine Quelle: die
> Datenbank. Eine zweite könnte von der abweichen, die auf die Bestellung gestempelt ist — und
> die Abweichung wäre erst sichtbar, wenn jemand echtes Geld bezahlt hat.
>
> **`create-payment` wählt spiegelbildlich.** Es liest `order_payment_mode(order_id)` — die Welt
> der **Bestellung**, nicht die des Shops — und nimmt dafür `STRIPE_SECRET_KEY_LIVE` bzw.
> `STRIPE_SECRET_KEY_SANDBOX`. Jede Unklarheit endet in `503 provider_unconfigured`: unlesbare
> Welt, fehlender Schlüssel, unlesbarer Schlüssel, oder ein Schlüssel, dessen Präfix
> (`sk_test_`/`rk_test_` gegen `sk_live_`/`rk_live_`) der Welt widerspricht. **Ein fehlender
> Schlüssel fällt niemals auf die andere Welt zurück** — weder wird aus einer fehlenden
> Live-Konfiguration eine Testbuchung noch aus einer fehlenden Sandbox-Konfiguration eine echte.

**Secrets für `create-payment`:**

| Name | |
|---|---|
| `STRIPE_SECRET_KEY_SANDBOX` | `sk_test_…` bzw. `rk_test_…`. Ohne ihn können Testkonten nicht bezahlen. |
| `STRIPE_SECRET_KEY_LIVE` | `sk_live_…` bzw. `rk_live_…`. Ungesetzt lassen, solange Live-Zahlung nicht freigegeben ist: Live-Bestellungen erhalten dann `503 provider_unconfigured`. |

Der frühere **einzelne** `STRIPE_SECRET_KEY` wird nicht mehr gelesen. Beim Umstellen bekommt
`STRIPE_SECRET_KEY_SANDBOX` seinen bisherigen Wert; die alte Variable kann danach entfernt
werden.

**Rolloutstand (2026-09-21).** `0077` und `0078` sind auf **Staging und Production** angewandt.
Die Functions sind auf beiden Projekten deployt — Production: **`create-payment` v10,
`stripe-webhook` v11**, beide ACTIVE seit 11:05.

**Production hält seit dem 2026-09-21 auch die LIVE-Credentials** — `STRIPE_SECRET_KEY_LIVE`
und `STRIPE_WEBHOOK_SECRET_LIVE`, beide im Digest-Vergleich verschieden von ihren
Sandbox-Gegenstücken, dazu ein Live-Endpoint in Stripe auf dieselbe Function-URL wie der
Sandbox-Endpoint. **Staging hat keine LIVE-Credentials und soll keine bekommen.**

**GO-LIVE am 2026-09-21: `commerce_settings.mode = live`.** Echte Kundschaft zahlt seither
echt. Der Schalter ist der letzte Schritt des Rollouts, besteht aus genau einer Spalte und ist
jederzeit durch dieselbe Einstellung zurücknehmbar.

**Ein App-Tester zahlt davon unberührt weiter in der Sandbox** (ADR-0100) — sein Zweig steht in
`payment_mode_for_user()` vor der Shop-Abfrage und kehrt bedingungslos zurück. Es gibt keinen
Schalter, Parameter oder Codepfad, der ihn nach `live` bringt.

Unmittelbar nach dem Umlegen read-only verifiziert, **13/13**: Schalter `live` · App-Tester
`sandbox` · normales Konto und Gast `live` · `commerce_access` mit dem `anon`-Schlüssel eines
Besuchers `{may_checkout: true, reason: open, is_sandbox: false}` · Baseline unverändert
(1 201 gesamt · 992 real · 209 Fixtures · 0 reserviert · 630 Bewegungen) · **durch den Schalter
selbst entstand keine Bestellung, kein Payment Attempt, kein Payment Event und keine
Lagerbewegung** · Functions `create-payment` v10, `stripe-webhook` v11, `send-order-mail` v8
alle ACTIVE.

**Der erste echte LIVE-Kauf steht noch aus** und wird anschließend read-only verifiziert —
dieselbe Kette wie bei den Sandbox-Durchläufen.

**Production-Baseline, Stand 2026-09-21: 1 201 gesamt · 992 real · 209 Fixtures · 0 reserviert ·
630 Bewegungen.** Der Sandbox-E2E `SI-2026-001008` hat `SKY-0021 loose ×1` korrekt ausgebucht
(`#769`, −1, `sale`); der Testbestand wurde danach append-only über `#770` (+1, `return`,
Notiz `sandbox test order SI-2026-001008`) zurückgeführt. Der Bestand ist deshalb wieder auf dem
Wert von vorher, die Bewegungszahl aber um zwei höher — nichts wurde gelöscht oder von Hand
korrigiert.

> **Was sich erst beim ersten Live-Kauf zeigt.** `selectStripeKey` prüft das Schlüsselpräfix
> (`sk_live_`/`rk_live_`) zur Laufzeit, und Secrets sind über die API nur als SHA-256-Digest
> sichtbar — ein vertauschter Schlüssel fällt daher erst nach Schritt 5 auf, dann aber fail
> closed: `503 provider_unconfigured` mit `stripe_key_is_test_but_mode_is_live` im Log, keine
> Fehlbuchung. Dasselbe gilt für das Live-Webhook-Secret: gehört es zu einem anderen Endpoint,
> meldet Stripes Zustellprotokoll `400 invalid_signature`. Beide Werte vor Schritt 5 im
> Dashboard gegenlesen.

Je ein Sandbox-E2E ist durchgelaufen und read-only verifiziert: `SI-2026-001065` auf Staging,
`SI-2026-001008` auf Production. Beide mit genau einer Lagerbewegung über genau die gekaufte
Menge.

Die früheren Einzelvariablen `STRIPE_SECRET_KEY` und `STRIPE_WEBHOOK_SECRET` liegen auf beiden
Projekten noch, werden vom Code aber nicht mehr gelesen und können entfernt werden.

**Ein Publishable Key wird nicht gebraucht.** SkyIsles benutzt Stripe Checkout per Redirect —
der Browser bekommt eine fertige `url` und nie einen Schlüssel. Es gibt deshalb keine
`NEXT_PUBLIC_STRIPE_*`-Variable, und es soll keine geben.

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

> Protokoll vom 2026-09-11, unverändert. **Wer diese Prüfung heute wiederholt, erwartet
> `reason = 'sale'`**: Seit `0025` bucht `convert_order_reservations()` unter dem neutralen
> Namen (ADR-0065). Die Bewegung von damals trägt weiterhin `sale_skyisles` — Historie wird nie
> umgeschrieben.

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

### Testartefakte auf Staging (Stand 2026-09-18)

Staging ist die Wegwerfumgebung, und die Verifikation von `0047`/`0049`/`0048` hat dort bewusst
Daten hinterlassen. **Keine davon ist ein echter Kundenvorgang**, und das ist strukturell
belegbar, nicht bloß behauptet:

- Alle Bestellungen laufen mit `commerce_mode = 'sandbox'`.
- Alle Adressen liegen unter `@skyisles.invalid` — `.invalid` ist nach RFC 2606 reserviert und
  kann keinem realen Postfach gehören.
- Die Widerrufserklärungen tragen ihren Testzweck im Text (`0049 race`, `0049 stale`).

**Widerrufe #3 und #6 stehen auf `sending`.** Sie sind die Fixtures des Race- und
Stale-Claim-Tests: beide wurden absichtlich beansprucht und nie aufgelöst. Nach der
15-Minuten-Regel aus `0049` sind sie längst wieder beanspruchbar — der Zustand heilt sich selbst
und blockiert nichts. Sie werden **nicht gelöscht**: `withdrawal_requests` ist eine
Rechtsaufzeichnung, und aus solchen Tabellen wird nicht ad hoc entfernt.

Es gibt **keine** vorgesehene Methode, einen Widerruf als erledigt zu markieren, ohne eine
Erstattung zu buchen (`handled_at` setzt nur `seller_record_refund()`). Eine erfundene Erstattung
wäre eine Falschaussage in einer Finanzaufzeichnung, also bleibt es bei der Dokumentation hier.
`seller_archive_test_orders()` aus `0046` archiviert Sandbox-**Bestellungen**, ändert aber nichts
an der Widerrufsliste: `seller_withdrawals()` filtert weder nach `commerce_mode` noch nach
`sandbox_archived_at`.

> **Offen für Production:** dass `seller_withdrawals()` Sandbox- und Live-Widerrufe vermischt,
> fällt auf Staging nicht auf, weil dort alles Sandbox ist. Vor dem produktiven Einsatz ist zu
> entscheiden, ob die Liste nach `commerce_mode` filtern soll.

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

---

## Migrationsstand der Telemetrie — was Production noch fehlt

**Stand 2026-09-17.**

| Migration | Staging | Production |
|---|---|---|
| `0035_system_set_image_override.sql` | angewandt | **absichtlich nicht** — gehört zum Bildabgleich |
| `0036_tester_feature_permissions.sql` | angewandt | angewandt |
| `0037_performance_telemetry.sql` | angewandt | angewandt |
| `0038_performance_interactions.sql` | angewandt, verifiziert | **offen — der einzige nächste Schritt** |
| `0039_shipping_is_reversible.sql` | angewandt, vom Betreiber geprüft | **offen** |
| `0040_shop_platform_responsibilities.sql` | **angewandt** | **offen** |
| `0041_three_account_authorization.sql` | **angewandt** | **offen** |
| `0042_strict_account_types.sql` | **offen** | **offen** |
| `0043_order_review_recovery.sql` | **angewandt** (2026-09-17 nachgeprüft) | **offen** |
| `0044_seller_year_to_date.sql` | **angewandt** (2026-09-17 nachgeprüft) | **offen** |
| `0045_seller_order_archive.sql` | **angewandt** (2026-09-17 nachgeprüft) | **offen** |
| `0046_sandbox_order_archive.sql` | **angewandt** (2026-09-18 nachgeprüft) | **offen** |
| `0047_legal_layer.sql` | **angewandt** (2026-09-18) | **offen** |
| `0049_withdrawal_receipt_idempotency.sql` | **angewandt** (2026-09-18) | **offen** |
| `0048_inventory_import.sql` | **angewandt** (2026-09-18) | **offen** |
| `0050_inventory_import_unchanged_summary.sql` | **angewandt** (2026-09-18) | **offen** |

**Auf Production stehen `0038` bis `0050` aus.**

### Production, Stand 2026-09-18

`0038` war bereits angewandt (das war in der Tabelle oben falsch verzeichnet). In diesem Rollout
liefen **`0039` bis `0050` in numerischer Reihenfolge** — nicht in der Staging-Historie. Production
bleibt dabei bewusst im **Sandbox-Modus**; der Wechsel auf `live` ist ein eigenes, noch offenes Gate.

**Bestand und Bestellungen blieben unverändert:** 4 Bestellungen, 222 Positionen, 971 Einheiten,
461 Bewegungen — vor und nach dem gesamten Rollout identisch.

**`sellers.contact_email` wurde einmalig gesetzt.** `0047` bewahrt bewusst einen vorhandenen Wert,
und Production trug `yulez.collectibles@gmail.com`. Nach dem Seed wurde die Spalte in einer
einzelnen, vorher und nachher geprüften Anweisung auf `info@skyisles.app` gesetzt — dieselbe
Adresse, die `SELLER_IDENTITY` und der Seed-Literal in `0047` tragen. Kein anderes Feld wurde
angefasst.

> ### Die Reihenfolge auf Staging ist `0047 → 0049 → 0048 → 0050`
>
> Nicht aufsteigend, und das ist richtig so. `0047` war bereits angewandt, als beim
> Verifizieren der Widerrufs-Quittung ein Idempotenzfehler auffiel; eine angewandte Migration
> wird nicht umgeschrieben, also bekam die Korrektur die nächste freie Nummer `0049` und lief
> **vor** dem noch offenen `0048`. Dasselbe danach mit `0050`, das einen Zählerfehler in `0048`
> korrigiert.
>
> **Die Nummer sagt, wann eine Datei geschrieben wurde; die Datenbank sagt, wann sie lief.**
> Beides darf auseinandergehen. Wer diese Kette auf einer neuen Umgebung nachzieht, wendet sie
> in **numerischer** Reihenfolge an — `0048` vor `0049` ist dort unproblematisch, weil `0049`
> nur `withdrawal_requests` aus `0047` anfasst und `0050` nur eine Funktion aus `0048` ersetzt.
> Die beiden Korrekturen sind voneinander unabhängig.

**`0048` braucht `0003`** (Bestand und Bewegungen) **und `0041`** (Verkäuferprädikat). Es legt
`inventory_imports`, `inventory_import_rows` und `inventory_import_mappings` samt sechs Funktionen
an und **schreibt keinen Bestand** (ADR-0087). Es braucht **keinen Storage-Bucket**: die Tabelle
wird nie hochgeladen. `inventory_imports.content_fingerprint` ist ein **inhaltlicher**
Fingerabdruck über die ausgelesenen Zeilen, kein Datei-Hash, und blockiert keinen Import.

**`0047` braucht `0010`/`0019`** (Bestellungen und Mail) **und `0041`** (Verkäuferprädikat), nicht
`0046`. Es legt `legal_document_versions`, `order_legal_snapshots`, `withdrawal_requests`,
`withdrawal_attempts`, `order_refunds` und `invoices` an, erweitert die erlaubten Mail-Arten, stellt
`order_mail_payload()` auf den erweiterten Umfang um und **seedet die Verkäuferidentität**
in `public.sellers` (nicht `shop_settings` — dort gibt es diese Spalten nicht; sie stammen aus
`0040`). `0047` setzt damit `0040` voraus, was der ursprüngliche Kopf der Migration nicht nannte.
(ADR-0086). Es setzt zusätzlich **zwei Trigger auf bestehende Tabellen**:
`orders_clear_client_hash_trg` auf `orders` (löscht den Missbrauchs-Fingerabdruck bei Bezahlung —
die Zusage aus `0010`, die bisher niemand ausgeführt hat) und `order_legal_snapshots_protect_trg`
(Snapshot ab dem Schreiben unveränderlich). `0010` wurde dafür **nicht** angefasst. Ohne die Migration fehlen Rechnung, Widerrufsaufzeichnung und der Versionsschnappschuss;
die Rechtsseiten selbst rendern auch ohne sie, weil ihre Texte im Code stehen.

**`0050` ersetzt genau eine Funktion aus `0048`** — `seller_create_import()` — und ändert darin
genau eine Zeile: der `unchanged`-Zähler filterte auf `status = 'pending' and delta = 0`, was
`reconcile()` nie erzeugt (delta 0 heißt `unchanged`, `pending` heißt delta ≠ 0). Der Zähler war
damit strukturell immer 0. Keine Auswirkung auf angewandten Bestand — `seller_apply_import()`
liest diese Zähler nicht —, wohl aber auf die Zusammenfassung, auf der der Betreiber eine
Bestandsänderung freigibt.

**`0049` korrigiert die Widerrufs-Quittung aus `0047`** und braucht **einen erneuten Deploy von
`send-order-mail`**. Es fügt `withdrawal_requests.receipt_attempt_at`, den Zustand `sending` und
`claim_withdrawal_receipt()` hinzu; `receipt_sent_at` ist ab jetzt einmalig beschreibbar und
`sent` ist endgültig, beides per Trigger. Reihenfolge beim Anwenden: erst `0049`, dann die
Function deployen — die Signatur von `mark_withdrawal_receipt()` bleibt unverändert, deshalb
entsteht dazwischen keine Lücke.

**Nach `0047` ist ein Deploy der Edge Functions nötig** — `send-order-mail` (neue Arten,
`SITE_URL`) und `stripe-webhook` (Annahme-Mail, Rechnungsausstellung). **`SITE_URL` muss in den
Supabase-Secrets gesetzt sein**, sonst stehen die Links in den Mails auf einer leeren Herkunft.

**`0046` braucht `0045`** (die fünf Funktionen, die es ersetzt) **und `0044`** (das Bestellprädikat,
das diese Funktionen aufrufen). Es fügt `orders.sandbox_archived_at`/`sandbox_archived_by` samt
CHECK hinzu, stellt fünf Lesefunktionen auf `commerce_mode = 'live'` um und legt die drei
Testbestellungs-Funktionen an (ADR-0084). Ohne die Migration bleiben Testbestellungen in der
normalen Liste und `/business/orders/test` ist leer.

**`0045` braucht `0041`, den Commerce-Kern (`0010`/`0018`/`0024`) und `0044`** — letzteres wegen
`order_counts_as_placed()`, der geteilten Definition einer echten Bestellung (ADR-0083). **`0044`
läuft also vor `0045`.** `0042` und `0043` braucht es nicht. Es legt `order_attention()`, drei Archivfunktionen, `seller_open_order_counts()`, die
Tabelle `seller_monthly_reports` und drei Berichtsfunktionen an und stellt `admin_orders()` per
`create or replace` auf die neue Regelfunktion um (**gleiche Signatur, gleicher Rückgabetyp** —
deshalb ohne `drop`). Ohne die Migration bleibt `/business/orders` in der Aktuell-Ansicht leer,
`/business/reports` zeigt jeden Monat als „noch nicht erstellt", und das Arbeitsabzeichen zeigt 0
(ADR-0082).

### Wie der Stand am 2026-09-17 nachgeprüft wurde (zweite Prüfung)

**`0044` und `0045` sind inzwischen angewandt** — zwischen den Arbeitsrunden. Sie werden deshalb
**nicht mehr geändert**; die Korrekturen aus ADR-0084 stehen in `0046`.

### Wie der Stand am 2026-09-17 nachgeprüft wurde

Nicht aus dieser Tabelle, sondern aus der Datenbank: ein schreibfreier Probelauf ruft je Migration
eine Funktion auf, die es nur dort gibt, und liest den Fehlercode — `PGRST202`/`42883` heißt „gibt
es nicht" (nicht angewandt), `42501` heißt „gibt es, und sie hat uns abgewiesen" (angewandt).
Ergebnis: **`0043` ist auf Staging angewandt**, obwohl diese Tabelle es als offen führte; `0044`
und `0045` sind es nicht. Die Zeile oben ist entsprechend korrigiert.

**`0044` braucht nur `0041`** (das Verkäuferprädikat) — nicht `0042` und nicht `0043`. Es legt
`order_counts_as_placed()` und `seller_year_to_date()` an, keinen Index (`orders_placed_idx` aus
`0010` genügt); ohne die Migration zeigt die Shop-Übersicht beide Kennzahlen als 0 (ADR-0081/0083).

**`0043` braucht nur `0041`** (das Verkäuferprädikat) und das Bestandsjournal aus `0003`/`0025` —
nicht `0042`. Die Reihenfolge `0042` vor `0043` ist trotzdem die natürliche. `0036` und `0037` sind dort angewandt und
werden **nicht** erneut ausgeführt.

**`0038`, `0039` und `0040` sind voneinander unabhängig** — Telemetrie, Bestellabwicklung und
Zuständigkeitstrennung. Die Reihenfolge zwischen ihnen ist frei; keine braucht etwas aus `0035`.
**`0041` braucht `0040`**, **`0042` braucht `0041`**; die drei laufen in dieser Reihenfolge.

### Warum `0040` nicht mehr angefasst wird

`0040` ist auf Staging angewandt. Danach fiel auf, dass die Versandkostengrenze auf dem
Plattform-Singleton lag statt beim Verkäufer (ADR-0076). Eine angewandte Migration wird dafür
**nicht umgeschrieben**: ein frischer Datenbestand und Staging liefen sonst durch verschiedene
Historien zum selben Schema, und genau das macht Migrationen unprüfbar. Die Verschiebung steht
deshalb in `0041`, samt Datenübernahme. `shop_settings.free_shipping_threshold` bleibt eine
Migration lang bestehen und wird von nichts mehr gelesen; `0042` kann die Spalte entfernen.

**Ein frischer Datenbestand** wendet `0001 … 0040 … 0041` der Reihe nach an und erreicht exakt
denselben Zustand wie Staging nach `0041`.
`0040` braucht `sellers` (0026), `platform_settings` (0019 als `business_settings`, in `0026`
umbenannt), `shop_settings` (0007) und
`create_order()` (0028).
`0039` braucht `orders`, `order_lines`, `order_events`, `skylanders`, `series` und
`is_shop_admin()`, alles seit `0010` bzw. `0003` vorhanden.

**`0038` hängt nicht an `0035`.** Es braucht `auth.users` (0001), `is_shop_admin()` (0003) und
`has_tester_permission()` (0036) — mehr nicht; `system_set_image_override()` kommt darin nicht vor.
`0035` bleibt auf Production unangewandt, und das ändert an `0038` nichts.

**Die Reihenfolge war nie beliebig:** `0037` und `0038` rufen beide `has_tester_permission()` aus
`0036` und scheitern ohne es laut, ohne eine halbe Installation zu hinterlassen. `0038` und `0037`
sind voneinander unabhängig — ohne `0038` ist der Bericht ein reiner Navigationsbericht und sagt
das auch.

**Additiv.** Keine Zeile wird geändert, keine Spalte gelöscht, keine bestehende Funktion
umsigniert.

**Nach einer Migration ist noch nichts an.** Die Telemetrie misst erst, wenn ein Konto im
Adminbereich unter „Testkonten" die Berechtigung `performance_tracking` hat. Ohne diesen Schritt
ändert `0038` am Verhalten der Seite nichts.

**`0038` ist unabhängig von `0037`.** Es ergänzt nur eine zweite Tabelle; ohne `0038` bleibt der
Bericht ein reiner Navigationsbericht und sagt das auch. `0037` ohne `0038` ist ein gültiger
Zustand, `0038` ohne `0036` nicht.

**Rücknahme.** `0038`: `drop function` auf die drei Funktionen, `drop table perf_interactions`.
`0037`: `drop function` auf die vier Funktionen, `drop table perf_navigations`.
`0036`: die vier Tabellen und die Funktionen droppen — `commerce_testers` steht dafür bewusst noch
als Spiegel da und ist aktuell (ADR-0071).
