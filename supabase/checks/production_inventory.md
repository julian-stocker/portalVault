# Bestandsaufnahme Production — rein lesend

Zweck: **feststellen, wo Production wirklich steht**, bevor irgendeine
Migration erwogen wird. Zwei Teile, beide ohne jede Änderung:
A — der Migrationsstand in der Datenbank, B — was Supabase an Sicherungen
hergibt. Dauer zusammen etwa zehn Minuten.

Ich kann weder A noch B selbst erheben: Production darf nicht verbunden
werden, und ein Tarif ist über SQL ohnehin nicht ablesbar. Beides machst du,
ich werte aus.

---

## A — Migrationsstand (Supabase-SQL-Editor, Production)

Einmal einfügen und ausführen. Es ist **ein** `SELECT`: kein `DO`-Block, kein
DDL, kein DML, keine Rollenumschaltung. Gelesen werden nur Katalogtabellen und
eine Zeilenzahl aus `purchase_receipts`.

```sql
with p (nr, migration, gegenstand, vorhanden) as (values
  (101, '0121', 'seller_update_purchase (21 Parameter)',
        to_regprocedure('public.seller_update_purchase(bigint, date, numeric, text,'
          || ' text, text, numeric, numeric, numeric, text, text, boolean, text,'
          || ' text, text, text, text, text, text, text, text)') is not null),
  (102, '0122', 'purchase_receipts',
        to_regclass('public.purchase_receipts') is not null),
  (103, '0122', 'purchase_receipt_fingerprint(bigint)',
        to_regprocedure('public.purchase_receipt_fingerprint(bigint)') is not null),
  (104, '0123', 'Spalte purchase_receipts.format_version',
        exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'purchase_receipts'
                   and column_name = 'format_version')),
  (105, '0104', 'seller_business_backup()',
        to_regprocedure('public.seller_business_backup()') is not null),

  /* 0124 hat die Signatur NICHT geaendert — fuenf Parameter hat die Funktion
     schon seit 0066. Geprueft wird deshalb der RUMPF: 0124 nimmt den
     Belegzustand in die Orderbuchzeile auf. */
  (201, '0124', 'seller_orderbook_ledger nennt receipt_stale im Rumpf',
        coalesce(position('''receipt_stale''' in
          coalesce(pg_get_functiondef(to_regprocedure(
            'public.seller_orderbook_ledger(integer, integer, text, boolean, text)')),
            '')) > 0, false)),
  /* `has_function_privilege` WIRFT, wenn die Funktion nicht existiert —
     deshalb erst fragen, ob sie da ist, und sonst `null` liefern. */
  (202, '0125', 'purchase_receipt_fingerprint OHNE EXECUTE fuer authenticated',
        case when to_regprocedure('public.purchase_receipt_fingerprint(bigint)') is null
             then null
             else not has_function_privilege('authenticated',
                    'public.purchase_receipt_fingerprint(bigint)', 'execute')
        end),
  (203, '0126', 'seller_save_purchase_edit (5 Parameter)',
        to_regprocedure('public.seller_save_purchase_edit(bigint, jsonb, jsonb,'
          || ' bigint[], timestamptz)') is not null),
  (204, '0126', 'purchase_items_touch_purchase_trg',
        exists (select 1 from pg_trigger
                 where not tgisinternal
                   and tgname = 'purchase_items_touch_purchase_trg')),
  (205, '0127', 'seller_save_purchase_edit (6 Parameter, mit p_swap)',
        to_regprocedure('public.seller_save_purchase_edit(bigint, jsonb, jsonb,'
          || ' bigint[], timestamptz, jsonb)') is not null),
  (206, '0128', 'seller_issue_purchase_receipt_correction(bigint)',
        to_regprocedure('public.seller_issue_purchase_receipt_correction(bigint)') is not null),
  (207, '0128', 'Spalten supersedes_number und supersedes_issued_at',
        (select count(*) = 2 from information_schema.columns
          where table_schema = 'public' and table_name = 'purchase_receipts'
            and column_name in ('supersedes_number', 'supersedes_issued_at'))),
  (208, '0129', 'Export nennt den Belegbereich',
        coalesce(position('from public.purchase_receipts t' in
          coalesce(pg_get_functiondef(
            to_regprocedure('public.seller_business_backup()')), '')) > 0, false)),
  (209, '0130', 'Export nennt purchases.items_cost',
        coalesce(position('''items_cost'', t.items_cost' in
          coalesce(pg_get_functiondef(
            to_regprocedure('public.seller_business_backup()')), '')) > 0, false)),
  (210, '0131', 'Export nennt seller.register_court',
        coalesce(position('''register_court'', t.register_court' in
          coalesce(pg_get_functiondef(
            to_regprocedure('public.seller_business_backup()')), '')) > 0, false))
)
select nr, migration, gegenstand, coalesce(vorhanden::text, '(nicht pruefbar)') as befund
  from p
union all
select 301, '—', 'md5 des Rumpfs von seller_business_backup()',
       coalesce((select md5(pr.prosrc) from pg_proc pr
                  join pg_namespace n on n.oid = pr.pronamespace
                 where n.nspname = 'public'
                   and pr.proname = 'seller_business_backup'), '(keine Funktion)')
union all
select 302, '—', 'Laenge des Rumpfs',
       coalesce((select length(pr.prosrc)::text from pg_proc pr
                  join pg_namespace n on n.oid = pr.pronamespace
                 where n.nspname = 'public'
                   and pr.proname = 'seller_business_backup'), '(keine Funktion)')
union all
select 303, '—', 'Belege insgesamt',
       case when to_regclass('public.purchase_receipts') is null then '(keine Tabelle)'
            else (select count(*)::text from public.purchase_receipts) end
union all
select 304, '—', 'davon Korrekturbelege (Revision > 1)',
       case when to_regclass('public.purchase_receipts') is null then '(keine Tabelle)'
            else (select count(*)::text from public.purchase_receipts where revision > 1) end
order by nr;
```

