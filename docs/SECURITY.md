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

### Abgrenzung: Legacy-Lagerzahlen vs. ein späterer eigener Shopbestand

Die Tabelle oben verbietet **Legacy-Geschäftsdaten**. Ein späterer First-Party-Shop (ADR-0032)
würde eigenen Lagerbestand führen — das ist kein Widerspruch, aber die Grenze muss präzise sein,
sonst wird das Verbot beim ersten Shop-Commit stillschweigend aufgeweicht.

| | Legacy-Lagerzahlen | Shopbestand eines späteren SkyIsles-Shops |
|---|---|---|
| Quelle | `skylanders.xlsx` D/E/F, `data/inventory.json` | vom Betreiber bewusst in SkyIsles gepflegt |
| Zweck | interne Geschäftsführung | ein öffentliches Verkaufsangebot |
| Status | **verboten** in Repository, Datenbank und Deployment | zulässig **in der Datenbank**, nach ausdrücklicher Freigabe |
| Im Repository | **niemals** | **niemals** — auch Shopdaten sind Daten, kein Code |

**Was unverändert gilt, auch wenn der Shop kommt:**

1. **Der Katalogimport bleibt wie er ist.** `guard_public()` im Legacy-Projekt und die
   Feldnamenprüfung im PortalVault-Import bleiben unangetastet. Über den Katalogpfad kommt
   **kein** Bestand in die Datenbank — ein Shop-Import wäre ein **eigener, getrennter, eigens
   freizugebender** Weg.
2. **Keine Bestandsdatei im Repository.** Weder `inventory.json` noch ein Export daraus. Der
   Shopbestand lebt in der Datenbank, nie in Git.
3. **Die privaten O/C/S/D-Blöcke der Excel bleiben tabu** — OVERALL, COLLECTION, SOLD,
   DUPLICATES (P/Q/R/S, U/V/W/X). Das ist die private Sammlung des Betreibers, nicht das
   Geschäftsinventar, und sie darf auch bei einem Shop-Import nicht mitkommen.
4. **Käuferdaten und EÜR bleiben tabu.** Bestellungen entstünden später in SkyIsles selbst und
   sind dann personenbezogene Daten mit eigenen DSGVO-Pflichten (Abschnitt 7) — sie werden
   **nicht** aus der Legacy-Excel übernommen.
5. **Das öffentliche Lesefenster ist zu entscheiden, nicht zu erben.** Eine sichtbare
   Rabattstufe verrät bereits einen groben Bestand (ADR-0033). Ob überhaupt eine Stückzahl
   öffentlich wird oder nur ein Zustand, ist eine bewusste Entscheidung — **OPEN**.

**Nichts davon ist implementiert.** Es gibt keine Shop-Tabelle, keinen Shop-Import und keine
Shop-Rolle.

### Shop-Grenzen (ADR-0037) — **umgesetzt in `0003_shop_foundation.sql`**

**Die Berechtigung darf nicht in `profiles` liegen.** An der Migration nachgelesen:
`grant select, insert, update on public.profiles to authenticated` ist **tabellenweit**, und
`profiles_update_own` erlaubt jedem Nutzer das Update seiner eigenen Zeile. Eine Spalte
`profiles.role` wäre damit selbst vergebbar. Die Shop-Rolle bekommt deshalb eine eigene
Tabelle ohne jedes Client-Recht und wird nur über `public.is_shop_admin()`
(`security definer`) abgefragt.

**Sichtbarkeitsgrenzen des späteren Shops:**

| Öffentlich lesbar | Niemals öffentlich |
|---|---|
| `is_listed`, `sale_price` | **die exakte Stückzahl** — `quantity` und `reserved` |
| abgeleiteter Rabatt und Endpreis | `shop_inventory.note` (interne Notizen) |
| „Auf Lager" / „Nicht auf Lager" | `inventory_movements` **vollständig** — Bewegungen, Gründe, Notizen, Bearbeiter |
| | Einkaufspreise, sobald es sie gibt |
| | Bestellungen fremder Nutzer |
| | jede Bestandskorrektur |

**Die exakte Stückzahl bleibt intern** (ADR-0037 § 8). Öffentlich erscheint ausschließlich ein
abgeleiteter Zustand aus `quantity - reserved`: über null „Auf Lager", sonst „Nicht auf Lager".
Kein „Noch 17 verfügbar". Eine sichtbare Rabattstufe verrät später ohnehin einen groben
Bestand (ADR-0033) — die genaue Zahl zusätzlich preiszugeben wäre Geschäftsinformation ohne
Nutzen für den Käufer. Die Zahl selbst ist nur in `/shop-admin` sichtbar.

