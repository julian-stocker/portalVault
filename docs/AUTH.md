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

Umgesetzt in `supabase/migrations/0001_initial_schema.sql` (geschrieben, noch nicht ausgeführt):

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

## 8. Offene Punkte

- **OPEN:** Darf ein Benutzername später geändert werden?
- **OPEN:** Self-Service-Kontolöschung und Datenexport (DSGVO) in V1 oder später.
