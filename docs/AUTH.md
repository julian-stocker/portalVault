# Authentifizierung

Stand: 2026-09-03 — **geplant, noch nichts implementiert.**

Grundsatz: **Wir bauen kein eigenes Passwortsystem.** Registrierung, Passwort-Hashing,
E-Mail-Verifizierung, Token, Sessions und Passwort-Reset übernimmt Supabase Auth vollständig.
PortalVault speichert **niemals** ein Passwort, einen Hash oder ein Reset-Token.

---

## 1. Umfang in V1

| Funktion | V1 | Anmerkung |
|---|---|---|
| Registrierung mit E-Mail + Passwort | ✅ | |
| E-Mail-Verifizierung | ✅ | Login erst nach Bestätigung |
| Login / Logout | ✅ | |
| Session-Verwaltung | ✅ | Cookie-basiert, `@supabase/ssr` |
| Passwort vergessen / zurücksetzen | ✅ | |
| Passwort ändern (eingeloggt) | ✅ | |
| Benutzerprofil, eindeutiger Benutzername | ✅ | siehe Abschnitt 4 |
| Geschützte Seiten | ✅ | Middleware + RLS |
| Google / Apple Login | ❌ | LATER, ändert das Modell nicht |
| Zwei-Faktor | ❌ | LATER |

---

## 2. Abläufe

### Registrierung

1. Formular: E-Mail + Passwort (+ optional gewünschter Benutzername).
2. `supabase.auth.signUp()` → Supabase legt den Benutzer in `auth.users` an und verschickt die
   Bestätigungsmail.
3. Ein Datenbank-Trigger legt die zugehörige Zeile in `public.profiles` an (`id = auth.users.id`,
   `username = NULL`).
4. Der Benutzer klickt den Link → `/auth/callback` tauscht den Code gegen eine Session.
5. Ohne Benutzername → Weiterleitung auf `/onboarding`, wo er ihn setzt.

Der Trigger setzt **keinen** Benutzernamen, damit die Kontoanlage nie an einem Namenskonflikt
scheitern kann. Die Eindeutigkeit prüft die Datenbank beim späteren `UPDATE`
(`unique` auf `profiles.username`), nicht die Anwendung.

Umgesetzt in `supabase/migrations/0001_initial_schema.sql`, ausgeführt und **funktional
verifiziert**: der Trigger legt nachweislich je neuem Auth-Benutzer genau eine Profilzeile an
(Abschnitt 8).

