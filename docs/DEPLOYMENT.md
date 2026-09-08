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

## Reservierungen aufräumen — `pg_cron`, erst mit B2.2

`public.expire_stale_checkouts()` gibt abgelaufene Reservierungen frei und schließt die
Bestellungen, die mit ihnen verfallen sind. **Noch nicht eingerichtet**, weil es ohne Zahlungen
nichts aufzuräumen gibt und `reserve_for_order()` ohnehin synchron räumt.

Wenn es so weit ist, im SQL-Editor:

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
stehen.

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

### Aufräum-Migration — noch nicht angelegt

Sie besteht aus einer Anweisung:

```sql
drop function if exists public.create_order(text, text, jsonb, jsonb, text);
```

Eindeutig, weil sich die beiden in der Stelligkeit unterscheiden. **Die Datei
existiert absichtlich noch nicht:** eine Migration im Ordner, die noch nicht
angewandt werden darf, ist eine geladene Waffe — sie würde den Grundsatz
brechen, dass `supabase/migrations/` den produktiven Stand abbildet. Sie wird
angelegt, wenn entschieden ist, ob sie unmittelbar nach dem Deployment oder mit
dem nächsten Commerce-Schritt läuft.

Bis dahin ist die alte Fassung **in der Datenbank selbst** als temporär
gekennzeichnet (`comment on function`), damit niemand später zwei
`create_order` findet und raten muss.
