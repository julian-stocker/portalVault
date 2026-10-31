-- ===========================================================================
-- STAGING — PREFLIGHT ZUR UMNUMMERIERUNG VON `Gold Fire Kraken`
--           SKY-0821  ->  SKY-0928
--
-- REIN LESEND — EINE EINZIGE ANWEISUNG, kein `begin`, kein `do`, kein
-- `set_config`. Als `postgres` im SQL-Editor des Projekts qqxcpesbwfxzgytkdsac.
-- **Erwartet: Zeile 9999 = `0`.** Zeile 900 ist die Baseline fuer die
-- Nachkontrolle — vollstaendig kopieren.
--
-- WARUM HIER NICHTS UEBER DIE ADMIN-IDENTITAET STEHT
--
-- Eine erste Fassung setzte `request.jwt.claims` in einer Transaktion, um
-- `is_platform_admin()` und `admin_merge_references()` fragen zu koennen —
-- und `npm run verify:check-sql` hat sie daraufhin zu Recht als SCHREIBENDE
-- Pruefdatei gefuehrt. Ein Preflight, der erklaeren muss, warum er doch
-- nichts schreibt, ist der falsche Ort dafuer.
--
-- Die Identitaet prueft jetzt der Lauf selbst, in Waechter A0, und bricht ab,
-- wenn sie nicht greift. Die Verweise zaehlt diese Datei ohnehin genauer: 16
-- Pfade einzeln, ohne Funktion dazwischen und ohne jedes Recht.
--
-- WAS SIE PRUEFT
--
--   101-103  die Umgebung ist Staging, und sie ist nicht Production
--   111-114  DAS BAND IST GESPERRT und der naechste Zug ist SKY-0928 —
--            ohne die Bereichssperre darf diese Umnummerierung nicht laufen
--   121-131  SKY-0821 ist die erwartete Figur, Feld fuer Feld
--   141-144  AUF SKY-0821 ZEIGT NICHTS — jeder Pfad, den der KATALOG kennt
--   145-152  UND DIE STRUKTUR SELBST IST DIE ERWARTETE. Weicht sie ab, bricht
--            die Pruefung kontrolliert ab, statt weniger zu zaehlen
--   161-163  SKY-0928 ist frei, in der Tabelle UND im Journal
--   171-176  die sechs Funktionen des Laufs liegen vor
-- ===========================================================================

with
mess as (
  select
    (select count(*)::text from public.skylanders)                      as katalogzeilen,
    (select count(*)::text from public.catalog_admin_changes)           as journalzeilen,
    (select count(*)::text from public.shop_inventory)                  as lagerzeilen,
    (select count(*)::text from public.collection_items)                as sammlungszeilen,
    (select coalesce(md5(string_agg(s.sky_id || '|' || s.name || '|' || s.slug,
                                    chr(10) order by s.sky_id collate "C")), '(leer)')
       from public.skylanders s)                                        as katalogabdruck
),
feld as (
  select katalogzeilen || '|' || journalzeilen || '|' || lagerzeilen || '|'
         || sammlungszeilen || '|' || katalogabdruck as kern, m.* from mess m
),
baseline as (
  select 'skyisles-0821-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from feld f
),
/*
 * DIE REFERENZPFADE — AUS `pg_constraint` GELESEN, NICHT AUFGEZAEHLT.
 *
 * *** WARUM DAS HIER STEHT UND NICHT EINE LISTE ***
 *
 * Die erste Fassung zaehlte eine handgeschriebene Liste von 16 Pfaden auf,
 * gegrept aus `references public.skylanders` IM QUELLTEXT DER MIGRATIONEN.
 * Am 2026-10-30 ist sie auf Staging abgebrochen:
 *
 *     ERROR 42P01: relation "public.availability_alerts" does not exist
 *
 * `0150`, die diese Tabelle anlegt, ist weder auf Staging noch auf Production
 * angewendet (`APPLIED.md`: beide Umgebungen fuehren `0150` und `0151` als
 * offen). Eine Migration im Repository ist keine Tabelle in der Datenbank —
 * und eine Liste, die aus Quelltext entsteht, weiss davon nichts.
 *
 * Jetzt fragt die Datei die DATENBANK, mit derselben Herleitung wie
 * `admin_merge_references()` (0159), auf die sich auch `admin_delete_figure`
 * stuetzt. Ein Pfad, den es nicht gibt, kommt nicht vor; ein Pfad, der
 * dazukommt, wird mitgezaehlt — und Zeile 145 merkt es.
 *
 * *** UND DAS GAB ES SCHON ***
 *
 * `supabase/checks/cat09_delete_references.sql` leitet dieselbe Liste seit
 * CAT-09 aus `pg_constraint` her und laeuft in der Staging-Suite. Haette ich
 * dort hingesehen, waere die handgeschriebene Liste nie entstanden. Die
 * Sollwerte unten (145-152) sind gegen jene Datei gemessen, am 2026-10-30:
 * 14 Schluessel, vier davon CASCADE, ein stiller Weg `order_lines.sky_id`.
 *
 * *** UND WARUM EINE ERWARTUNG TROTZDEM FEST EINGETRAGEN IST ***
 *
 * Dynamisch allein waere die andere Haelfte des Fehlers: faellt ein Schluessel
 * weg, zaehlt die Datei stillschweigend weniger und meldet weiter „0
 * Verweise". Die Zeilen 143-149 nageln deshalb fest, WAS gefunden werden
 * MUSS — Anzahl, Namen, Abdruck, die stillen Wege und die Vollstaendigkeit.
 * Weicht die Struktur ab, schlaegt 9999 an und der Lauf findet nicht statt.
 */
