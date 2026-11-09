# Zugangsdaten — wo was liegt und wofür

Stand: **2026-11-09** · erhoben nur aus Dateinamen, Variablennamen, Dateirechten und dem Code.

> **Diese Datei enthält und enthält nie** Passwörter, Tokens, Schlüsselwerte oder vollständige
> Verbindungszeichenketten. Sie sagt nur, **dass** es einen Zugang gibt, **wo** er liegt und
> **wer** ihn braucht. Die Sicherheitsregeln selbst stehen in `docs/SECURITY.md`. Diese Datei
> ist das Nachschlagewerk dazu.

Die beiden Supabase-Projekte:

- **Staging:** `qqxcpesbwfxzgytkdsac`
- **Production:** `zmiwxswrpkmizvqsgype`

Beide Referenzen sind öffentlich (sie stehen in jeder Projekt-URL) und als Konstanten in
`tools/lib/staging-db.mts` festgelegt.

---

## 1. Auf dem Rechner des Betreibers

| Ort | Umgebung | Enthält (nur Namen) | Wer benutzt es | Rechte |
|---|---|---|---|---|
| `skyisles/.env.local` | **Production** | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (öffentlich), **`SUPABASE_SERVICE_ROLE_KEY`** | `npm run dev` (**Production-Daten!**) und jedes `:prod`-Werkzeug: Importe, `verify:*:prod`, `admin:grant`, Katalog-Sync/-Publish, `transfer:*` als Ziel | 600 |
| `skyisles/.env.staging` | **Staging** | dieselben drei Namen für Staging | `dev:staging`, `dev:staging:lan`, jedes `:staging`-Werkzeug, die Staging-Guards (`tools/lib/staging-guard.mts` vergleicht Ziel gegen diese Datei), `transfer:*` als Quelle | 600 |
| `~/.skyisles/staging-db.env` | **Staging-Datenbank** | `SKYISLES_STAGING_DB_URL`: Rolle **`skyisles_agent`**, Session-Pooler | `db:check:staging`, `db:privileges:staging`, die lesenden Schritte von `db:migrate:staging`, M-03A-Probe. **Nur lesend** (ADR-0140): Die Rolle darf 12 von 78 Tabellen lesen und nichts schreiben | 600, Ordner 700 |
| `~/.skyisles/staging-operator.env` | **Staging-App-Konto** | `SKYISLES_STAGING_OPERATOR_EMAIL`, `…_PASSWORD`: ein Betreiber-Login der **Website** (Supabase Auth), **kein** Datenbankkonto | `verify:sales-reconciliation`, `verify:recon-refusals`, `verify:recon-0180`, `probe:recon-0180` | 600, Ordner 700 |
| `~/.skyisles/supabase-ca.crt` | beide | öffentliches Wurzelzertifikat des Supabase-Poolers, **kein Geheimnis** | TLS-Vollprüfung (`verify-full`) aller direkten Datenbankverbindungen | 600 |
| `~/.ssh/id_ed25519` | GitHub | SSH-Schlüssel | `git push`/`pull` zu `github.com:julian-stocker/portalVault` | 600, Ordner 700 |
| `~/.supabase/` | – | nur Versions- und Telemetriedateien der CLI, **kein Token** | – | 700 |

**Nicht vorhanden** (bewusst): `~/.pgpass`, `~/.pg_service.conf`, `PGPASSFILE` in der Shell,
Anmeldungen für die Vercel-, GitHub- oder Supabase-CLI, irgendein Datenbankpasswort der Rolle
`postgres`.

---

## 2. In den Diensten hinterlegt, nicht auf dem Rechner

| Wo | Umgebung | Namen | Wofür |
|---|---|---|---|
| **Vercel**, Environment Variables | Production | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`VERCEL_GIT_COMMIT_SHA` setzt Vercel selbst) | die Website `skyisles.app`. **Kein** Service-Role-Key bei Vercel (`docs/DEPLOYMENT.md`) |
| **Supabase Edge-Function-Secrets**, je Projekt | Staging und Production getrennt | `STRIPE_SECRET_KEY_LIVE`, `STRIPE_SECRET_KEY_SANDBOX`, `STRIPE_WEBHOOK_SECRET_LIVE`, `STRIPE_WEBHOOK_SECRET_SANDBOX`, `RESEND_API_KEY`, `MAIL_FUNCTION_SECRET`, `MAIL_FROM`, `SITE_URL`, `ALLOWED_ORIGINS`. `SUPABASE_URL`, `SUPABASE_ANON_KEY` und `SUPABASE_SERVICE_ROLE_KEY` setzt Supabase selbst | `create-payment`, `stripe-webhook`, `send-order-mail`. Stripe-Schlüssel liegen **nur** hier, nie im Repository und nie bei Vercel |
| **Supabase-Dashboard**, je Projekt | Staging und Production getrennt | Datenbankpasswort der Rolle `postgres` | voller Datenbankzugang. Lokal **nirgends** gespeichert. Nur für Handgriffe des Betreibers, z. B. einen Schema-Dump |
| Supabase-SQL-Editor | beide | deine Dashboard-Anmeldung | die schreibenden Operationsdateien (`supabase/operations/*.sql`) |
| Stripe, Resend, GitHub, Vercel, Supabase | – | deine Konto-Logins (ggf. im macOS-Schlüsselbund) | Verwaltung |

---

## 3. Welcher Zugang für welchen Zweck

