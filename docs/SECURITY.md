# Security und Datenschutz

Stand: 2026-09-03. Sicherheit hat in diesem Projekt Vorrang vor Bequemlichkeit und vor
Entwicklungsgeschwindigkeit.

Leitsatz, direkt aus dem Legacy-Projekt übernommen:

> **Interne Daten werden nicht versteckt — sie sind gar nicht erst da.**
> Eine clientseitige Prüfung genügt nicht. Was nicht öffentlich sein darf, kommt weder ins
> ausgelieferte Bundle noch in die Datenbank noch ins Repository.

---

## 1. Sicherheitsgrenzen

| Grenze | Was sie schützt | Wie sie durchgesetzt wird |
|---|---|---|
| Legacy ↔ PortalVault | interne Geschäftsdaten | `../webpage` ist read-only; Import nur aus dem bereits geprüften öffentlichen Export |
| Öffentlich ↔ Benutzerdaten | fremde Sammlungen | Row Level Security in Postgres |
| Client ↔ Server | Secrets | nur ANON-Key im Browser; Service-Role-Key ausschließlich lokal |
| Repository ↔ Öffentlichkeit | Secrets, interne Daten | `.gitignore` + Prüfung vor jedem Commit größerer Datenbestände |
| Deployment | Produktivumgebung | kein Deploy ohne ausdrückliche Freigabe des Nutzers |

---

## 2. Daten, die niemals ins Repository, in die Datenbank oder ins Deployment dürfen

Aus der Analyse von `../webpage`:

| Quelle | Inhalt | Warum verboten |
|---|---|---|
| `skylanders.xlsx` | Käuferdaten (`Order 2025/2026`), Buchhaltung (`EÜR`), private Sammlung (P/Q/R/S, U/V/W/X), Lagerzahlen (D/E/F), Werte (L/M/N) | personenbezogene und geschäftliche Daten |
| `backup/*.xlsx` | 430 MB Original mit Bildern, dieselben internen Daten | s. o., zusätzlich Repository-Größe |
| `data/inventory.json` | 820 echte Lagerstückzahlen | Geschäftsdaten |
| `data/mappings/*.json` | Zuordnung zur externen Preisquelle | Geschäftsgeheimnis |
| `data/logs/price-updates/` | Laufprotokolle, Quell-URLs, Datei-Hashes | Geschäftsdaten |
| `data/ebay.json` | Verkaufslistings | Geschäftsdaten |
| `etl/update_prices.py` | Scraping-Logik, Quell-URLs, User-Agent | Geschäftsgeheimnis |
| `images/master/` | 430 MB PNG | gehört nicht in Git; Derivate genügen |
| Ankauffaktor `Summary!E23` | Ausgaben ÷ Marktwert = Einkaufsmarge | abgeleitete Geschäftskennzahl |
| Serien `ZB`, `DI A` | Zubehör, Disney Infinity | in V1 nicht öffentlich |
| Artikel mit ` - BESCHÄDIGT`, ` - OBERTEIL`, ` - UNTERTEIL` | interne Lagerpositionen | 14 Artikel, gehören nicht in den Katalog |

**Strukturelle Absicherung:** PortalVault liest `skylanders.xlsx` **nie** direkt. Der einzige
zulässige Eingang ist `site/data/products.json` — ein Export, den das Legacy-Projekt bereits
durch `guard_public()` geprüft hat. Damit kann keine interne Spalte auf diesem Weg entstehen.

Zusätzlich prüft der Import in PortalVault erneut (nicht auf die Quelle vertrauen):
keine internen Namenssuffixe, nur die sechs öffentlichen Serien, keine verbotenen Feldnamen
(`stock`, `total`, `sold`, `inventory`, `buyer`, `available`, `purchaseRate`, …).

---

## 3. Row Level Security

**Grundregeln**

1. RLS wird auf **jeder** Tabelle in `public` aktiviert — auch auf rein öffentlichen.
   Eine Tabelle ohne Policy ist damit für Clients vollständig gesperrt: der sichere Ausgangszustand.
2. Jede schreibende Policy hat **`WITH CHECK`**, nicht nur `USING`. Sonst könnte ein Benutzer
   eine eigene Zeile auf eine fremde `user_id` umschreiben.
3. `user_id` wird **nie** aus dem Client übernommen, sondern serverseitig aus `auth.uid()`
   gesetzt bzw. per Policy erzwungen.
