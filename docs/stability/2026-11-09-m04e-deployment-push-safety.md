# M-04E – Deployment- und Push-Sicherheit

Stand: **2026-11-09** · Stability Baseline 1 · rein lesend, ohne Remote-Verbindung.

Es wurde nichts gepusht, deployt oder verändert.

**Zwei Arten von Aussagen**, im ganzen Bericht getrennt:

- **[REPO]** heißt: im Repository nachgeprüft.
- **[DOKU, unbestätigt]** heißt: so steht es in `docs/DEPLOYMENT.md` (geprüft am 2026-10-26). Ob das Dashboard heute noch so eingestellt ist, lässt sich lokal **nicht** feststellen.

---

## 1. Was ein Push heute auslöst

| Punkt | Befund |
|---|---|
| Ziel | `origin` = `git@github.com:julian-stocker/portalVault.git`, Branch `development/skyisles-v2`, **10 Commits voraus**, 0 dahinter, gemessen am letzten `fetch` vom 2026-11-08 10:15. Fast-Forward nach diesem Stand **[REPO]** |
| GitHub Actions | **keine**: kein `.github/`, keine Git-Hooks **[REPO]** |
| `vercel.json`, `.vercel/` | **nicht vorhanden**. Es gibt also keine Branch-Regel und keinen „Ignored Build Step“ im Repository **[REPO]** |
| Build | `next build`, ohne `prebuild`, `postbuild`, `postinstall` oder `vercel-build`. Der Build führt kein Werkzeug aus `tools/` und keine Migration aus **[REPO]** |
| Vercel-Production | wird nur aus `main` gebaut **[DOKU, unbestätigt]**. Ein Push dieses Branches löst **kein Production-Deployment** aus |
| Vercel-Preview | Vercel baut standardmäßig **jeden Push auf einen anderen Branch als Preview**. Abgeschaltet ist das laut Doku nirgends. Ein Push erzeugt daher **wahrscheinlich ein Preview** (Dashboard unbestätigt) |
| Preview-Variablen | **dieselben `NEXT_PUBLIC_SUPABASE_*` wie Production**. Ein Preview spricht mit der **Production-Datenbank** **[DOKU, unbestätigt]**. Kein Service-Role-Key auf Vercel **[DOKU]**. Kein ausgelieferter Code liest einen **[REPO]** |
| Migrationen | **kein Mechanismus im Repository**. `supabase/config.toml` beschreibt nur Edge Functions. Ob im Supabase-Dashboard eine GitHub-Integration oder Branching aktiv ist, ist **lokal nicht prüfbar**; die Doku erwähnt keine |
| Edge Functions | werden nicht durch einen Push deployt. Es gibt keine CI, und das Deployment läuft per CLI **[REPO, DOKU]** |

---

## 2. Das Preview-Risiko

### 2.1 Kann ein Preview Production verändern?

**Ja, über die gewöhnliche Anwendung.** Das ist kein Service-Role-Pfad, sondern dieselben Rechte, die die Website in Production hat: Anon-Key und angemeldete Sitzung, geschützt durch RLS und `security definer`. Wer ein Preview öffnet, arbeitet mit echten Production-Daten:

- **Konten:** Registrierung, Anmeldung, Passwort-Reset gegen Production-Auth. Die Bestätigungs-Links laufen über die Site URL `https://skyisles.app`, weil Preview-Hosts nicht in der Redirect-Allowlist stehen **[DOKU]**.
- **Kundenseite:** Sammlung, Favoriten, Warenkorb, Bestellnachrichten, Widerruf.
- **Kasse:** `create_order` ist bewusst auch anonym aufrufbar und legt in Production **Bestellungen und Reservierungen** an. Die Zahlung läuft über die Production-Edge-Function mit Stripe live. Deren `ALLOWED_ORIGINS` dürfte einen Preview-Origin abweisen. Das ist ein Function-Secret und **unbestätigt**, und die Reservierung stünde dann trotzdem.
- **Betrieb und Admin**, für angemeldete Betreiber: Bestellabwicklung, Erstattung, Orderbuch (Einkäufe, Verkäufe, Positionen), Lager, Katalogpflege, Händlerprofil, Datensicherung.
- **Telemetrie:** `recordNavigations` schreibt Messwerte von Testkonten.

### 2.2 Was setzt 0168–0186 voraus, und was passiert auf Production (0167)?