fk as (
  select cl.relname::text          as tabelle,
         c.conname::text           as schluessel,
         /* `confdeltype` ist `"char"` — ohne Cast `42725`, siehe 0133. */
         c.confdeltype::text       as bei_delete,
         (select a.attname::text
            from generate_subscripts(c.confkey, 1) as g(i)
            join pg_attribute a
              on a.attrelid = c.conrelid and a.attnum = c.conkey[g.i]
           where c.confkey[g.i] = (select a2.attnum from pg_attribute a2
                                    where a2.attrelid = c.confrelid
                                      and a2.attname = 'sky_id'
                                      and not a2.attisdropped)) as spalte
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
   where c.contype = 'f'
     and c.confrelid = to_regclass('public.skylanders')
),
/*
 * DIE WEGE OHNE SCHLUESSEL, NAMENTLICH. `order_lines.sky_id` ist `text not
 * null` ohne Fremdschluessel (`0010`, absichtlich: eine Bestellzeile ist ein
 * Beleg). PostgreSQL sieht dort nicht hin, also muss diese Datei es tun.
 * Zeile 148 prueft, dass diese Liste vollstaendig ist.
 */
ohne_fk (tabelle, spalte) as (values ('order_lines', 'sky_id')),
pfad as (
  select tabelle, spalte, 'FK ' || bei_delete as art from fk
  union all
  select tabelle, spalte, 'ohne FK' from ohne_fk
),
/*
 * GEZAEHLT UEBER `query_to_xml`, weil eine einzelne lesende Anweisung kein
 * `execute format(...)` kann. Die Tabelle kommt aus dem Katalog, existiert
 * also zwangslaeufig — der Fehler vom 2026-10-30 ist damit strukturell
 * ausgeschlossen und nicht nur behoben.
 */