**Die konkrete Geschäfts-E-Mail ist keine Autorisierungsregel und wird nicht im Produktcode
hardcodiert.** Autorisiert wird ausschließlich über die stabile `user_id` und `shop_admins`.
Das spätere Rollenvergabewerkzeug erhält die Account-Adresse lediglich als **explizite
Eingabe** und löst daraus den bestehenden Auth-User beziehungsweise dessen `user_id` auf.
Aus demselben Grund wird die Adresse in der Dokumentation nicht als Wert geführt, sondern nur
als „der Geschäftsaccount" bezeichnet.

**Die drei Shop-Tabellen sind für Clients vollständig geschlossen.** RLS ist auf allen dreien
aktiv, **ohne eine einzige Policy**, und `anon` wie `authenticated` sind alle Tabellenrechte
entzogen. Das gilt auch für Shop-Admins: Ihr gesamter Schreibzugriff sind drei Funktionen.

Spaltenrechte wären die bequeme Lösung und die falsche gewesen — die nächste hinzugefügte
Spalte wäre wieder offen. Ein `TRUNCATE` wäre ohnehin nicht von RLS gedeckt; erst der
`revoke` schließt es.

| Rolle | `shop_admins` | `shop_inventory` | `inventory_movements` |
|---|---|---|---|
| `anon` | — | — | — |
| `authenticated` | — | — | — |
| Shop-Admin | — | nur über Funktionen | nur über Funktionen |
| `service_role` | voll | INSERT/UPDATE; Position mit Historie nicht löschbar | **nur INSERT** — Trigger verbietet UPDATE und DELETE |

**Zwei getrennte Schreibwege, getrennt durch Postgres-Rechte, nicht durch eine Fallunterscheidung
im Code.** `record_inventory_movement()` ist für `authenticated` ausführbar und prüft als Erstes
`is_shop_admin()`. `system_record_inventory_movement()` ist **ausschließlich `service_role`**
ausführbar — eine Anfrage als `anon` oder `authenticated` wird von Postgres abgewiesen, bevor
der Funktionskörper überhaupt läuft. Die gemeinsame innere Funktion
`apply_inventory_movement()` ist **keiner** Rolle ausführbar; erreichbar ist sie nur, weil die
Wrapper als Owner laufen.

Der Grund für die Trennung: Der spätere Legacy-Import läuft als Service Role und hat keine
`auth.uid()`, kann also nie Shop-Admin sein. `is_shop_admin()` dafür aufzuweichen hätte
dieselbe Tür für jeden angemeldeten Nutzer geöffnet.

**`created_by` ist nicht fälschbar.** Es ist kein Parameter der öffentlichen Wrapper: Der
Admin-Pfad setzt `auth.uid()`, der Systempfad `NULL`. NULL heißt „System" — einen Actor zu
erfinden wäre eine Falschangabe in einem Auditjournal.

**Die fachliche Bewegungshistorie ist unveränderlich und nie löschbar.** `DELETE` ist
ausnahmslos verboten, für jede Rolle — auch für die Service Role, die RLS umgeht, Trigger aber
nicht. Auch der Umweg ist zu: Der Fremdschlüssel auf `shop_inventory` ist `on delete restrict`,
eine Position mit Historie kann nicht gelöscht werden. Eine falsche Bewegung wird durch eine
Gegenbewegung korrigiert, nie überschrieben und nie entfernt.

**Eine einzige Änderung ist erlaubt, und sie dient dem Datenschutz:** Bei der Löschung des
zugehörigen Auth-Users darf `created_by` von dessen UUID auf `NULL` anonymisiert werden —
sonst wäre ein Konto, das je gebucht hat, dauerhaft nicht löschbar. Alle Sachspalten müssen
dabei identisch bleiben; UUID → andere UUID und NULL → UUID sind weiterhin blockiert. Die
Bewegungshistorie verändert sich dadurch fachlich nicht, nur der Personenbezug entfällt.

**Die Geschäfts-E-Mail kommt im Schema nicht vor** — keine Spalte, keine Policy, keine Funktion,
keine Konstante. Autorisiert wird über `shop_admins.user_id`.