| Funktion | Migration | Verhalten auf Production **[REPO]** |
|---|---|---|
| Der gesamte CSV-Abgleich (`seller_recon_*`, Kandidaten, Konkurrenten, Sammelaktionen) | 0169–0180, 0183, 0185, 0186 | **serverseitig gesperrt**: `reconciliationEnvironment()` und `reconciliationAvailable()` lassen ihn nur zu, wenn `NEXT_PUBLIC_SUPABASE_URL` die Staging-Adresse ist. Sonst antwortet die Route 404, und der Einstieg fehlt (fail-closed, ADR-0174). Damit gibt es auf einem Production-Preview keinen Abgleich |
| Leere Familien aufräumen (`admin_delete_empty_character`) | 0168 | gesperrt über `isEditorialCatalogSource()` (nur Staging) |
| Positionskorrekturen (`seller_correct_legacy_sale_item`, `seller_sale_item_corrections`) | 0181 | nicht gesperrt. Die Funktion fehlt, der Aufruf scheitert laut (PGRST202), die Liste bleibt leer. **Kein stilles Schreiben** |
| Verkauf ohne Reservierung (`p_hold: false`) | 0184 | nicht gesperrt. Scheitert laut mit eigener Meldung (`holdOptionUnavailable`). Der normale Aufruf ist byte-gleich zu vorher |
| Betriebs- und Plattformsicherung (`seller_business_backup`, `system_platform_export`) | Neufassungen in 0174 und 0182 | Production hat ältere Fassungen. Der Code erwartet die neueren Bereiche, der Download dürfte an der Manifest-Prüfung scheitern. **Nicht geprüft** |
| Externe Bestellnummer je Kanal eindeutig, Storno extern | 0170, 0171 | Production hat den Index nicht. Der Code meldet `23505` nur, wenn er auftritt. Kein Fehler, aber auch kein Schutz |

**Serverseitige Schutzmechanismen gegen falsche Umgebungen:** Es gibt genau zwei, beide fail-closed: die Staging-Sperre für den Abgleich und die für die Katalogpflege. Einen **allgemeinen** Schutz, der eine Preview-Bereitstellung als solche erkennt und Schreibaktionen sperrt, gibt es **nicht** **[REPO]**.

### 2.3 Risiken eines Previews gegen Staging

Ein Preview gegen Staging ist der richtige Weg. Er bringt aber eigene Punkte mit:

- **Staging enthält echte Geschäftsdaten:** importierte Orderbuch-Historie, Verkäufe mit Käuferkürzeln, Daten aus eBay-Berichten. Ein Preview braucht deshalb **Zugangsschutz** (Vercel Deployment Protection) und darf nicht öffentlich sein.
- **Der Abgleich wird im Preview sichtbar und schreibt dort.** Das ist gewollt, aber nur für den Betreiber.
- **Auth:** Die Redirect-Allowlist von Staging müsste die Preview-Hosts erlauben. Jeder Eintrag erweitert die Menge der Adressen, an die Auth-Links gehen dürfen. Ein enges Muster ist besser als ein Wildcard (z. B. nur die Branch-Alias-Domain).
- **Edge Functions auf Staging:** `ALLOWED_ORIGINS` muss den Preview-Host kennen. Stripe läuft dort im Sandbox-Modus.
- **Build-Zeit:** Die `NEXT_PUBLIC_*`-Werte werden beim Build eingesetzt. Ein Preview, das **vor** der Umstellung gebaut wurde, spricht weiter mit Production und muss neu gebaut oder gelöscht werden.
- **Indexierung:** Vercel setzt auf Previews `X-Robots-Tag: noindex`, die App setzt zusätzlich `noindex` **[DOKU, REPO]**.

---

## 3. Sichere Zielarchitektur (Vorschlag)

| Umgebung | Datenbank | Schlüssel | Auslöser |
|---|---|---|---|
| **Lokal** | Staging, über `npm run dev:staging` bzw. `:lan` | `.env.staging`; der Service-Role-Key wird dem Webprozess **entzogen**, so ist es schon gebaut | manuell |
| **Vercel-Preview** | **Staging** | nur `NEXT_PUBLIC_SUPABASE_URL` und `…_ANON_KEY` von **Staging** in der Umgebung „Preview“, **kein Service-Role-Key** | Push auf einen Nicht-`main`-Branch, nur mit **Deployment Protection** |
| **Vercel-Production** | Production | nur `NEXT_PUBLIC_*` von Production in „Production“, **kein Service-Role-Key** | Push oder Merge auf `main`, nur nach Freigabe |
| **Werkzeuge** (`tools/`) | je nach Guard | Service-Role-Keys nur lokal (`.env.staging` und `.env.local`, Rechte 600). Production-Schreiben nur mit der M-04-Regel | manuell |

**Schutz gegen versehentliche Umgebungsverwechslung:**