```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

**Warum `SECURITY DEFINER` hier notwendig ist:** Der INSERT in `auth.users` läuft als
`supabase_auth_admin`. Diese Rolle hat keine Rechte auf `public.profiles` — ohne erhöhte
Rechte würde jede Registrierung fehlschlagen.

**Härtung:**

- `set search_path = ''` und vollständig qualifizierte Objektnamen. Kein Schema im
  `search_path` eines Aufrufers kann eine eigene `profiles`-Tabelle unterschieben.
- **Es wird ausschließlich `new.id` verwendet** — eine von Supabase Auth erzeugte UUID.
  Weder E-Mail noch `raw_user_meta_data` werden gelesen: **kein benutzerkontrollierter Wert
  gelangt in den privilegierten Kontext.** Der Benutzername wird anschließend vom Benutzer
  selbst über ein RLS-geprüftes UPDATE gesetzt.
- `on conflict (id) do nothing` — die Registrierung scheitert nicht an einer bereits
  vorhandenen Zeile.
- `revoke all ... from public, anon, authenticated` — die Funktion ist für Clients nicht
  direkt aufrufbar.

### Login

`supabase.auth.signInWithPassword()`. Ist die E-Mail nicht bestätigt, lehnt Supabase ab.
Fehlermeldungen bleiben allgemein („E-Mail oder Passwort ist falsch") — sie verraten nicht,
ob ein Konto existiert.

### Logout

`supabase.auth.signOut()`, danach Redirect auf die Startseite und Revalidierung der
serverseitig gerenderten Seiten, damit keine Benutzerdaten aus dem Cache stehen bleiben.

### Passwort vergessen / zurücksetzen

1. `resetPasswordForEmail(email, { redirectTo: '/auth/reset' })`.
2. **Immer dieselbe Bestätigungsmeldung**, unabhängig davon, ob die Adresse existiert
   (keine Konto-Enumeration).
3. Link → `/auth/callback` → temporäre Session → `/auth/reset` → `updateUser({ password })`.

### Passwort ändern (eingeloggt)

`supabase.auth.updateUser({ password })` in einem geschützten Bereich.

---

## 3. Sessions

- `@supabase/ssr` speichert die Session in **httpOnly-Cookies**, nicht im `localStorage`.
- Next.js Middleware erneuert bei jedem Request das Access-Token und schreibt die Cookies zurück.
- Server Components und Server Actions erzeugen jeweils einen Supabase-Client **pro Request**
  mit den Cookies des Benutzers. Es gibt keinen geteilten, langlebigen Client auf dem Server.
- Der Browser-Client verwendet ausschließlich den **ANON-Key**.

---

## 4. Profil und Benutzername

`public.profiles` (Details: `docs/DATABASE.md`):

| Feld | Regel |
|---|---|
| `id` | = `auth.users.id`, 1:1, `ON DELETE CASCADE` |
| `username` | `text`, nullbar, `^[a-zA-Z0-9_]{3,20}$`, case-insensitiv eindeutig, reservierte Namen ausgeschlossen |
| `display_name`, `avatar_url`, `country` | optional |

- **Keine E-Mail-Adresse in `profiles`** — sie bleibt in `auth.users` und wird nie öffentlich.
- Der Benutzername ist die spätere öffentliche Identität (öffentliche Profile, Marketplace).
  Er wird deshalb von Anfang an eindeutig und mit fester Zeichenmenge geführt (ADR-0016).
- **Case-insensitive Eindeutigkeit ohne `citext`** (ADR-0020): ein Unique-Index auf
  `lower(username)`. Die getippte Schreibweise bleibt für die Anzeige erhalten, `Julian` und
  `julian` kollidieren. **Konvention für den Code:** jede Suche nach einem Benutzernamen muss
  `lower(username) = lower($1)` verwenden, sonst greift der Index nicht.
- **Reservierte Systemnamen werden von Anfang an abgelehnt** (ADR-0016). Umgesetzt als
  CHECK-Constraint `profiles_username_not_reserved` mit derzeit 58 Namen, case-insensitiv
  verglichen: `admin`, `api`, `auth`, `login`, `support`, `portalvault`, `skylanders`,
  `collection`, `profile`, `settings`, `dashboard`, `impressum`, `datenschutz` und weitere.
  Die Durchsetzung liegt in der **Datenbank**, nicht im Client. Die Liste zu erweitern
  erfordert eine neue Migration — beabsichtigt: einen Namen zu sperren ist eine bewusste
  Entscheidung. Das UI sollte dieselbe Liste zusätzlich vorab prüfen, um eine bessere
  Fehlermeldung zu zeigen.
- **Profile und Sammlungen sind in V1 privat** (ADR-0016): ein Benutzer liest und ändert
  ausschließlich seine eigenen. Öffentliche Benutzerprofile sind kein V1-Feature.
- **Entschieden (ADR-0016):** Ein Benutzername darf geändert werden. Weil
  `collection_items.user_id` auf `auth.users(id)` zeigt und nicht auf den Namen, kann eine
  Umbenennung strukturell keine Daten verlieren.

---

## 5. Geschützte Routen

Zwei Ebenen, bewusst getrennt:

1. **Middleware (Komfort):** Anfragen an `(app)`-Routen ohne gültige Session werden auf
   `/login?next=…` umgeleitet. Das verhindert leere, kaputte Seiten — es ist **keine**
   Sicherheitsgrenze.
2. **RLS (Sicherheit):** Jede Zeile in `collection_items` und jede Änderung an `profiles` wird
   in Postgres gegen `auth.uid()` geprüft. Auch ein direkter API-Aufruf mit gültigem Token
   kommt an fremde Daten nicht heran.

**Regel: Eine Prüfung im Client oder in der Middleware ersetzt niemals eine RLS-Policy.**
Das ist dieselbe Regel wie im Legacy-Projekt, wo eine clientseitige `if (isAdmin)`-Prüfung
ausdrücklich nicht genügte — interne Daten wurden gar nicht erst ausgeliefert.

---

## 6. Sicherheitsgrenzen

- Kein eigenes Passwort-Handling, kein eigenes Token-Handling.
- Die Sicherheitsgrenze sind Supabase Auth, RLS und korrekte Policies — **nicht** die
  Geheimhaltung des Anon-Keys, der ausdrücklich kein Secret ist (ADR-0017).
- Service-Role-Key niemals in Auth-Flows, niemals im Browser, niemals mit `NEXT_PUBLIC_`.
- Keine Konto-Enumeration: Login- und Reset-Meldungen sind unspezifisch.
- Rate Limiting für Registrierung, Login und Reset kommt von Supabase; die Standardwerte
  werden vor der Beta geprüft.
- E-Mail-Vorlagen und die Redirect-URL-Allowlist werden in der Supabase-Konsole konfiguriert.
  Für die Beta müssen dort ausschließlich die tatsächlichen Domains eingetragen sein
  (offene Redirects vermeiden).
- Kontolöschung: `auth.users` löschen kaskadiert auf `profiles`, `collection_items` und
  `shop_admins`. Gebuchte Shop-Bewegungen bleiben erhalten, ihr `created_by` wird auf `NULL`
  anonymisiert (`on delete set null`, ADR-0037) — die Geschäftshistorie überlebt, der
  Personenbezug nicht.
  **OPEN:** Self-Service-Löschung in V1 anbieten? (DSGVO-relevant, siehe `docs/SECURITY.md`.)

### Rollen und Berechtigungen — seit `0003` gibt es `shop_admins`

**In V1 gibt es keine Rollen.** Jeder angemeldete Benutzer hat exakt dieselben Rechte, und
Autorisierung heißt heute ausschließlich: *„gehört diese Zeile mir?"* — durchgesetzt von RLS
über `auth.uid()`.

Der spätere First-Party-Shop bringt die **erste echte Rollenunterscheidung** (ADR-0032).
Damit sie nicht falsch gebaut wird, stehen die Randbedingungen schon jetzt fest:

1. **Die E-Mail-Adresse ist keine Berechtigung.** Sie identifiziert ein Konto, mehr nicht —
   auch beim Geschäftsaccount. Autorisiert wird ausschließlich über die stabile `user_id` und
   `shop_admins`. Eine hart codierte Adresse als Autorisierungsregel — im Client, im
   Server-Code, in einer Policy oder in einer Umgebungsvariable — ist ausgeschlossen. Die
   konkrete Adresse ist später nur **Eingabe** für das Rollenvergabewerkzeug.
1b. **Umgesetzt (2026-09-05).** `0003_shop_foundation.sql` legt `shop_admins (user_id, granted_at,
   note)` an — für Clients weder les- noch schreibbar — und `public.is_shop_admin()` als einziges
   Autorisierungsprädikat. Der Geschäftsaccount ist und bleibt ein **normaler Supabase-Auth-User**:
   `auth.users` → `profiles`, Registrierung über `/register` wie bei jedem anderen. Die Rolle
   kommt später als zusätzliche Zeile in `shop_admins` dazu, vergeben durch ein eigenes Werkzeug
   über die Service Role. Kein Business-Signup, keine zweite Auth-Tabelle, keine Adresse im Code.
2. **Die Rolle darf nicht auf `profiles` liegen.** `profiles` ist vom Benutzer selbst
   beschreibbar: `grant select, insert, update … to authenticated` plus `profiles_update_own`.
   Eine Spalte `role` oder `is_shop_admin` dort **könnte sich jeder Benutzer selbst setzen** —
   Rechteausweitung mit einem einzigen PostgREST-Aufruf.
3. **Vergeben wird sie außerhalb des Benutzerpfads**, über `service_role` oder eine
   `security definer`-Funktion — nie durch den Benutzer, nie durch den Client.
4. **Geprüft wird sie serverseitig, aus `getUser()`**, nie aus einem Claim, den der Browser
   mitschickt, und nie erst im UI. Ein ausgeblendeter Button ist keine Berechtigung.
5. **Ohne Rolle keine Wirkung:** Ein normaler Benutzer, der eine Shop-Admin-Aktion direkt
   aufruft, muss abgewiesen werden — von RLS und von der Server Action, nicht von der Anzeige.

**Nichts davon ist implementiert.** Es gibt keine Rollenspalte, keine Rollentabelle und keine
Shop-Policy.

---

## 7. E-Mail-Versand

**Entschieden (ADR-0018):** In der lokalen Entwicklung wird **kein** externer SMTP-Anbieter
integriert — der Supabase-Standardversand genügt zum Testen. Er ist stark limitiert und für
eine öffentliche Beta nicht geeignet.

**Vor der öffentlichen Beta** muss der produktive E-Mail-Versand separat entschieden und
eingerichtet werden (Anbieter, Absenderdomain, SPF/DKIM, Zustellbarkeit). Das ist ein
kostenpflichtiger externer Dienst und braucht die ausdrückliche Freigabe des Nutzers.

## 8. Funktionale Verifikation (V1.2C) — **bestanden**

`tools/verify-rls.mts`, ausführbar mit `npm run verify:rls`.

**Ausgeführt am 2026-09-04 gegen das PortalVault-Supabase-Projekt: 31/31 Prüfungen bestanden,
`Functional RLS verification passed.`**

**Zweck.** Beweisen, dass die Policies mit **echten authentifizierten Sessions** greifen und
dass `on_auth_user_created` bei jedem neuen Auth-Benutzer genau eine Profilzeile anlegt.
Die strukturelle Verifikation aus V1.2B zeigte nur, dass die Regeln *so konfiguriert sind* —
dieser Lauf zeigt, dass sie *wirken*.

**Rollentrennung — der Kern des Tests.**

| Rolle | wofür | wofür ausdrücklich nicht |
|---|---|---|
| Service Role | Testfixture anlegen, zwei Testbenutzer erzeugen, alles wieder aufräumen | **keine einzige Prüfaussage** — sie umgeht RLS und würde nichts beweisen |
| Anon-Key + Benutzer-JWT | **jede** Prüfaussage | — |

**Anlage der Testbenutzer.** Das Skript versucht zuerst den normalen Weg
`supabase.auth.signUp()`. Verlangt das Projekt eine E-Mail-Bestätigung, liefert `signUp` keine
Session; dann legt das Skript den Benutzer über `auth.admin.createUser({ email_confirm: true })`
an und meldet ihn anschließend **normal per `signInWithPassword` an**. In beiden Fällen trägt
der Client danach ein echtes Benutzer-JWT, und in beiden Fällen feuert `on_auth_user_created`,
weil der Trigger an `INSERT ON auth.users` hängt.

**Im Lauf vom 2026-09-04 griff der zweite Weg** (`admin.createUser + signInWithPassword`) —
das Projekt verlangt also E-Mail-Bestätigung. Für das Auth-UI (V1.4) heißt das: nach der
Registrierung gibt es **keine** sofortige Session, der Benutzer muss erst den Bestätigungslink
öffnen. Das entspricht dem in Abschnitt 2 beschriebenen Ablauf.

**Testfixture** (minimal, kontrolliert, **keine Legacy-Daten**):

| Tabelle | Datensatz |
|---|---|
| `series` | `code='TEST'`, `label='RLS Test Series'`, `release_year=2026`, `position=99` |
| `categories` | `series_code='TEST'`, `position=0`, `name='RLS Test Category'` |
| `skylanders` | `sky_id='SKY-9999'`, `name='RLS Test Figure'`, `slug='rls-test-figure'`, `market_price=9.99` |

`SKY-9999` ist die höchste vom Format erlaubte ID und wird vom Legacy-Ledger nie vergeben
(`highest_issued = 820`) — eine Kollision mit echten Katalogdaten ist damit ausgeschlossen.
Das Skript räumt in einem `finally`-Block alles wieder ab: Sammlungseinträge, beide Auth-Benutzer,
Figur, Kategorie, Serie.

**Teardown im Lauf vom 2026-09-04 vollständig erfolgreich.** Zeilenzahlen danach:
`series=0, categories=0, skylanders=0, profiles=0, collection_items=0`. Weder Testfixture noch
Test-Auth-Benutzer sind in der Datenbank verblieben; sie ist wieder im Zustand direkt nach der
Migration.

**Geprüfte Fälle — alle 31 bestanden:**

| Gruppe | Prüfungen | Ergebnis |
|---|---:|---|
| `on_auth_user_created`: je Benutzer genau **ein** Profil, `username` startet `NULL` | 4 | ✅ |
| Eigenes Profil lesen und ändern (beide Benutzer) | 3 | ✅ |
| Fremdes Profil weder lesen noch ändern (beide Richtungen) | 4 | ✅ |
| Eigenes Profil nicht löschbar (keine DELETE-Policy) | 1 | ✅ |
| Fremdes Profil nach allen Versuchen nachweislich unverändert | 1 | ✅ |
| Eigene `collection_items` anlegen, ändern, lesen | 4 | ✅ |
| Fremde Einträge weder lesen, ändern, löschen noch für andere anlegen | 4 | ✅ |
| Eintrag nicht auf eine fremde `user_id` umschreiben (`WITH CHECK`, beide Richtungen) | 2 | ✅ |
| Fremder Eintrag nach allen Versuchen intakt · eigener löschbar | 2 | ✅ |
| Katalog für Angemeldete lesbar, aber weder änderbar noch erweiterbar | 3 | ✅ |
| Anonym: Katalog lesbar, Profile und Sammlungen nicht | 3 | ✅ |
| **Summe** | **31** | **31/31** |

**Damit ist bewiesen, nicht nur konfiguriert:** Ein angemeldeter Benutzer kommt an fremde
Profil- und Sammlungsdaten weder lesend noch schreibend heran, kann den Katalog nicht
verändern, und ein anonymer Besucher sieht ausschließlich den Katalog.

## 9. Umsetzung V1.4 — **gebaut**

Umgesetzt am 2026-09-04 und **vollständig verifiziert** — automatisiert und in einem
manuellen Durchlauf mit einer echten E-Mail-Adresse. Abweichungen vom Plan stehen in 9.10,
die Verifikation in 9.11.

### 9.1 Was bereits steht

Die Datenbankseite ist fertig und funktional verifiziert (V1.2C, 31/31): `profiles` mit
`username`-Constraints, Unique-Index auf `lower(username)`, die 58 reservierten Namen, die drei
RLS-Policies und der Trigger `on_auth_user_created`. **V1.4 baut ausschließlich die
Anwendungsseite.**

### 9.2 Abhängigkeit

`@supabase/ssr` — die einzige neue Abhängigkeit. Sie liefert `createBrowserClient` und
`createServerClient` samt Cookie-Anbindung. `@supabase/supabase-js` ist bereits vorhanden.

### 9.3 Session-Verhalten im App Router

Drei Clients, drei Zuständigkeiten. Sie zu vermischen ist der häufigste Fehler:

| Client | Datei | Läuft in | Cookie-Zugriff |
|---|---|---|---|
| Browser | `src/lib/supabase/client.ts` | Client Components | über den Browser |
| Server | `src/lib/supabase/server.ts` | Server Components, Server Actions, Route Handlers | `cookies()` aus `next/headers`, **pro Request neu** |
| Middleware | `src/lib/supabase/middleware.ts` | Middleware | liest und schreibt Request- und Response-Cookies |

**Kein Client wird zwischen Requests wiederverwendet.** Ein modulweit gehaltener Server-Client
würde die Session eines Benutzers an den nächsten weiterreichen.

**Die wichtigste Einzelregel:**

> **In Server-Kontexten immer `supabase.auth.getUser()`, niemals `getSession()`.**
> `getSession()` liest das Cookie und vertraut ihm; der Inhalt ist manipulierbar.
> `getUser()` lässt das Token vom Auth-Server prüfen.

Die Middleware erneuert bei jedem Request das Access-Token und schreibt die Cookies zurück.
Sie läuft für alle Routen außer statischen Assets und Bilddateien.

### 9.4 Abläufe im Detail

**Registrierung.** Formular → `signUp({ email, password })`. Das Projekt verlangt
E-Mail-Bestätigung (in V1.2C belegt), also kommt **keine Session zurück**. Die Seite zeigt
danach ausschließlich „Prüfe dein Postfach" — kein automatischer Login, kein Weiterleiten auf
das Dashboard. Der Trigger legt die Profilzeile mit `username = NULL` an.

**E-Mail-Bestätigung.** Der Link führt auf `/auth/callback`, das den Code gegen eine Session
tauscht und dann weiterleitet: auf `/onboarding`, wenn `username IS NULL`, sonst auf das Ziel
aus `next` oder das Dashboard.

**Login.** `signInWithPassword`. Fehlermeldung immer allgemein: „E-Mail oder Passwort ist
falsch" — auch bei unbestätigter Adresse, damit nicht erkennbar wird, ob ein Konto existiert.

**Logout.** `signOut()`, danach Redirect und Revalidierung, damit keine serverseitig
gerenderten Benutzerdaten im Cache stehen bleiben.

**Passwort vergessen.** `resetPasswordForEmail(email, { redirectTo })`. **Immer dieselbe
Bestätigungsmeldung**, unabhängig davon, ob die Adresse existiert.

**Passwort zurücksetzen.** Link → `/auth/callback` → temporäre Session → `/auth/reset` →
`updateUser({ password })`.

**Passwort ändern.** Im geschützten Bereich, ebenfalls `updateUser`.

**Onboarding.** `UPDATE profiles SET username = ... WHERE id = auth.uid()`, durch die
`profiles_update_own`-Policy abgesichert.

**Benutzernamen ändern.** Technisch derselbe UPDATE (ADR-0016). Keine Sperrfrist in V1.

### 9.5 Ein Befund, der die Umsetzung prägt

**Es kann keine Live-Verfügbarkeitsprüfung für Benutzernamen geben.**

`profiles` ist privat (ADR-0016) — ein Benutzer sieht per RLS **ausschließlich seine eigene
Zeile**. Eine Abfrage „ist `julian` schon vergeben?" liefert deshalb immer 0 Zeilen, egal ob
der Name frei ist oder nicht. Die Eindeutigkeit kann nur die Datenbank beantworten, und zwar
erst beim Schreiben.

**Umsetzung in V1.4:** Der UPDATE läuft, und der Fehlercode entscheidet die Meldung:

| Code | Ursache | Meldung |
|---|---|---|
| `23505` | Unique-Verletzung auf `lower(username)` | „Dieser Benutzername ist bereits vergeben." |
| `23514` | `profiles_username_format` oder `profiles_username_not_reserved` | „Dieser Benutzername ist nicht zulässig." (Format bzw. reserviert unterscheiden) |

**Verworfen für V1.4:** eine `SECURITY DEFINER`-Funktion `username_available(text)`. Sie würde
Live-Feedback ermöglichen, aber genau das aushebeln, was ADR-0016 schützt — sie erlaubte, den
Bestand an Benutzernamen abzufragen. **Sobald Profile öffentlich werden, kostet das nichts
mehr** und kann nachgeliefert werden.

Das Format (`^[a-zA-Z0-9_]{3,20}$`) und die Liste reservierter Namen werden im Client
gespiegelt, damit offensichtlich Ungültiges ohne Serverrunde abgefangen wird. **Die Spiegelung
ist eine Komfortprüfung, keine Grenze** — die Datenbank entscheidet. Beide Listen müssen
gemeinsam gepflegt werden; die Duplizierung wird in `src/lib/auth/username.ts` vermerkt.

### 9.6 Geschützter Bereich

Zwei Ebenen, wie in Abschnitt 5: Middleware leitet ohne Session auf `/login?next=…` um
(Komfort), RLS entscheidet über die Daten (Grenze). Zusätzlich prüft jede geschützte Seite
serverseitig mit `getUser()` — die Middleware allein ist kein Zugriffsschutz.

Wer eingeloggt ist, aber noch keinen Benutzernamen hat, landet auf `/onboarding`.

### 9.7 Fehlerzustände

| Situation | Verhalten |
|---|---|
| Falsche Anmeldedaten | allgemeine Meldung, kein Hinweis auf die Existenz des Kontos |
| E-Mail nicht bestätigt | dieselbe allgemeine Meldung, plus Möglichkeit, die Mail erneut zu senden |
| Bestätigungslink abgelaufen oder schon benutzt | eigene Seite mit der Möglichkeit, neu anzufordern |
| Reset-Link abgelaufen | wie oben |
| Benutzername vergeben / unzulässig | Feldfehler nach Fehlercode (9.5) |
| Rate Limit von Supabase erreicht | „Zu viele Versuche, bitte später erneut" |
| Netzwerk- oder Supabase-Ausfall | allgemeiner Fehler, **niemals** SQL-Meldungen oder Stacktraces |
| Trigger hat kein Profil angelegt | `/onboarding` legt es über `profiles_insert_own` selbst an — der bereits vorhandene Fallback |

### 9.8 Tests

Nach ADR-0013, ohne E2E:

- **Unit (Vitest):** Benutzernamen-Validierung (Format, Länge, reservierte Namen, Groß-/
  Kleinschreibung) · Zuordnung Fehlercode → Meldung · Berechnung des Redirect-Ziels nach
  Anmeldung (`next`-Parameter, Onboarding-Zwang, offene Weiterleitungen ausschließen)
- **Bestehend:** `npm run verify:rls` bleibt der Nachweis, dass die Datenbankgrenze hält
- **Manuell einmalig:** vollständiger Durchlauf mit einer echten Adresse — **am 2026-09-04
  erfolgreich absolviert**, siehe 9.11. Der Supabase-Standardversand ist stark limitiert und
  reicht nur für die Entwicklung (ADR-0018).
- **Später:** Playwright, sobald Auth und Sammlung stabil sind

### 9.9 Neue Dateien und Routen

```
src/proxy.ts                           Token-Erneuerung, Schutz der (app)-Routen
src/lib/supabase/client.ts             Browser-Client
src/lib/supabase/server.ts             Server-Client, pro Request
src/lib/supabase/middleware.ts         Cookie-Anbindung für die Middleware
src/lib/auth/username.ts               Format, reservierte Namen, Validierung   + Test
src/lib/auth/errors.ts                 Fehlercode -> deutsche Meldung           + Test
src/lib/auth/redirect.ts               sicheres Redirect-Ziel                   + Test
src/lib/auth/actions.ts                Server Actions fuer alle Schreibvorgaenge
vitest.config.mts                      Alias @/ fuer die Tests