### `data/characters/characters.json` gehört ausdrücklich **nicht** auf die Verbotsliste

Diese Datei liegt im Repository und darf das. Sie ist **öffentliche Produktinformation über
Spielfiguren** — Element, Spezies, Produktlinie, eine selbst geschriebene Kurzbeschreibung und
eine Quellenangabe. Sie ist mit den privaten Legacy-Geschäftsdaten aus Abschnitt 2 **nicht
gleichzusetzen**.

| | `data/characters/characters.json` | `data/inventory.json`, Excel D/E/F, Order, EÜR |
|---|---|---|
| Inhalt | Charaktermetadaten der Marke | Lagerzahlen, Käufer, Buchhaltung |
| Herkunft | von Hand kuratiert, gegen öffentliche Quellen geprüft | interne Geschäftsführung |
| Wäre sie öffentlich ein Problem? | **nein** — sie wird ohnehin ausgeliefert | **ja** |
| Im Repository | **erlaubt** | **verboten** |

**Was auch für diese Datei unverändert gilt:**

1. **Keine Stückzahlen, keine Preise, keine Käufer, keine Bestellungen** — sie enthält
   ausschließlich die in `docs/DATABASE.md` Abschnitt 3.0 aufgeführten Felder.
2. **Keine übernommenen Fremdtexte.** Externe Quellen dienen der Faktenprüfung. Jede
   Beschreibung ist selbst formuliert, und der CHECK auf 600 Zeichen setzt das strukturell
   durch statt per Richtlinie (ADR-0034).
3. **Kein Scraping.** Quellen werden gelesen und als `source_url` vermerkt, nicht automatisiert
   abgeerntet.
4. **Sie fließt nicht über den Katalogpfad.** `products.json` und `characters.json` sind zwei
   getrennte Eingänge mit zwei getrennten Werkzeugen.

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

**Umgesetzt in `supabase/migrations/0001_initial_schema.sql`**, am 2026-09-03 gegen die
PortalVault-Entwicklungsdatenbank ausgeführt und strukturell verifiziert.
Vollständige Policy-Tabelle: `docs/DATABASE.md`, Abschnitt 5.

```sql
alter table public.series           enable row level security;
alter table public.categories       enable row level security;
alter table public.skylanders       enable row level security;
alter table public.profiles         enable row level security;
alter table public.collection_items enable row level security;

-- Katalog: fuer alle lesbar, ueber die API fuer niemanden schreibbar.
-- Es existiert nirgends eine INSERT/UPDATE/DELETE-Policy fuer diese Tabellen.
create policy series_select_public on public.series
  for select to anon, authenticated using (true);
-- ... analog fuer categories und skylanders

-- Profile: privat, nur der Eigentuemer (ADR-0016)
create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
-- keine DELETE-Policy: Profile verschwinden mit dem Auth-Benutzer

-- Sammlung: strikt privat
create policy collection_items_select_own on public.collection_items
  for select to authenticated using ((select auth.uid()) = user_id);
create policy collection_items_insert_own on public.collection_items
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy collection_items_update_own on public.collection_items
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy collection_items_delete_own on public.collection_items
  for delete to authenticated using ((select auth.uid()) = user_id);
```

**Zweite Schicht: explizite Tabellenrechte — und zwar durch ENTZIEHEN.**

Supabase setzt `ALTER DEFAULT PRIVILEGES` auf das Schema `public`: `anon`, `authenticated` und
`service_role` bekommen bei **jedem** `create table` automatisch `ALL`. **`GRANT` ist additiv
und entzieht nichts.** Die gewünschten Rechte zu vergeben genügt deshalb nicht — alles
Unerwünschte muss ausdrücklich entzogen werden:

```sql
grant select on public.series, public.categories, public.skylanders to anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.series, public.categories, public.skylanders from anon, authenticated;

revoke all on public.profiles, public.collection_items from anon;

grant select, insert, update on public.profiles to authenticated;
revoke delete, truncate, references, trigger
  on public.profiles from authenticated;

grant select, insert, update, delete on public.collection_items to authenticated;
revoke truncate, references, trigger
  on public.collection_items from authenticated;
```

**`TRUNCATE` ist dabei der kritische Fall: Row Level Security gilt nicht dafür.** Policies
greifen bei `SELECT`, `INSERT`, `UPDATE`, `DELETE` und `MERGE`. `TRUNCATE` ist eine Operation
auf Tabellenebene und wird ausschließlich über das Privileg kontrolliert — das Recht ist also
das Einzige, was zwischen einem Client und einer geleerten Tabelle steht. `REFERENCES` und
`TRIGGER` haben für Endbenutzer keinen legitimen Zweck.

