-- ========================================================================
-- PRODUCTION — DER ZUSTAND VOR 0149 (GRUPPE G1), REIN LESEND
--
-- RUECKFRAGENFREI AUSFUEHRBAR. Vollstaendig markieren, in den SQL-Editor des
-- Production-Projekts zmiwxswrpkmizvqsgype einfuegen, ausfuehren. Die Klammer
-- und das `rollback` stehen schon darin. Sie schreibt nichts.
--
-- VOR `prod-0149.sql` fahren.
--
-- DEN UMGEKEHRTEN STEMPEL TRAEGT SIE TROTZDEM, obwohl sie nichts schreibt.
-- Der Grund ist nicht Schaden, sondern WAHRHEIT: am 2026-10-20 liefen
-- Pruefdateien auf Staging, waehrend ihre Ergebnisse als Production-Befunde
-- gelesen wurden.
--
-- ###########################################################################
-- ##  ZEILE 900 IST DAS ERGEBNIS, DAS WEITERGEHT — UND ZEILE 901 DAZU.     ##
-- ##  NEU AB G1: KOPIEREN MUESSEN SIE SIE NICHT MEHR.                      ##
-- ##  `prod-0149.sql` MISST beide Vertraege selbst und vergleicht sie in   ##
-- ##  derselben Transaktion. Diese Zeilen stehen hier fuer die Akte — und  ##
-- ##  fuer den Fall, dass Sie die Nachkontrolle zusaetzlich mit einer      ##
-- ##  uebergebenen Baseline fahren wollen.                                 ##
-- ###########################################################################
--
-- ERGEBNIS LESEN: Zeile `9999` muss `0` zeigen. Die entscheidenden Zeilen
-- sind **101 bis 106** — `0148` muss vollstaendig stehen (Tabelle mit fuenf
-- Spalten, der Duplikatschutz als Primaerschluessel, die Claim-Funktion, RLS
-- mit GENAU EINER Richtlinie) und `offer_availability_due()` aus `0147`. Und
-- **111 bis 114**: nichts von `0149` darf schon da sein, und `authenticated`
-- hat auf der Tabelle weiterhin GENAU `select`.
--
-- DIE ZAHLEN 121 BIS 123 SIND AUF PRODUCTION ERWARTBAR `0`, `0` UND DIE ZAHL
-- DER FAVORITEN: die Meldungstabelle ist dort leer, weil
-- `claim_availability_notifications()` nie gerufen wurde. Steht dort etwas
-- anderes, ist das kein Fehler, aber es gehoert in die Akte.
--
-- Der SQL-Editor zeigt `NOTICE`-Meldungen nicht an; diese Datei gibt deshalb
-- eine Tabelle aus und keine Meldungen.
--
-- ZWEI VERTRAEGE, unveraendert die aus `0142` bis `0145`: der Basis-Vertrag
-- (Shop, Lager, Katalog) und der Sammlungs-Vertrag. Die Messbloecke sind
-- zeichengleich dieselben, also ist eine Baseline aus einem dieser Laeufe
-- hier lesbar und umgekehrt. Die Feldfolge beider steht im Kopf der
-- eingebetteten Pruefdatei.
--
--
-- DIE FELDFOLGE BEIDER VERTRAEGE, AUSGESCHRIEBEN — eine vertauschte Zeile
-- waere eine stille Fehlinformation, weil nach POSITION verglichen wird:
--
-- DER BASIS-VERTRAG — sieben Geschaeftszahlen, eine Zeile, feste Reihenfolge
--
--   skyisles-base-1|angebote|angebote_md5|shopfaehig|sammelbar|lagerzeilen|
--   katalogzeilen|lager_md5|schutz
--
-- Neun Felder, getrennt durch `|`, in GENAU dieser Folge:
--
--   1  skyisles-base-1   die Marke. Eine fremde Zeile faellt daran auf
--   2  angebote          count(*) ueber shop_offers()
--   3  angebote_md5      md5 ueber sky_id|condition|price, sortiert
--   4  shopfaehig        count(*) mit is_shop_eligible()
--   5  sammelbar         der Fortschrittsnenner
--   6  lagerzeilen       count(*) ueber shop_inventory
--   7  katalogzeilen     count(*) ueber skylanders
--   8  lager_md5         md5 ueber id|is_listed|sale_price|sale_released
--   9  schutz            left(md5(Felder 2-8, mit | verbunden), 12)
--
-- DER SAMMLUNGS-VERTRAG — fuenf Felder
--
--   skyisles-coll-1|zeilen|konten|sammlung_md5|schutz
--
--   1  skyisles-coll-1   die Marke
--   2  zeilen            count(*) ueber collection_items
--   3  konten            count(distinct user_id)
--   4  sammlung_md5      md5 ueber user_id|sky_id|quantity, sortiert
--   5  schutz            left(md5(Felder 2-4, mit | verbunden), 12)
--
--
-- EINGEBETTET: `supabase/checks/0149_preflight.sql`, Zeichen fuer Zeichen.
-- ========================================================================