src/app/(auth)/login/page.tsx          Anmeldung
src/app/(auth)/register/page.tsx       Registrierung
src/app/(auth)/verify-email/page.tsx   "Prüfe dein Postfach"
src/app/(auth)/forgot-password/page.tsx
src/app/(auth)/reset-password/page.tsx neues Passwort setzen
src/app/(auth)/auth-error/page.tsx     abgelaufener oder ungültiger Link
src/app/(auth)/layout.tsx

src/app/auth/callback/route.ts         Code gegen Session tauschen, dann weiterleiten
src/app/auth/signout/route.ts          Logout (POST)

src/app/(app)/onboarding/page.tsx      Benutzernamen setzen
src/app/(app)/dashboard/page.tsx       geschützte Startseite
src/app/(app)/settings/page.tsx        Benutzername und Passwort ändern
src/app/(app)/layout.tsx               prüft getUser(), erzwingt Onboarding

src/components/auth/auth-form.tsx      Client-Wrapper um eine Server Action
src/components/auth/form-field.tsx     Feld, Meldung, Button, Karte
```

Ergänzt wird `src/lib/i18n/de.ts` um alle Beschriftungen und Meldungen — kein Text im JSX
(ADR-0019).

### 9.10 Was beim Bauen anders kam als geplant

Drei Punkte, die der Plan nicht vorhersah:

**1. `middleware` heißt in Next 16 `proxy`.** Der Build meldete die alte Dateikonvention als
veraltet. Statt auf einer abgekündigten Schnittstelle aufzusetzen, liegt die Datei als
`src/proxy.ts` mit `export async function proxy(...)`. Ausführungsmodell und `config.matcher`
sind unverändert; der Build weist sie als `ƒ Proxy (Middleware)` aus.

**2. Formularfelder sind Daten, keine Render-Funktion.** Der erste Entwurf gab `AuthForm` eine
Render-Prop mit. Der Build brach ab: *„Functions cannot be passed directly to Client
Components."* Eine Funktion überquert die Server/Client-Grenze nicht. `AuthForm` bekommt
stattdessen eine serialisierbare Feldbeschreibung (`FieldConfig[]`) — dieselbe gemeinsame
Fehler- und Pending-Behandlung, ohne den Grenzverstoß.

**3. Eine `"use server"`-Datei darf nur async Funktionen exportieren.** Die Konstante
`NO_ERROR` und ein Re-Export von `ONBOARDING_PATH` in `actions.ts` ließen den Build scheitern.
Beides gehört ohnehin in die Module, aus denen es stammt.

Alle drei fielen erst im **Production Build** auf, nicht in Lint oder Typecheck. Der Build
gehört deshalb weiter zur Pflichtprüfung (ADR-0013).

### 9.11 Verifikation

**Automatisiert:** `npm test` 46 Tests · `npm run lint` · `npm run typecheck` ·
`npm run build` (13 Routen) — alle grün.

**Smoke-Test gegen den Produktionsserver (2026-09-04):**

| Prüfung | Ergebnis |
|---|---|
| `/`, `/login`, `/register`, `/forgot-password`, `/verify-email`, `/auth-error` | ✅ alle 200 |
| `/dashboard` ohne Session | ✅ 307 → `/login?next=%2Fdashboard` |
| `/settings` ohne Session | ✅ 307 → `/login?next=%2Fsettings` |
| `/onboarding` ohne Session | ✅ 307 → `/login?next=%2Fonboarding` |
| `/auth/callback` ohne Code | ✅ → `/auth-error` |
| `?next=https://evil.example` | ✅ verworfen, Formular trägt `/dashboard` |
| `?next=//evil.example` | ✅ verworfen, Formular trägt `/dashboard` |
| `?next=/dashboard` | ✅ übernommen |