Eine Operation ist damit nur erlaubt, wenn **beide** Schichten sie zulassen. Ein Fehler in
einer Schicht öffnet allein noch keine Lücke — mit der genannten Ausnahme `TRUNCATE`, wo es
keine zweite Schicht gibt.

**Dritte Schicht: Constraints und Trigger.** Die Service Role umgeht RLS und Tabellenrechte —
aber **weder Constraints noch Trigger**. Genau dort liegt der Schutz der wichtigsten
Projektinvariante: `skylanders_sky_id_immutable` verweigert jede Änderung einer SKY-ID, auch
durch das Importwerkzeug (ADR-0001).

**`SECURITY DEFINER` — genau eine Funktion.** `public.handle_new_user()` legt die Profilzeile
für neue Auth-Benutzer an. Sie braucht erhöhte Rechte, weil der INSERT in `auth.users` als
`supabase_auth_admin` läuft, das keine Rechte auf `public.profiles` hat. Härtung:
`set search_path = ''` mit vollständig qualifizierten Namen, **ausschließlich `new.id`**
(eine von Supabase erzeugte UUID) als Eingabe — kein benutzerkontrollierter Wert wie E-Mail
oder `raw_user_meta_data` — und `revoke all ... from public, anon, authenticated`, damit sie
für Clients nicht aufrufbar ist.

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
| `SUPABASE_SERVICE_ROLE_KEY` | **nur** `.env.local` | **nie** | **umgeht RLS vollständig**; auch das Rollenwerkzeug läuft nur lokal damit |

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

### Adminberechtigung und redaktionelle Schreibwege (Migration `0004`, ADR-0039)

**Die Berechtigung liegt in `shop_admins`** — trotz des Namens ist das die allgemeine
SkyIsles-Adminberechtigung. Die Tabelle hat für `anon` und `authenticated` **keine Rechte und
keine Policy**: sie ist in beide Richtungen unerreichbar. Gegen die laufende Datenbank geprüft
(2026-09-06): ein Lesezugriff mit dem Anon-Key endet mit `permission denied for table
shop_admins`.

**Vergeben wird sie ausschließlich lokal**, mit `npm run admin:grant` über die Service Role.
Es gibt keinen Endpunkt, über den sich ein Client selbst befördern könnte — nicht weil er
abgesichert wäre, sondern weil er nicht existiert. Keine E-Mail-Adresse steht im Quelltext, in
einem Skript oder in dieser Dokumentation; die Adresse ist ein Argument, gespeichert wird nur
die User-ID.

**Ein Tabellen-Grant kennt keine Spalten.** `grant select on public.skylanders to anon` gilt für
jede Spalte, die die Tabelle je bekommt; RLS filtert **Zeilen**, nicht Spalten. Am 2026-09-06
gegen die laufende Datenbank gemessen: ein anonymer Client liest `select=*` und bekommt alle
zwölf Spalten zurück. Der erste Entwurf von `0004` hätte `admin_note` genau dorthin gelegt und
damit über `GET /rest/v1/skylanders?select=admin_note` öffentlich gemacht — unabhängig davon,
welche Spalten die Anwendung selektiert.

**Daher die Trennung nach Publikum, nicht nach Bequemlichkeit:**

| Öffentlich (auf `skylanders`) | Intern (`catalog_editorial`) |
|---|---|
| `catalog_visible`, `display_name_override` — beides ist Teil dessen, was Besucher sehen | `admin_note` — Notizen über Herkunft, Bestand, Vorgänge |

`edited_by`/`edited_at` gibt es gar nicht: `catalog_admin_changes` beantwortet „wer wann was",
und ein Bearbeiterfeld auf einer weltlesbaren Tabelle würde veröffentlichen, wer den Katalog
pflegt.

**Verborgene Zeilen verschwinden auch aus der API.** `0004` ersetzt die alte
`using (true)`-Policy: anonym gilt `is_active and catalog_visible`; angemeldet zusätzlich „ich
bin Admin" oder „ich besitze diese Figur" (ADR-0040). Ein direkter Supabase-Client sieht damit
dasselbe wie die Oberfläche — nicht mehr.