begin;

do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) = 2 then
    raise exception 'ABBRUCH A1: das vollstaendige STAGING-Markerpaar ist da '
      '(SKY-0821 UND SKY-0822). Diese Datei ist fuer Production '
      '(zmiwxswrpkmizvqsgype) — auf Staging gehoert '
      'supabase/operations/staging-0149.sql.';
  end if;

  if to_regprocedure('public.purchases_paid_total_is_final()') is null then
    raise exception 'ABBRUCH A2: 0133 ist hier nicht angewendet. Auf Production ist '
      'sie es seit dem 2026-10-18; diese Datenbank ist also nicht Production.';
  end if;

  if (select count(*) from public.skylanders) < 100 then
    raise exception 'ABBRUCH A3: der Katalog hat weniger als 100 Zeilen — das ist '
      'kein Production-Projekt.';
  end if;
end
$lauf_a$;

-- >>> EINGEBETTET: supabase/checks/0149_preflight.sql
-- ===========================================================================
-- STAGING/PRODUCTION — DER ZUSTAND VOR 0149, REIN LESEND
--
-- VOR `0149_notification_read_state.sql` fahren. **Erwartet: Zeile
-- 9999 = `0`.**
--
--   101-106  `0148` steht VOLLSTAENDIG. `0149` setzt die Tabelle, ihren
--            Primaerschluessel, ihre eine Richtlinie und
--            `claim_availability_notifications()` voraus.
--   111-114  `0149` ist NOCH NICHT da — ein zweiter Lauf soll an seiner
--            eigenen Vorbedingung abprallen. Insbesondere gibt es noch kein
--            `read_at` und noch kein `update`-Recht fuer Clients.
--   121-123  der Stand, auf den `0149` trifft: wie viele Meldungen liegen,
--            und wie viele davon nach der Migration als ungelesen gelten.
--            **Nach `0149` muessen beide Zahlen gleich sein** — die
--            Migration erfindet keine Lesehandlung.
--
-- RECHTEGESCHUETZTE ZEILEN. Der lesende Pruefzugang darf
-- `availability_notifications`, `favorites` und `offer_state` nicht lesen.
-- Diese Zeilen melden ihm `KEIN-RECHT`, zaehlen in Zeile 9998 und sind
-- OFFEN — die Abnahme braucht den Lauf als `postgres` (ADR-0139, ADR-0141).
--
-- DIE ZWEI BASELINES (900/901 im Preflight, 801-829 in der Nachkontrolle),
-- unveraendert aus der Familie `0142`-`0148`: `0149` fasst weder Shop noch
-- Lager noch Katalog noch Sammlung an.
--
-- DIE FELDFOLGE BEIDER VERTRAEGE, AUSGESCHRIEBEN. Sie steht hier, weil ein
-- vertauschtes Feld eine stille Fehlinformation waere: verglichen wird nach
-- POSITION (`t[2]` … `t[8]`), nicht nach Namen.
--
-- DER BASIS-VERTRAG — sieben Geschaeftszahlen, eine Zeile, feste Reihenfolge
--
--   skyisles-base-1|angebote|angebote_md5|shopfaehig|sammelbar|lagerzeilen|
--   katalogzeilen|lager_md5|schutz
--
-- Neun Felder, getrennt durch `|`, in GENAU dieser Folge:
--
--   1  skyisles-base-1   die Marke. Eine fremde Zeile faellt daran auf
--   2  angebote          count(*) ueber shop_offers()
--   3  angebote_md5      md5 ueber sky_id|condition|price, sortiert
--   4  shopfaehig        count(*) mit is_shop_eligible()
--   5  sammelbar         der Fortschrittsnenner
--   6  lagerzeilen       count(*) ueber shop_inventory
--   7  katalogzeilen     count(*) ueber skylanders
--   8  lager_md5         md5 ueber id|is_listed|sale_price|sale_released
--   9  schutz            left(md5(Felder 2-8, mit | verbunden), 12)
--
-- DER SAMMLUNGS-VERTRAG — fuenf Felder
--
--   skyisles-coll-1|zeilen|konten|sammlung_md5|schutz
--
--   1  skyisles-coll-1   die Marke
--   2  zeilen            count(*) ueber collection_items
--   3  konten            count(distinct user_id)
--   4  sammlung_md5      md5 ueber user_id|sky_id|quantity, sortiert
--   5  schutz            left(md5(Felder 2-4, mit | verbunden), 12)
--
-- ===========================================================================

