# Deployment

Wie SkyIsles öffentlich erreichbar wird — und was dabei **nicht** mitfliegt.

Stand: 2026-09-06. Aktuelle Stufe: **temporäre Testadresse auf `*.vercel.app`**,
kein offizieller Start, `skyisles.de` noch nicht verbunden.

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
| Site URL | `https://<projekt>.vercel.app` |
| Redirect URLs | `https://<projekt>.vercel.app/**` |
| Redirect URLs | `http://localhost:3000/**` |

Die Site URL ist der Rückfall, wenn die App keine gültige Origin mitschickt
(Formular ohne Hydration). Sie zeigt deshalb auf die Testadresse, nicht auf
localhost. Der localhost-Eintrag hält die lokale Entwicklung am Leben.

Beim späteren Wechsel auf `skyisles.de` kommt die neue Domain hinzu, und die
Site URL wandert dorthin; der `vercel.app`-Eintrag darf bleiben oder gehen.

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

**Checkliste zum Start von `skyisles.de`:**

1. `robots`-Block in `src/app/layout.tsx` entfernen
2. `src/lib/layout/robots.test.ts` entfernen (der Test schlägt sonst fehl —
   genau dafür ist er da)
3. diesen Abschnitt und `PROJECT_STATUS.md` aktualisieren

---

## Deployment-Prozess

**Production von `main`, keine Previews als Testadresse.** Vercel gibt einem
Production-Deployment eine stabile Adresse (`https://<projekt>.vercel.app`),
die bei jedem Push auf `main` aktualisiert wird. Preview-URLs enthalten den
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