4. Schreibrechte auf Katalogtabellen gibt es für Clients gar nicht — nur die Service Role
   (lokales Import-Werkzeug) schreibt dort.

**Entwurf (noch nicht angelegt):**

```sql
alter table public.series           enable row level security;
alter table public.categories       enable row level security;
alter table public.skylanders       enable row level security;
alter table public.profiles         enable row level security;
alter table public.collection_items enable row level security;

-- Katalog: für alle lesbar, für niemanden über die API schreibbar
create policy "catalog readable"  on public.skylanders for select using (true);
create policy "series readable"   on public.series     for select using (true);
create policy "categories readable" on public.categories for select using (true);

-- Profile: in V1 privat - nur das eigene Profil lesen und aendern (ADR-0016)
create policy "own profile read"   on public.profiles for select
  using (auth.uid() = id);
create policy "own profile update" on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

-- Sammlung: strikt privat
create policy "own collection read"   on public.collection_items for select
  using (auth.uid() = user_id);
create policy "own collection insert" on public.collection_items for insert
  with check (auth.uid() = user_id);
create policy "own collection update" on public.collection_items for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own collection delete" on public.collection_items for delete
  using (auth.uid() = user_id);
```

**Vor jedem Deployment zu prüfen:** Für jede Tabelle mit `anon`-Zugriff wird ausdrücklich
festgehalten, welche Spalten öffentlich sind. Eine neue Spalte auf einer öffentlich lesbaren
Tabelle ist automatisch öffentlich — deshalb kommen interne Felder gar nicht erst in diese
Tabellen.

**Entschieden (ADR-0016):** `profiles` **und** `collection_items` bekommen in V1 **keine**
öffentliche SELECT-Policy. Ein Benutzer liest und ändert ausschließlich seine eigenen Daten.
Es gibt keine öffentlichen Benutzerprofile in V1. Katalogdaten sind öffentlich lesbar und für
normale Benutzer niemals änderbar — die Katalogtabellen haben gar keine schreibende Policy.
Öffentliche Profile und Sammlungen werden später über Flags (`profiles.is_public`,
`profiles.collection_public`) und erweiterte Policies ergänzt; restriktiv starten ist leichter
zu öffnen als umgekehrt.

---

## 4. Secrets und Umgebungsvariablen

| Variable | Wo | Im Browser | Wirkung |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local`, Vercel | ja | kein Secret |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local`, Vercel | ja | **kein Secret** (ADR-0017) |
| `SUPABASE_SERVICE_ROLE_KEY` | **nur** `.env.local` | **nie** | **umgeht RLS vollständig** |

**Der Anon-/Publishable-Key ist kein Secret (ADR-0017).** Die Sicherheit des Systems darf
niemals davon abhängen, dass er verborgen ist. Die tatsächliche Sicherheitsgrenze besteht aus
Supabase Auth, PostgreSQL Row Level Security, korrekten Policies und der serverseitigen
Geheimhaltung privilegierter Keys. Jede Policy wird so geschrieben, als wäre der Anon-Key
öffentlich bekannt — denn das ist er.

Regeln:

- `.env*` wird **nie** committet. Es gibt genau eine committete Datei: `.env.example` mit
  Platzhaltern, ohne echte Werte.
- Kein Secret trägt jemals das Präfix `NEXT_PUBLIC_`. Die beiden `NEXT_PUBLIC_`-Variablen oben
  sind ausdrücklich keine Secrets.
- Der Service-Role-Key wird ausschließlich vom lokalen Import-Werkzeug benutzt. Er wird **nicht**
  in Vercel hinterlegt, solange es keinen serverseitigen Anwendungsfall dafür gibt.
- Keine Secrets in Logs, Fehlermeldungen, Screenshots oder Commit-Messages.
- Gerät ein Key doch in einen Commit: **Key in Supabase rotieren**. Der Verlauf lässt sich
  praktisch nicht zuverlässig bereinigen — Rotation ist die richtige Antwort.

---

## 5. Git-Sicherheit

Geplante `.gitignore`-Strategie (**noch nicht angelegt** — dieser Durchlauf schreibt nur Doku):