with sammelbar as (
  select s.sky_id
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active and s.catalog_visible
     and not (c.name = any (public.non_collectible_categories()))
),
basis_mess as (
  -- Die sieben Zahlen, einmal gerechnet, hier und in Zeile 900 benutzt.
  select
    /*
     * DIE ZWEI FELDER, DIE `shop_offers()` BRAUCHEN — und das ist die einzige
     * Stelle des Basis-Vertrags, an der ein Recht fehlen kann.
     *
     * Fehlt `execute`, steht hier `KEIN-RECHT`: die Zeilen 811 und 812 sind
     * dann OFFEN (Zeile 9998 zaehlt sie), die uebrigen fuenf Felder werden
     * weiter gemessen und verglichen. Ein fehlendes Recht nimmt also nicht
     * die ganze Baseline mit — aber es wird auch nicht stillschweigend
     * uebergangen.
     */
    case when has_function_privilege('public.shop_offers()', 'execute')
         then (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from public.shop_offers()',
             false, true, '')))[1]::text
         else 'KEIN-RECHT' end as angebote,
    case when has_function_privilege('public.shop_offers()', 'execute')
         then (xpath('/row/c/text()', query_to_xml(
             'select md5(coalesce(string_agg(o.sky_id || ''|'' || o.condition || ''|'' '
             '|| coalesce(o.price::text, ''''), '
             ''';'' order by o.sky_id, o.condition), '''')) as c '
             'from public.shop_offers() o',
             false, true, '')))[1]::text
         else 'KEIN-RECHT' end as angebote_md5,
    (select count(*)::text from public.skylanders s
      where public.is_shop_eligible(s.sky_id))                             as shopfaehig,
    (select count(*)::text from sammelbar)                                 as sammelbar,
    (select count(*)::text from public.shop_inventory)                     as lagerzeilen,
    (select count(*)::text from public.skylanders)                         as katalogzeilen,
    (select coalesce(md5(string_agg(i.id::text || '|' || i.is_listed::text || '|'
                                    || coalesce(i.sale_price::text, '-') || '|'
                                    || i.sale_released::text,
                                    E'\n' order by i.id)), '(leer)')
       from public.shop_inventory i)                                       as lager_md5
),
basis_feld as (
  select angebote || '|' || angebote_md5 || '|' || shopfaehig || '|' || sammelbar
         || '|' || lagerzeilen || '|' || katalogzeilen || '|' || lager_md5 as kern,
         m.*
    from basis_mess m
),
basis_zeile as (
  select 'skyisles-base-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from basis_feld f
),
coll_mess as (
  -- Die drei Zahlen der Sammlung, einmal gerechnet.
  select
    (select count(*)::text from public.collection_items)                   as zeilen,
    (select count(distinct user_id)::text from public.collection_items)    as konten,
    (select coalesce(md5(string_agg(ci.user_id::text || '|' || ci.sky_id || '|'
                                    || ci.quantity::text,
                                    E'\n' order by ci.user_id, ci.sky_id)), '(leer)')
       from public.collection_items ci)                                    as sammlung_md5
),
coll_feld as (
  select zeilen || '|' || konten || '|' || sammlung_md5 as kern, m.*
    from coll_mess m
),
coll_zeile as (
  select 'skyisles-coll-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from coll_feld f
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (1, 'Umgebung', 'Info: Katalogzeilen',
      (select count(*)::text from public.skylanders), null),

  -- --------------------------------------------------- 0148 steht vollstaendig
  (101, 'Grundlage', 'availability_notifications steht mit fuenf Spalten (0148)',
      coalesce((select string_agg(a.attname::text, ',' order by a.attnum)
                  from pg_attribute a
                 where a.attrelid = to_regclass('public.availability_notifications')
                   and a.attnum > 0 and not a.attisdropped),
               '(keine Tabelle)'),
      'user_id,sky_id,buyable_since,cheapest_cents,created_at'),
  (102, 'Grundlage', 'und ihr Primaerschluessel ist der Duplikatschutz',
      coalesce((select string_agg(a.attname::text, ','
                                  order by array_position(c.conkey, a.attnum))
                  from pg_constraint c
                  join pg_attribute a
                    on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
                 where c.conrelid = to_regclass('public.availability_notifications')
                   and c.contype = 'p'),
               '(kein Schluessel)'),
      'user_id,sky_id,buyable_since'),
  (103, 'Grundlage', 'claim_availability_notifications() steht',
      (to_regprocedure('public.claim_availability_notifications()') is not null)::text,
      'true'),
  (104, 'Grundlage', 'RLS ist an und es gibt GENAU EINE Richtlinie',
      coalesce((select (c.relrowsecurity::text || '/'
                        || (select count(*)::text from pg_policy pol
                             where pol.polrelid = c.oid))
                  from pg_class c
                 where c.oid = to_regclass('public.availability_notifications')),
               '(keine Tabelle)'),
      'true/1'),
  (105, 'Grundlage', 'is_collector_account() steht (0042)',
      (to_regprocedure('public.is_collector_account()') is not null)::text, 'true'),
  (106, 'Grundlage', 'offer_availability_due() steht (0147)',
      (to_regprocedure('public.offer_availability_due()') is not null)::text, 'true'),

  -- ----------------------------------------------------- 0149 ist noch nicht da
  (111, 'Neu', 'read_at steht NOCH NICHT',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.availability_notifications')
          and a.attname = 'read_at'
          and a.attnum > 0 and not a.attisdropped), '0'),
  (112, 'Neu', 'mark_availability_notifications_read(text[]) steht NOCH NICHT',
      (to_regprocedure(
         'public.mark_availability_notifications_read(text[])') is null)::text,
      'true'),
  (113, 'Neu', 'der Teilindex fuer den Zaehler steht NOCH NICHT',
      (to_regclass('public.availability_notifications_unread_idx') is null)::text,
      'true'),
  /*
   * DIE WICHTIGSTE ZEILE DIESES BLATTES. `0148` hat festgehalten, dass
   * `authenticated` auf dieser Tabelle GENAU `SELECT` hat und sonst nichts.
   * `0149` aendert das nicht — der Schreibweg ist eine Funktion. Steht hier
   * vorher etwas anderes als `SELECT`, ist die Annahme falsch, auf der die
   * Migration ihre eigene Nachpruefung aufbaut.
   */
  (114, 'Neu', 'authenticated hat GENAU select auf availability_notifications',
      coalesce((select string_agg(distinct a.privilege_type, ', '
                                  order by a.privilege_type)
                  from pg_class c, aclexplode(c.relacl) a
                 where c.oid = to_regclass('public.availability_notifications')
                   and a.grantee::regrole::text = 'authenticated'
                   and a.privilege_type in ('SELECT','INSERT','UPDATE','DELETE',
                                            'TRUNCATE','REFERENCES','TRIGGER')),
               '(nichts)'),
      'SELECT'),

  /*
   * ----------------------------------- Der Stand, auf den 0149 trifft
   *
   * ZEILE 121 UND 122 MUESSEN NACH DER MIGRATION GLEICH SEIN. Die Spalte
   * kommt nullbar und ohne Vorgabewert, also gelten alle bestehenden
   * Meldungen als ungelesen. Das ist richtig: es gab bis `0149` keine
   * Oberflaeche, in der sie jemand hat sehen koennen.
   */
  (121, 'Stand', 'Info: Meldungen insgesamt',
      case when has_table_privilege('public.availability_notifications', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.availability_notifications',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (122, 'Stand', 'Info: betroffene Konten',
      case when has_table_privilege('public.availability_notifications', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(distinct user_id) as c '
               'from public.availability_notifications',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (123, 'Stand', 'Info: Favoriten insgesamt (0149 ruehrt sie nicht an)',
      case when has_table_privilege('public.favorites', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.favorites',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  -- --------------------------- Die Zahlen des Betriebs (Basis-Vertrag)
  (301, 'Shop', 'oeffentliche Angebote',
      (select angebote from basis_mess), null),
  (302, 'Shop', 'Angebots-Abdruck',
      (select angebote_md5 from basis_mess), null),
  (303, 'Shop', 'shopfaehige Katalogzeilen',
      (select shopfaehig from basis_mess), null),
  (304, 'Shop', 'sammelbare Katalogzeilen',
      (select sammelbar from basis_mess), null),
  (305, 'Shop', 'Lagerzeilen',
      (select lagerzeilen from basis_mess), null),
  (306, 'Shop', 'Katalogzeilen',
      (select katalogzeilen from basis_mess), null),
  (307, 'Shop', 'Lager-Abdruck',
      (select lager_md5 from basis_mess), null),
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0149 ruehrt das nicht an)',
      (select count(*)::text from public.shop_inventory i where i.sale_released), '0'),

  -- -------------------------------------------------------- Die Belegsperre
  (401, 'Belege', 'keine Grants auf die Belegtabellen fuer anon/authenticated',
      (select count(*)::text from pg_class c, aclexplode(c.relacl) a
        where c.oid in (to_regclass('public.platform_receipts'),
                        to_regclass('public.platform_receipt_sequence'))
          and a.grantee::regrole::text in ('anon', 'authenticated')), '0'),

  (900, 'BASIS', 'Shop-Baseline fuer die Nachkontrolle — vollstaendig kopieren',
      (select zeile from basis_zeile), null),
  (901, 'BASIS', 'Sammlungs-Baseline fuer die Nachkontrolle — vollstaendig kopieren',
      (select zeile from coll_zeile), null)
),
ergebnis as (
  /*
   * DREI ZUSTAENDE, NICHT ZWEI (ADR-0139).
   *
   *   ok = true   die Pruefung stimmt
   *   ok = false  sie weicht ab           → zaehlt in 9999, blockiert
   *   ok = null   Auskunft ODER OFFEN     → zaehlt nicht in 9999
   *
   * `KEIN-RECHT` heisst: diese Zeile greift auf ein Objekt zu, auf das die
   * aufrufende Rolle kein Recht hat. Das ist KEINE Abweichung, sondern eine
   * nicht durchgefuehrte Pruefung — Zeile 9998 zaehlt sie.
   */
  select nr, bereich, pruefung, befund, erwartet,
         case when befund = 'KEIN-RECHT' then null
              when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)
select nr, bereich, pruefung, befund, erwartet, ok from ergebnis
union all
select 9998, 'GESAMT', 'Zeilen, die diese Rolle nicht lesen durfte '
       '(0 = vollstaendig geprueft)',
       (select count(*) from ergebnis where befund = 'KEIN-RECHT')::text, null, null
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
-- <<< ENDE: supabase/checks/0149_preflight.sql

rollback;