**Manueller Durchlauf mit echter E-Mail-Adresse (2026-09-04) — vollständig erfolgreich:**

| Schritt | Ergebnis |
|---|---|
| Registrierung mit echter Adresse | ✅ |
| Bestätigungsmail erhalten, Link geöffnet | ✅ |
| Weiterleitung ins Onboarding | ✅ |
| Benutzernamen gesetzt | ✅ |
| Dashboard als angemeldeter Benutzer erreichbar | ✅ |
| Abmelden | ✅ |
| Erneut anmelden | ✅ |
| Passwort-Reset-Mail erhalten | ✅ |
| Passwort geändert | ✅ |
| Anmeldung mit dem neuen Passwort | ✅ |
| Benutzernamen unter Einstellungen geändert (ADR-0016) | ✅ |
| Dashboard und Einstellungen danach weiterhin funktionsfähig | ✅ |

Damit ist auch die **E-Mail-Zustellstrecke belegt**: Bestätigungs- und Rücksetzmail kommen an,
die Links funktionieren, und `exchangeCodeForSession` im Callback liefert eine gültige Sitzung.
Das gilt für den **Supabase-Standardversand in der Entwicklung**. Für eine öffentliche Beta
sagt es nichts über Zustellraten aus — dafür braucht es einen eigenen Anbieter (ADR-0018).