```gitignore
# Secrets
.env
.env.*
!.env.example

# Node / Next
node_modules/
.next/
out/
*.tsbuildinfo

# Legacy- und interne Daten — dürfen dieses Repository nie erreichen
*.xlsx
*.xlsm
data/internal/
**/inventory.json
**/mappings/
images/master/

# System
.DS_Store
```

Weitere Regeln:

- **Vor dem ersten Commit größerer Datenbestände** wird geprüft, ob sie wirklich öffentlich
  sind. Für Katalogdaten heißt das: Feldliste durchsehen, nicht nur die Dateigröße.
- `git status` und `git diff --stat` vor jedem Commit ansehen. Kein `git add -A` bei
  Datenimporten.
- Das Repository ist derzeit privat bzw. wird als solches behandelt — das ersetzt keine der
  Regeln oben. Ein Repository kann versehentlich öffentlich werden.
- Niemals `../webpage` in dieses Repository einbinden (kein Submodul, kein Symlink, kein Kopieren).

---

## 6. Anwendungssicherheit

- **Keine eigene Passwortspeicherung** (siehe `docs/AUTH.md`).
- **Keine Autorisierungsentscheidung im Client.** Middleware und UI sind Komfort; die Grenze ist RLS.
- **Eingaben validieren**, auch wenn RLS greift: Menge als positive Ganzzahl, `sky_id` gegen das
  Format `^SKY-\d{4}$`, Benutzername gegen die erlaubte Zeichenmenge und die Liste reservierter
  Systemnamen.
- **Kein `dangerouslySetInnerHTML`** für Katalog- oder Benutzerdaten. React escaped von selbst;
  das Legacy-Projekt musste dafür eine eigene `escape()`-Funktion pflegen.
- **Keine Preisänderung über den Client.** Marktpreise sind zentral und ausschließlich über den
  Import (Service Role) änderbar.
- **Fehlermeldungen** verraten keine internen Details, keine SQL-Fehler, keine Stacktraces.

---

## 7. Datenschutz (DSGVO)

Sobald Benutzerkonten existieren, werden personenbezogene Daten verarbeitet:

- Gespeichert werden E-Mail (in `auth.users`), Benutzername, optional Land/Avatar und die
  Sammlung. **Nicht** gespeichert: Klartextpasswörter, Zahlungsdaten, Adressen.
- Vor einer öffentlichen Beta erforderlich: Impressum, Datenschutzerklärung, Rechtsgrundlage,
  Hinweis auf Supabase und Vercel als Auftragsverarbeiter, Speicherorte/Region der Daten.
- **Entschieden (ADR-0015):** Das Supabase-Projekt wird in einer **EU-Region** angelegt.
  Bei der Anlage in V1.2 ausdrücklich prüfen; die konkrete Region wird danach hier nachgetragen.
- **OPEN:** Self-Service-Kontolöschung und Datenexport in V1 oder später.
- Keine Übertragung von Benutzerdaten an externe APIs ohne ausdrückliche Freigabe des Nutzers.

---

## 8. Deployment-Sicherheitsregeln

1. **Kein Deployment ohne ausdrückliche Freigabe** des Nutzers.
2. Vor dem ersten Deploy: RLS-Policies durchgehen, mit einem zweiten Testkonto prüfen, dass
   fremde Sammlungen weder lesbar noch änderbar sind.
3. In Vercel liegen nur die beiden `NEXT_PUBLIC_`-Variablen. Kein Service-Role-Key.
4. Supabase: Redirect-URL-Allowlist auf die tatsächlichen Domains beschränken.
5. Preisupdates bleiben ein lokales Admin-Werkzeug und sind niemals aus dem Browser erreichbar —
   dieselbe Regel wie im Legacy-Projekt.
6. Nach dem Deploy stichprobenartig als **anonymer** Besucher prüfen, welche Daten die API
   herausgibt.

---

## 9. Das Legacy-Projekt schützen

`../webpage` ist die letzte funktionierende Fassung des bisherigen Systems und enthält die
einzige vollständige Datenquelle. Deshalb:

- keine Schreibzugriffe, keine Skriptausführung, kein Git, keine Formatierung, keine Umbenennung
- `backup/skylanders_original_2026-08-10_mit-bildern.xlsx` niemals überschreiben
  (SHA-256 `2fbc5eb6730795c04f2c28d6469df1cef70aa0bb0100571c2bdb545ac5a3faa6`)
- im Zweifel: Befehl nicht ausführen und den Nutzer fragen