1. **Variablen je Vercel-Umgebung trennen.** „Production“ bekommt Production-Werte, „Preview“ und „Development“ bekommen Staging-Werte. Danach bestehende Previews neu bauen oder löschen.
2. **Ein Build-Wächter im Repository** (Vorschlag, noch nicht gebaut): ein kleiner Prüfschritt, der beim Build abbricht, wenn `VERCEL_ENV=preview` mit der Production-ID gebaut wird oder `VERCEL_ENV=production` mit der Staging-ID. Er stützt sich auf `isStagingProjectUrl` und die festen IDs und ist kein neuer paralleler Mechanismus.
3. **Ein Branch-Schalter im Repository, solange (1) nicht bestätigt ist:** `vercel.json` mit `{"git": {"deploymentEnabled": {"development/skyisles-v2": false}}}` unterbindet Deployments dieses Branches unabhängig vom Dashboard. Er wirkt nur, wenn er **im gepushten Commit** steht. Das wäre eine Repository-Änderung mit eigener Freigabe.
4. **Keine automatischen Migrationen.** Keine Supabase-GitHub-Integration und kein Branching für diese Projekte. Migrationen laufen weiter ausschließlich über `db:migrate:staging` bzw. den Production-Ablauf mit getrennter Freigabe. `main` darf erst Code enthalten, der zum **Production-Schema** passt. Dazu gehört entweder eine Staging-Sperre wie beim Abgleich, oder die passenden Migrationen sind vorher auf Production gelaufen.
5. **Die Migrationsstände bleiben verschieden** (Staging 0186, Production 0167). Jede neue Funktion, die eine noch nicht ausgerollte Migration braucht, wird serverseitig auf Staging begrenzt. Das Vorbild ist `reconciliationEnvironment()`.

---

## 4. Push-Checkliste

**A. Im Vercel-Dashboard bestätigen** (Projekt → Settings), **vor** dem Push:

1. *Environment Variables:* Welche Werte tragen „Preview“ und „Development“? **Staging-URL und Staging-Anon-Key**, oder noch Production?
2. *Git:* Ist „Production Branch“ = `main`? Werden für andere Branches Previews gebaut? Gibt es einen Ignored Build Step?
3. *Deployment Protection:* Ist Vercel Authentication für Previews **aktiv**?
4. Gibt es noch alte Previews, die mit Production-Werten gebaut wurden? Falls ja, löschen oder neu bauen.

**B. Im Supabase-Dashboard**, beide Projekte:

5. Keine GitHub-Integration und kein Branching aktiv.
6. Falls ein Preview gegen Staging gewünscht ist: Redirect-Allowlist von Staging und `ALLOWED_ORIGINS` der Staging-Edge-Functions bewusst und eng ergänzen.

**C. Lokal, unmittelbar vor dem Push:**

7. `git fetch origin`, dann `git status -sb`. Erwartet: „voraus 10“, **0 dahinter**. `git merge-base --is-ancestor origin/development/skyisles-v2 HEAD` gibt Exit 0, also Fast-Forward.
8. `git log --oneline origin/development/skyisles-v2..HEAD`: genau die 10 erwarteten Commits.
9. Der Arbeitsbaum ist sauber, bis auf die zwei bewusst ausgeschlossenen Artefakte.

**D. Mögliche Auswirkung des Pushs:**

- **Production-Deployment: keins.** Der Branch ist nicht `main`.
- **Migrationen: keine.** Kein Mechanismus im Repo; B.5 bestätigt das.
- **Preview: wahrscheinlich ja.** Je nach A.1:
  - mit Production-Werten: ein Preview mit dem neuen Code gegen die Production-Datenbank (0167), also echte Daten unter einer anderen Adresse;
  - mit Staging-Werten: ein Preview gegen Staging, mit allen Funktionen inklusive Abgleich.

### Go/No-Go

| Lage | Ergebnis |
|---|---|
| A.1 **unbestätigt** oder Preview-Werte = **Production**, und Previews für den Branch **aktiv** | **NO-GO** |
| Previews für `development/skyisles-v2` **nachweislich aus** (Dashboard oder `vercel.json`-Schalter im Commit), B.5 bestätigt, C.7–C.9 grün | **GO** |
| Preview-Werte nachweislich **Staging**, Deployment Protection **aktiv**, alte Production-Previews entfernt, B.5 bestätigt, C.7–C.9 grün | **GO** |

**Heutiger Stand: NO-GO.** Nicht weil etwas kaputt ist, sondern weil A.1–A.3 und B.5 lokal nicht bestätigt werden können. Laut Doku zeigen Previews auf Production.

---

## 5. Offene Punkte

- Dashboard-Einstellungen in Vercel und Supabase: alle **unbestätigt**, siehe Checkliste.
- Verhalten der Datensicherungs-Downloads gegen das ältere Production-Schema: **nicht geprüft**.
- Der vorgeschlagene Build-Wächter und der `vercel.json`-Branch-Schalter sind **nicht umgesetzt**. Beides wäre eine Repository-Änderung mit eigener Freigabe.