**Zwei Schranken vor jeder redaktionellen Änderung:**

1. `(admin)/layout.tsx` antwortet Nicht-Admins mit **404**. Das ist Bequemlichkeit, keine
   Grenze — eine ausgeblendete Schaltfläche ist keine Berechtigung.
2. Die `security definer`-Funktionen fragen `public.is_shop_admin()` selbst. Das ist die
   Grenze. Clients haben auf `skylanders` und `categories` weiterhin kein Schreibrecht, also
   gibt es daneben keinen zweiten Weg.

**Funktional nachgewiesen, nicht behauptet.** `npm run verify:editorial` prüft mit echten
Sitzungen (anonym, normaler Nutzer, Admin), dass eine verborgene Figur anonym nicht lesbar ist,
`select=*` keine interne Spalte enthält, `catalog_editorial` und `catalog_admin_changes` für
Clients unerreichbar sind, Admin-RPCs für Nicht-Admins scheitern, der Besitzer einer
nachträglich verborgenen Figur seine Sammlung vollständig sieht — und dass das Journal selbst
für die Service Role append-only bleibt. Läuft direkt nach dem Anwenden von `0004`.

**Lager: lesen ist ebenfalls eine Berechtigung (Migration `0005`).** `shop_inventory` und
`inventory_movements` haben für `anon` und `authenticated` weiterhin **keine** Tabellenrechte —
weder lesend noch schreibend. Bestand, Einkaufspreise und Bewegungen sind ausschließlich über
`admin_shop_inventory()` und `admin_inventory_movements()` erreichbar, die beide
`is_shop_admin()` fragen. Öffentlich wird später nur „Auf Lager / Nicht auf Lager" aus
`quantity - reserved` abgeleitet; **eine öffentliche Mengenanzeige gibt es nicht**.

Geschrieben wird unverändert nur über die drei Funktionen aus `0003`:
`record_inventory_movement()` (Bestand, mit Akteur aus `auth.uid()`), `set_shop_listing()`
(Preis, Angebot, interne Notiz) und `system_record_inventory_movement()` (nur `service_role`).
`quantity` wird nie zugewiesen, `reserved` von nichts in Phase 1 geschrieben.

**Was der Adminbereich nicht tut:** keine Rechteverwaltung im Browser, keine Service Role im
Client, kein Storage-Upload (noch nicht gebaut), kein Zugriff auf fremde Sammlungen.
`admin_note` ist intern und erscheint in keiner öffentlichen Projektion.

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

## 5a. Security-Review der ersten Migration

Dreistufig belegt: **statisch** gegen `0001_initial_schema.sql` (2026-09-03), **strukturell**
durch rein lesende Abfragen gegen die laufende Datenbank (2026-09-03), und **funktional** durch
`npm run verify:rls` mit zwei echten JWT-Sessions (2026-09-04, **31/31 bestanden**).
Die Antworten unten sind damit nicht nur konfiguriert, sondern nachgewiesen:

| # | Frage | Antwort | Warum |
|---|---|---|---|
| 1 | Kann `anon` Katalogdaten verändern? | **nein** | kein Schreibrecht, keine schreibende Policy |
| 2 | Kann Benutzer A das Profil von B lesen? | **nein** | `profiles_select_own` bindet an `auth.uid() = id` |
| 3 | Kann A das Profil von B verändern? | **nein** | `USING` und `WITH CHECK` binden beide an `auth.uid() = id` |
| 4 | Kann A `collection_items` von B lesen? | **nein** | `auth.uid() = user_id` |
| 5 | Kann A `collection_items` für B anlegen? | **nein** | INSERT-`WITH CHECK` erzwingt die eigene `user_id` |
| 6 | Kann A `collection_items` von B ändern? | **nein** | UPDATE mit `USING` **und** `WITH CHECK` |
| 7 | Kann A `collection_items` von B löschen? | **nein** | DELETE-`USING` bindet an `auth.uid()` |
| 8 | Kann ein Client SKY-IDs/Katalogdaten ändern? | **nein** | keine Policy, kein Recht — und zusätzlich der Immutability-Trigger |
| 9 | Gibt es einen `SECURITY DEFINER`-Pfad zu fremden Daten? | **nein** | eine Funktion, leerer `search_path`, nur `new.id`, für Clients nicht aufrufbar |
| 10 | Gibt es RLS-Tabellen mit zu breiten Policies? | **nein** | `using (true)` nur auf den drei Katalogtabellen und nur für SELECT |
| 11 | Gibt es Tabellenrechte, die RLS umgehen könnten? | **nein (nach Korrektur)** | `TRUNCATE`, `REFERENCES`, `TRIGGER` sind `anon` und `authenticated` auf allen fünf Tabellen entzogen — verifiziert |