Die Namensänderung im letzten Schritt ist zugleich der praktische Beleg für ADR-0016: Nach dem
Umbenennen funktionieren Dashboard und Einstellungen unverändert, weil alle Beziehungen an der
UUID hängen und nicht am Namen.

### 9.12 Ausdrücklich nicht in V1.4

Google-/Apple-Login · Zwei-Faktor · öffentliche Profile · Avatar-Upload · Sperrfrist für
Namensänderungen · Self-Service-Kontolöschung · eigener SMTP-Anbieter (ADR-0018) · jede Form
von Katalog- oder Sammlungs-UI (das ist V1.5).

---

## 9.13 Die Signup-Antwort wird vollständig ausgewertet (Befund und Fix, 2026-09-05)

**Vorher.** `signUpAction` las aus `supabase.auth.signUp()` ausschließlich `error`. `data` wurde
nie betrachtet — weder `data.user` noch `data.user.identities`.

**Zwei Folgen.**

**1. `error: null` war nie ein Erfolgsnachweis.** Ein erfolgreicher Aufruf endet in `redirect()`,
das eine Ausnahme wirft; die Aktion **gibt bei Erfolg gar keinen Zustand zurück**. Ein
`{"error":null}` im Server-Log ist der Startwert von `useActionState`. Steht dort eine
Fehlermeldung, hat sie der **vorige** Versuch erzeugt — beim Lesen der Logs leicht zu verwechseln.