### Wie das Ergebnis zu lesen ist

**101–105 müssen alle `true` sein.** Sie sind die Grundlage (`0121`–`0123`,
`0104`), laut `PROJECT_STATUS.md` auf Production angewendet. Ist eine davon
`false`, stimmt die Annahme über Production nicht und alles Weitere wartet.

**201–210 sind die eigentliche Frage.** Erwartet nach heutigem Wissen: alle
`false`. Dann ist Production auf dem Stand vor `0124`, und die Reihenfolge aus
`production_rollout_0126_0131.md` gilt unverändert — mit `0124` und `0125`
vorweg.

Einzeln bedeuten sie:

* **201 `false`** → `0124` fehlt. Es gehört **vor** `0126`, weil die
  Oberfläche dieses Änderungsbogens den Belegzustand in der Orderbuchzeile
  anzeigt. Geprüft wird hier der **Rumpf**, nicht die Signatur: `0124` hat die
  fünf Parameter nicht angefasst, die hat `seller_orderbook_ledger` schon seit
  `0066`. Kommt `(nicht pruefbar)` zurück, fehlt die Funktion ganz — dann
  stimmt die Annahme über Production nicht.
* **202 `false`** → `0125` fehlt (`authenticated` hat noch `EXECUTE` auf die
  interne Fingerabdruckfunktion). Klein, unabhängig, gehört mit.
* **205 `true`, aber 203 `false`** → unmöglich; dann ist der Stand unklar und
  es wird nichts ausgeführt.
* **207 `true` und 304 > 0** → auf Production existieren schon
  Korrekturbelege. Dann ist `R0128` dort **unzulässig**
  (`supabase/rollback/README.md`).
* **301** `= 24c3810288bb20929fe995554a267adf` wäre ein **Alarm**: das ist der
  Rumpf nach `0131`, der dort nicht sein kann. `a3c922657e1c6410858b7c4b2bb7aae5`
  (16 649 Zeichen) ist der erwartete Wert — die Fassung aus `0104`.
* **303/304** sind die Beleglage. Auf Production sollte nach
  `PROJECT_STATUS.md` **kein** Eigenbeleg existieren, weil keine ausgelieferte
  Oberfläche die Ausstellfunktion aufruft. Eine Zahl > 0 wäre ein Befund, dem
  nachzugehen ist, bevor irgendetwas migriert wird.

Bitte das Ergebnis vollständig zurückgeben (14 + 4 Zeilen). Danach kann ich
die Reihenfolge verbindlich festlegen statt sie zu vermuten.

---

## B — Supabase-Sicherungsmöglichkeiten (Dashboard, Production)

Kein SQL; das steht nirgends in der Datenbank.

1. **Projekt `zmiwxswrpkmizvqsgype` öffnen** → *Settings → General*: welcher
   **Plan** läuft (Free, Pro, Team)? Bitte wörtlich notieren.
2. *Database → Backups*: existiert dort überhaupt eine Liste?
   * **Tägliche Backups:** wie viele, wie alt ist das jüngste (Datum und
     Uhrzeit), wie lang die Rückhaltezeit?
   * **Point in Time Recovery:** aktiv ja/nein. Wenn ja: welches **Fenster**
     (z. B. „7 Tage")? Wenn nein: ist es als Zusatz **anbietbar**, und zu
     welchem Preis? (Bitte ablesen, nicht schätzen.)
3. *Settings → Billing* bzw. *Add-ons*: was würde ein Wechsel kosten, der
   PITR einschließt?
4. **Platform-Backup:** in `/admin/datensicherung` von Production — gibt es
   die Seite dort überhaupt? (Nach `PROJECT_STATUS.md` sind `0105`–`0107` auf
   Production **nicht** angewendet, die Seite ist also nicht nutzbar.)
5. **Business-Export:** in `/business/datensicherung` von Production eine
   frische Sicherung herunterladen, Dateigröße und SHA-256 notieren
   (`shasum -a 256 <Datei>`), Datei **außerhalb** des Repositories ablegen.
   Das ist nach heutigem Stand die einzige anwendungsseitige Absicherung —
   25 Bereiche, ohne Schema, Funktionen, Policies, Sequenzstände und Konten.

### Was aus den Antworten folgt

| Befund | Konsequenz |
|---|---|
| PITR aktiv, Fenster ≥ 24 h | Der Rollout hat ein echtes Netz. Zeitstempel vor dem Start notieren, das ist der Rücksprungpunkt. |
| Nur tägliche Backups | Rücksprung kostet den Tag. Verlust seit dem letzten Backup wäre real — Rollout nur im ruhigen Zeitfenster. |
| Weder noch (Free) | **Kein Rücksprung.** Dann gilt: Transaktionsklammer plus die vorbereiteten Rücknahmen in `supabase/rollback/`, und die Entscheidung „ohne Netz" muss ausdrücklich getroffen sein. Ein Upgrade vor dem Rollout ist die wirksamste Einzelmaßnahme. |

---

## Was diese Bestandsaufnahme **nicht** tut

Sie ändert nichts, migriert nichts, stellt keinen Beleg aus und lädt keine
Daten in das Repository. Teil A ist ein `SELECT`, Teil B sind Blicke ins
Dashboard und ein Download auf deinen Rechner.