Frage 11 kam erst durch die Ausführung ans Licht: der statische Review hatte sie nicht
abgedeckt, weil sie sich nicht aus dem SQL allein ergibt, sondern erst aus dem Zusammenspiel
mit den Default-Privilegien der Plattform. **Prüfpunkt für jede künftige Migration:** nach dem
Anlegen einer Tabelle die tatsächlichen Rechte auslesen, nicht die geschriebenen annehmen.

---

**Was damit belegt ist — und was nicht:**

| | Status |
|---|---|
| Policies, Rechte, RLS-Flags sind wie beabsichtigt konfiguriert | ✅ **strukturell verifiziert** gegen die laufende Datenbank (2026-09-03) |
| Die Regeln greifen bei echten authentifizierten Sessions | ✅ **funktional verifiziert**, 31/31 (2026-09-04) |
| Cookie-Sessions in Next.js (`@supabase/ssr`, Middleware, geschützte Routen) | ❌ existiert noch nicht — V1.4 |

**Der funktionale Zwei-Benutzer-Test (V1.2C) ist am 2026-09-04 bestanden.**
`tools/verify-rls.mts`, Start mit `npm run verify:rls` — **31 Prüfungen, 31 bestanden**,
`Functional RLS verification passed.` Aufschlüsselung: `docs/AUTH.md`, Abschnitt 8.

Nachgewiesen mit zwei echten authentifizierten Sessions:

- `on_auth_user_created` legt je neuem Auth-Benutzer **genau eine** Profilzeile an
- ein Benutzer liest und ändert ausschließlich sein eigenes Profil
- ein Benutzer liest, ändert, erzeugt und löscht ausschließlich seine eigenen `collection_items`
- `WITH CHECK` verhindert, dass ein Eintrag auf eine fremde `user_id` umgeschrieben wird
- `authenticated` kann den Katalog lesen, aber weder ändern noch erweitern
- `anon` sieht den Katalog, aber weder Profile noch Sammlungen

**Regel für den Test selbst:** Die Service Role dient ausschließlich dazu, die Testfixture und
die Testbenutzer anzulegen und wieder abzuräumen. **Keine einzige Prüfaussage** läuft über sie —
sie umgeht RLS und würde damit exakt das nicht prüfen, worum es geht. Jede der 31 Aussagen nutzt
den Anon-Key plus ein echtes Benutzer-JWT.

**Nach dem Lauf.** Testfixture und beide Test-Auth-Benutzer wurden vollständig entfernt;
alle fünf Tabellen standen danach wieder auf 0 Zeilen. In der Datenbank sind keine Testartefakte
verblieben.

**Was weiterhin nicht bewiesen ist:** die Cookie-basierte Session-Handhabung in Next.js.
Der Test spricht Supabase direkt an; `@supabase/ssr`, Middleware und geschützte Routen kommen
mit dem Auth-UI (V1.4) und brauchen dann eine eigene Verifikation.

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
   herausgibt. Stand 2026-09-06 gegen die laufende Datenbank geprüft: `skylanders`, `series` und
   `characters` sind anonym lesbar (Katalogdaten, keine internen Spalten), Schreibzugriff ist
   abgewiesen; `profiles`, `collection_items`, `shop_admins` und `inventory_movements` liefern
   für `anon` bereits `permission denied` — die Rechte fehlen, nicht nur die Policy.

Konkrete Variablen, URLs und Schritte: `docs/DEPLOYMENT.md`.

---

## 9. Das Legacy-Projekt schützen

`../webpage` ist die letzte funktionierende Fassung des bisherigen Systems und enthält die
einzige vollständige Datenquelle. Deshalb:

- keine Schreibzugriffe, keine Skriptausführung, kein Git, keine Formatierung, keine Umbenennung
- `backup/skylanders_original_2026-08-10_mit-bildern.xlsx` niemals überschreiben
  (SHA-256 `2fbc5eb6730795c04f2c28d6469df1cef70aa0bb0100571c2bdb545ac5a3faa6`)
- im Zweifel: Befehl nicht ausführen und den Nutzer fragen