**2. Eine bereits registrierte Adresse war von einer neuen nicht zu unterscheiden.** Bei
aktivierter E-Mail-Bestätigung antwortet Supabase auf eine Registrierung mit vorhandener Adresse
absichtlich **ohne Fehler** und liefert einen Benutzer mit **leerem `identities`-Array**. Das ist
Supabases Schutz gegen Konto-Enumeration und richtig — die Oberfläche schickte den Besucher
dann aber auf „Prüfe dein Postfach", obwohl **keine Mail** kommt.

Kein Rechte- oder Sitzungsproblem: Es entstand keine Sitzung, kein Konto, keine Berechtigung.
Ein **UX-Fehler**, der wie ein Auth-Fehler aussieht.

### Was jetzt entscheidet

`signUpOutcome(data, error)` in `src/lib/auth/errors.ts` — eine reine Funktion, `null` heißt
„darf auf `/verify-email`":

| Antwort von Supabase | Ergebnis |
|---|---|
| `error` gesetzt | bisherige Übersetzung über `signUpError` — 429 bleibt „Zu viele Versuche…" |
| kein `error`, `user` vorhanden, `identities` nicht leer | **Erfolg** → `/verify-email` |
| kein `error`, `user` vorhanden, `identities` ist `[]` | neutrale Meldung, **kein** Erfolg |
| kein `error`, kein `user` | generischer Fehler, **kein** Erfolg |