| Zweck | Staging | Production |
|---|---|---|
| Website lokal | `.env.staging` (`dev:staging`) | `.env.local` (`dev`, nur bewusst) |
| Website live | – | Vercel-Variablen |
| Zahlung und Mail | Function-Secrets Staging | Function-Secrets Production |
| Datenbank lesen und prüfen | `staging-db.env` (`skyisles_agent`) | kein lokaler Datenbankzugang |
| Migration schreiben | SQL-Editor (Dashboard-Login) | SQL-Editor (Dashboard-Login), eigene Freigabe |
| Werkzeuge per API (Importe, `verify:*`) | Service-Role-Key aus `.env.staging` | Service-Role-Key aus `.env.local` |
| Prüfungen als angemeldeter Betreiber | `staging-operator.env` | – |
| Tests (`npm test`) | keine echten Zugangsdaten nötig. Manche Tests erwarten nur, dass die Variablennamen gesetzt sind (Platzhalter genügt) | – |
| Deployment | `git push` (SSH-Schlüssel). Vercel baut Production aus `main` | dasselbe |

---

## 4. Was eine Passwortänderung trifft

| Wird geändert | Betroffen | Nicht betroffen |
|---|---|---|
| **Staging-`postgres`-Passwort** | nur Handgriffe, die es eintippen (z. B. der M-03-Schema-Dump) | **kein** lokales Werkzeug, kein Test, Website, Edge Functions, `skyisles_agent`, Operator-Login. Geprüft: Kein Code liest `SUPABASE_DB_URL`/`DATABASE_URL` oder ein `postgres`-Passwort |
| Passwort von `skyisles_agent` | `~/.skyisles/staging-db.env` muss nachgezogen werden | alles andere |
| Operator-Passwort (Website-Login) | `~/.skyisles/staging-operator.env` | alles andere |
| Service-Role-Key Staging (Schlüsselrotation) | `.env.staging`, alle `:staging`-Werkzeuge | Website live |
| Service-Role-Key Production | `.env.local`, alle `:prod`-Werkzeuge | Vercel (hält ihn nicht) |
| Anon-Key Production | `.env.local` **und Vercel**, danach neu deployen | – |
| Stripe- oder Resend-Schlüssel | nur Function-Secrets des Projekts | lokal nichts |

---

## 5. Für M-03 (Restore-Test) benötigt

- **Genau eines:** das `postgres`-Datenbankpasswort von **Staging**. Der Betreiber gibt es beim
  `pg_dump` interaktiv ein. Es wird **nicht** gespeichert.
- Alles andere ist vorhanden: das CA-Zertifikat und der Ablageort
  `~/SkyIsles-Daten/dr/staging-schema-20261109/` (Rechte 700).
- `skyisles_agent` reicht dafür nicht (M-03A), und seine Rechte bleiben bewusst unverändert.

---

## 6. Regeln für den Umgang mit Zugangsdaten

1. **Werte stehen nie** im Repository, in `docs/`, in Logs, in Commit-Messages oder in einem Chat.
   Diese Datei nennt nur Namen. `.gitignore` sperrt `.env*` (Ausnahme `.env.example`).
2. **Dateien mit Zugangsdaten tragen Rechte 600**, ihre Ordner außerhalb des Repositorys Rechte 700
   (`~/.skyisles/`, `~/SkyIsles-Daten/`).
3. **Der Service-Role-Key gehört nie in Client-Code** und nie hinter `NEXT_PUBLIC_`. Bei Vercel liegt er gar nicht.
4. **Passwörter werden interaktiv eingegeben**, nicht in eine URI oder Kommandozeile geschrieben
   (sie stünden in `ps` und in der Shell-History). `tools/dr/lib.sh` lehnt eine URI mit Passwort ab.
5. **Jedes schreibende Werkzeug prüft sein Ziel**, bevor eine Verbindung entsteht
   (`tools/lib/staging-guard.mts`, festgelegte Projekt-IDs).
6. **Der lesende Prüfzugang bleibt lesend.** Seine Rechte werden für einen Test nicht erweitert.
7. **Editor-Kopien sind Zugangsdaten.** vim-`.swp` und nano-`.save` neben einer `.env`-Datei
   enthalten dieselben Werte und werden nach dem Bearbeiten gelöscht.
8. **Rotation nach Verdacht:** Ist ein Wert in einen Chat, ein Log oder ins Repository geraten, wird er
   im jeweiligen Dienst neu erzeugt, nicht nur gelöscht. Danach Abschnitt 4 abarbeiten.

---

## 7. Offene Hygienepunkte (Stand 2026-11-09)

| Datei | Befund | Stand |
|---|---|---|
| `~/.skyisles/.staging-operator.env.swp` | verwaiste vim-Auslagerung: Der vim-Prozess (pid 83995) lief nicht mehr, die Datei stammte vom 03.11. um 20:01, die echte Datei wurde danach (20:08) gespeichert | **gelöscht am 09.11.2026** (nach Freigabe, vorher erneut auf offene Zugriffe geprüft) |
| `~/.skyisles/staging-db.env.save` | nano-Kopie vom 19.10., älter als die gültige `staging-db.env` (25.10.). Kein Werkzeug verwies darauf | **gelöscht am 09.11.2026** (nach Freigabe) |
| `skyisles/.env.local`, `.env.staging` | Rechte waren 644 | **auf 600 gesetzt am 09.11.2026** |

Für den M-03-Schema-Dump wurde das Staging-`postgres`-Passwort vom Betreiber interaktiv eingegeben und
**nirgends gespeichert**. Die beiden Schema-Dateien unter `~/SkyIsles-Daten/dr/staging-schema-20261109/`
enthalten keine Zeilen und keine Geheimnisse (geprüft am 09.11.2026).