gezaehlt as (
  select p.tabelle, p.spalte, p.art,
         (xpath('/row/c/text()', query_to_xml(
            format('select count(*) as c from public.%I where %I = %L',
                   p.tabelle, p.spalte, 'SKY-0821'), false, true, '')))[1]::text::bigint
           as zeilen
    from pfad p
),
/* Jede Spalte, die wie ein Verweis heisst — fuer die Vollstaendigkeitsprobe. */
spalten as (
  select cl.relname::text as tabelle, a.attname::text as spalte
    from pg_attribute a
    join pg_class cl on cl.oid = a.attrelid
    join pg_namespace n on n.oid = cl.relnamespace
   where n.nspname = 'public' and cl.relkind = 'r'
     and a.attname in ('sky_id', 'base_sky_id') and not a.attisdropped
     and not (cl.relname = 'skylanders' and a.attname = 'sky_id')
),
f as (select * from public.skylanders where sky_id = 'SKY-0821'),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  -- ------------------------------------------------------------- Die Umgebung
  (101, 'Umgebung', 'das Staging-Markerpaar SKY-0821 und SKY-0822 ist da',
      (select count(*)::text from public.skylanders
        where sky_id in ('SKY-0821','SKY-0822')), '2'),
  (102, 'Umgebung', 'und dies ist NICHT Production — der dortige Slug fehlt hier',
      (select count(*)::text from public.skylanders
        where slug = 'winterfest-lob-star-trap-team'), '0'),
  (103, 'Umgebung', 'Info: Katalogzeilen', (select katalogzeilen from mess), null),

  -- ----------------------------------------------------- Die Bereichssperre
  /*
   * OHNE SIE LAEUFT HIER NICHTS. Vor der Sperre stand `last_value` unter 928,
   * und `admin_create_figure` zoege die naechste freie Nummer der ALTEN
   * Zaehlung — nicht SKY-0928. Die Reihenfolge ist keine Vorsicht, sie ist
   * Voraussetzung.
   */
  (111, 'Band', 'die Untergrenze ist 928',
      (select min_value::text from pg_sequences
        where schemaname = 'public' and sequencename = 'sky_id_seq'), '928'),
  (112, 'Band', 'die Obergrenze ist 4999',
      (select max_value::text from pg_sequences
        where schemaname = 'public' and sequencename = 'sky_id_seq'), '4999'),
  (113, 'Band', 'NO CYCLE',
      (select cycle::text from pg_sequences
        where schemaname = 'public' and sequencename = 'sky_id_seq'), 'false'),
  /*
   * DIE SEQUENZ HINTER EINER RECHTEPRUEFUNG, wie in `sky_id_band_preflight.sql`.
   * `0033` entzieht sie jedem Clientrecht; als `postgres` steht hier eine
   * Zahl, sonst `KEIN-RECHT`, und Zeile 9998 zaehlt sie als OFFEN statt die
   * Datei abzubrechen. Der Name steht im Literal — eine Sequenz ist keine
   * Tabelle, und `check-sql-references.test.ts` besteht zu Recht darauf.
   */
  (114, 'Band', 'Sequenzstand 928|false — der naechste Zug ist SKY-0928 SELBST',
      (select case when has_sequence_privilege('public.sky_id_seq', 'SELECT')
                   then (xpath('/row/c/text()', query_to_xml(
                          'select last_value::text || ''|'' || is_called::text as c '
                          'from public.sky_id_seq', false, true, '')))[1]::text
                   else 'KEIN-RECHT' end),
      '928|false'),

  -- ------------------------------------------------- Die Figur, Feld fuer Feld
  (121, 'Figur', 'name',            (select name from f),                  'Gold Fire Kraken'),
  (122, 'Figur', 'slug',            (select slug from f),                  'gold-fire-kraken'),
  (123, 'Figur', 'series_code',     (select series_code from f),           'SF'),
  (124, 'Figur', 'category_id',     (select category_id::text from f),     '20'),
  (125, 'Figur', 'card_type',       (select card_type from f),             'chase'),
  (126, 'Figur', 'catalog_status',  (select catalog_status from f),        'hidden'),
  (127, 'Figur', 'catalog_visible', (select catalog_visible::text from f), 'false'),
  (128, 'Figur', 'character_id',    (select character_id::text from f),    '105'),
  (129, 'Figur', 'types',           (select array_to_string(types, '+') from f), 'chase+swapper'),
  (130, 'Figur', 'visible_type und _decided',
      (select visible_type || '|' || visible_type_decided::text from f), 'chase|true'),
  (131, 'Figur', 'nichts zu uebertragen: Bild, Override, Basis, USK, Anzeigename, Preis',
      (select concat_ws('|', coalesce(image_file, '~'), coalesce(image_override_path, '~'),
                        coalesce(base_sky_id, '~'), coalesce(usk_rating::text, '~'),
                        coalesce(display_name_override, '~'),
                        coalesce(market_price::text, '~')) from f), '~|~|~|~|~|~'),

  -- --------------------------------------------- Auf SKY-0821 zeigt nichts
  (141, 'Bezuege', 'Summe ueber ALLE gefundenen Pfade',
      (select sum(zeilen)::text from gezaehlt), '0'),
  (142, 'Bezuege', 'die Pfade, die nicht leer sind (keiner sein darf)',
      (select coalesce(string_agg(tabelle || '.' || spalte || '=' || zeilen::text, ', '
                                  order by (tabelle || '.' || spalte) collate "C"),
                       '(keiner)') from gezaehlt where zeilen > 0), '(keiner)'),
  /*
   * KEIN PFAD DARF UNBESTIMMT SEIN. Ein `null` hier hiesse: gezaehlt wurde
   * nichts, und `sum()` haette es stillschweigend als 0 behandelt. Genau
   * dieser Fehler hat am 2026-10-30 in meinem Messwerkzeug „0 Verweise"
   * gemeldet, wo die Tabelle gar nicht existierte.
   */
  (143, 'Bezuege', 'kein Pfad ohne bestimmten Zaehlstand',
      (select count(*)::text from gezaehlt where zeilen is null), '0'),
  (144, 'Bezuege', 'Bestellpositionen — der Pfad OHNE Fremdschluessel',
      (select zeilen::text from gezaehlt
        where tabelle = 'order_lines' and spalte = 'sky_id'), '0'),

  -- ------------------------------- Die Struktur selbst, festgenagelt (ADR-0001)
  /*
   * AB HIER GEHT ES NICHT MEHR UM SKY-0821, SONDERN UM DIE FRAGE, OB DIESE
   * DATEI UEBERHAUPT DAS RICHTIGE GEMESSEN HAT. Weicht eine dieser Zeilen ab,
   * hat sich das Schema bewegt — dann ist 9999 > 0, und der Lauf findet nicht
   * statt. Gemessen am 2026-10-30 mit
   * `supabase/checks/sky_id_reference_paths.sql` gegen Staging.
   */
  (145, 'Struktur', 'Anzahl Fremdschluessel auf skylanders.sky_id',
      (select count(*)::text from fk), '14'),
  (146, 'Struktur', 'und zwar genau diese',
      (select string_agg(tabelle || '.' || spalte, ', '
                         order by (tabelle || '.' || spalte) collate "C") from fk),
      'availability_notifications.sky_id, cart_items.sky_id, catalog_editorial.sky_id, '
      'collection_items.sky_id, favorites.sky_id, inventory_import_mappings.sky_id, '
      'inventory_import_rows.sky_id, legacy_stock_events.sky_id, offer_state.sky_id, '
      'orderbook_name_mappings.sky_id, purchase_items.sky_id, sale_items.sky_id, '
      'shop_inventory.sky_id, skylanders.base_sky_id'),
  /*
   * DIE VIER, DIE EIN `delete` STILL MITNEHMEN WUERDE. `admin_delete_figure`
   * nennt sie in seiner Meldung einzeln; hier steht, dass es genau diese vier
   * sind und keine fuenfte dazugekommen ist.
   */
  (147, 'Struktur', 'mit ON DELETE CASCADE — genau vier, namentlich',
      (select string_agg(tabelle || '.' || spalte, ', '
                         order by (tabelle || '.' || spalte) collate "C")
         from fk where bei_delete = 'c'),
      'cart_items.sky_id, catalog_editorial.sky_id, inventory_import_mappings.sky_id, '
      'orderbook_name_mappings.sky_id'),
  /*
   * VOLLSTAENDIGKEIT. Jede Spalte, die `sky_id` oder `base_sky_id` heisst,
   * muss entweder einen Fremdschluessel tragen oder oben namentlich als
   * stiller Weg stehen. Was hier herauskommt, ist ein Weg, den niemand
   * prueft — und niemand hat ihn bemerkt.
   */
  (148, 'Struktur', 'kein ungeprueftes sky_id-Feld: jede Spalte traegt einen '
                    'Schluessel oder steht namentlich als stiller Weg',
      (select coalesce(string_agg(s.tabelle || '.' || s.spalte, ', '
                                  order by (s.tabelle || '.' || s.spalte) collate "C"),
                       '(keine)')
         from spalten s
        where not exists (select 1 from fk where fk.tabelle = s.tabelle and fk.spalte = s.spalte)
          and not exists (select 1 from ohne_fk o where o.tabelle = s.tabelle and o.spalte = s.spalte)),
      '(keine)'),
  (149, 'Struktur', 'kein Schluessel, der auf skylanders zeigt, aber nicht auf '
                    'sky_id (admin_merge_references braeche daran ab)',
      (select count(*)::text from fk where spalte is null), '0'),
  (150, 'Struktur', 'Abdruck ueber alle Pfade samt Loeschverhalten',
      (select md5(string_agg(tabelle || '.' || coalesce(spalte, '?') || '|' || bei_delete,
                             chr(10) order by (tabelle || coalesce(spalte, '?')) collate "C"))
         from fk), 'a221fee44b98985c7903fd09fbdf8516'),
  (152, 'Struktur', 'Info: gezaehlte Pfade insgesamt (14 Schluessel + 1 stiller)',
      (select count(*)::text from gezaehlt), '15'),
  /*
   * GENAU EIN PLATTFORMADMIN. Der Lauf setzt dessen Identitaet, um die sechs
   * Funktionen aufrufen zu koennen; sind es mehr oder keiner, bricht er in A0
   * ab. Hier steht nur die Zahl — gefragt wird ohne jedes Recht.
   */
  (155, 'Rolle', 'es gibt genau einen Plattformadmin, dessen Identitaet der Lauf setzt',
      (select count(*)::text from public.platform_admins), '1'),

  -- ------------------------------------------------------ SKY-0928 ist frei
  /*
   * TABELLE UND JOURNAL. Eine Nummer, die einmal gezogen und wieder
   * verworfen wurde, steht nur noch im Journal — und ist trotzdem
   * verbraucht (ADR-0001).
   */
  (161, 'Ziel', 'SKY-0928 gibt es in der Tabelle nicht',
      (select count(*)::text from public.skylanders where sky_id = 'SKY-0928'), '0'),
  (162, 'Ziel', 'und im Journal auch nicht',
      (select count(*)::text from public.catalog_admin_changes
        where entity = 'skylander' and entity_id = 'SKY-0928'), '0'),
  (163, 'Ziel', 'das ganze Band 0928..4999 ist frei, in Tabelle UND Journal',
      ((select count(*) from public.skylanders
         where sky_id between 'SKY-0928' and 'SKY-4999')
       + (select count(*) from public.catalog_admin_changes
           where entity = 'skylander' and entity_id between 'SKY-0928' and 'SKY-4999'))::text,
      '0'),

  -- -------------------------------------------------- Die Wege des Laufs
  (171, 'Funktionen', 'admin_create_figure',
      (to_regprocedure('public.admin_create_figure(text,text,bigint,text,boolean,text,text,text)')
        is not null)::text, 'true'),
  (172, 'Funktionen', 'admin_set_catalog_status',
      (to_regprocedure('public.admin_set_catalog_status(text,text)') is not null)::text, 'true'),
  (173, 'Funktionen', 'admin_set_character',
      (to_regprocedure('public.admin_set_character(text,bigint)') is not null)::text, 'true'),
  (174, 'Funktionen', 'admin_set_figure_types',
      (to_regprocedure('public.admin_set_figure_types(text,text[])') is not null)::text, 'true'),
  (175, 'Funktionen', 'admin_set_visible_type',
      (to_regprocedure('public.admin_set_visible_type(text,text)') is not null)::text, 'true'),
  (176, 'Funktionen', 'admin_delete_figure',
      (to_regprocedure('public.admin_delete_figure(text)') is not null)::text, 'true'),

  (900, 'BASIS', 'Baseline fuer die Nachkontrolle — vollstaendig kopieren',
      (select zeile from baseline), null)
),
ergebnis as (
  select nr, bereich, pruefung, befund, erwartet,
         case when befund = 'KEIN-RECHT' then null
              when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)
select nr, bereich, pruefung, befund, erwartet, ok from ergebnis
union all
select 9998, 'GESAMT', 'Zeilen, die diese Rolle nicht lesen durfte (0 = vollstaendig geprueft)',
       (select count(*) from ergebnis where befund = 'KEIN-RECHT')::text, null, null
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