**Eine fehlende Session ist ausdrücklich kein Fehler.** Bei aktivierter Bestätigung ist genau das
die Form des Erfolgs; `data.session` wird deshalb nicht geprüft.

**`identities` fehlt ≠ `identities` ist leer.** Nur ein vorhandenes, leeres Array zählt; ein
nicht mitgeliefertes Feld würde sonst echte Registrierungen abweisen.

**Die Meldung bestätigt kein Konto:** „Die Registrierung konnte nicht abgeschlossen werden.
Falls du hier schon ein Konto hast, melde dich an oder setze dein Passwort zurück."
Sie passt auf jede der beiden Ursachen und verrät keine, bleibt aber handlungsfähig. Die
Enumerationsfreiheit aus Abschnitt 6 bleibt damit erhalten.

### Origin: entschärft, nicht endgültig gelöst

Das versteckte `origin`-Feld in `AuthForm` rendert serverseitig als leerer String und wird erst
bei der Hydration gesetzt — im ausgelieferten HTML steht nachweislich `name="origin" value=""`.
Ein Absenden davor erzeugte ein **relatives** `emailRedirectTo` (`"/auth/callback"`).

`safeOrigin()` in `src/lib/auth/redirect.ts` normalisiert den Wert jetzt und liefert `null` für
alles, was kein einfacher http(s)-Origin ist — leer, relativ, protokoll-relativ, mit
Zugangsdaten, mit angehängtem Pfad. Ist er `null`, wird die Redirect-Option **weggelassen**
statt kaputt gesendet; Supabase nimmt dann die in der Konsole konfigurierte Site URL, wo auch
die Redirect-Allowlist liegt. Das gilt für Registrierung **und** Passwort-Reset.

