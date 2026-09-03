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
- **OPEN:** Darf ein Benutzername später geändert werden? Wenn ja, braucht es eine
  Sperrfrist und eine Historie, damit alte Profil-Links nachvollziehbar bleiben.

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
- Kontolöschung: `auth.users` löschen kaskadiert auf `profiles` und `collection_items`.
  **OPEN:** Self-Service-Löschung in V1 anbieten? (DSGVO-relevant, siehe `docs/SECURITY.md`.)

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
das Projekt verlangt also E-Mail-Bestätigung. Für das Auth-UI (V1.5) heißt das: nach der
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

## 9. Offene Punkte

- **OPEN:** Darf ein Benutzername später geändert werden?
- **OPEN:** Self-Service-Kontolöschung und Datenexport (DSGVO) in V1 oder später.