Der Wert kommt weiterhin vom Client und wird deshalb nur noch als Vorschlag behandelt, nie
ungeprüft. **Die saubere Lösung wäre eine konfigurierte Site-URL** statt eines Formularfelds;
das berührt Umgebungsvariablen und das noch nicht eingerichtete Deployment und bleibt daher ein
eigener Schritt (`docs/ROADMAP.md`, V1.7).

### Was unverändert bleibt

Der Ablauf ist derselbe: `/register` → `signUp` → Bestätigungsmail → `/auth/callback` →
Onboarding. Der **Geschäftsaccount durchläuft genau diesen Weg wie jeder andere Nutzer** — keine
Sonderbehandlung, keine zweite Registrierung, keine hart codierte Adresse. Das Rate-Limit-Verhalten
ist unverändert, es gibt keine automatischen Wiederholungen.

## 10. Offene Punkte

- **Entschieden (ADR-0016):** Benutzernamen **dürfen** geändert werden. Die technische
  Identität ist ausschließlich die UUID; `username` ist nie Schlüssel. V1.4 ermöglicht die
  Änderung technisch. Eine Sperrfrist ist keine V1-Anforderung — sie wird erst relevant, wenn
  Profile öffentlich werden.
- **OPEN:** Self-Service-Kontolöschung und Datenexport (DSGVO) in V1 oder später.
- **OPEN:** Wie wird die spätere Rolle `shop_admin` getragen und vergeben? Fest steht nur, wo
  sie **nicht** hingehört (Abschnitt 6, ADR-0032). Nötig vor der ersten Shop-Schreiboperation,
  nicht vorher.
