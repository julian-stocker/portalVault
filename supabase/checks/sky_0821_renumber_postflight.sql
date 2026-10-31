-- ===========================================================================
-- STAGING — NACHKONTROLLE ZUR UMNUMMERIERUNG VON `Gold Fire Kraken`
--
-- REIN LESEND, als `postgres`. **Erwartet: Zeile 9999 = `0`.**
--
-- SIE BRAUCHT KEINE ANGABE MEHR. Einfuegen, ausfuehren, fertig.
--
-- *** WARUM DIESE FASSUNG EXISTIERT ***
--
-- Die erste verlangte zwei `set_config`-Zeilen davor und meldete ohne sie
-- **19 blockierende Abweichungen** — nicht weil etwas schiefgegangen waere,
-- sondern weil sie nicht wusste, worueber sie urteilen sollte. Am
-- 2026-10-30 ist genau das passiert.
--
-- Der Fehler war meiner, und er war konstruktiv: der Lauf legte die neue
-- Nummer mit `set_config('skyisles.neu', v_neu, true)` ab. Das `true` heisst
-- TRANSAKTIONSLOKAL — mit dem `commit` war der Wert fort. Die Nummer stand
-- nur noch im NOTICE, und wer den nicht aufbewahrt, hat sie nicht mehr.
--
-- Eine Nachkontrolle, die eine Angabe braucht, die der Vorgang selbst nicht
-- hinterlaesst, ist falsch gebaut. Diese Fassung LEITET die Nummer ab — auf
-- drei unabhaengigen Wegen, die uebereinstimmen muessen (101-105).
--
-- *** UEBERSCHREIBEN IST WEITER MOEGLICH ***
--
-- Wer eine bestimmte Nummer oder eine andere Baseline pruefen will, setzt sie
-- in DERSELBEN Klammer davor; die Datei nimmt dann diese:
--
--     select set_config('skyisles.neu',  'SKY-0928', true);
--     select set_config('skyisles.0821', 'skyisles-0821-1|…', true);
--
-- WAS SIE PRUEFT
--
--   101-105  DIE NEUE NUMMER, dreifach abgeleitet und in Deckung
--   201-211  DIE NEUE ZEILE traegt jeden Wert der alten — und keinen Preis
--   221-223  DIE ALTE NUMMER ist fort, und sie ist VERBRAUCHT: drei
--            Journalzeilen stehen weiter da, darunter `deleted`
--   231-233  DIE HERKUNFT ist lesbar, und das Markerpaar ist jetzt
--            unvollstaendig — eine Folge, die man kennen muss
--   241-243  DIE SEQUENZ steht hinter der neuen Nummer, das Band haelt
--   301-303  DIE BASELINE ist da, tragt die Marke und prueft sich selbst
--   311-316  NICHTS SONST hat sich bewegt — und der Abdruck hat sich sehr wohl
--            bewegt, sonst waere die Umnummerierung nicht passiert
-- ===========================================================================

with
/*
 * DREI UNABHAENGIGE WEGE ZU DER NEUEN NUMMER.
 *
 * Keiner davon ist geraten, und keiner steht in dieser Datei als Wert:
 *
 *   w_band   die einzige Katalogzeile im freigegebenen Band SKY-0928..SKY-4999.
 *            Das Band war vor dem Lauf nachweislich leer (Preflight 161-163).
 *   w_name   die einzige Zeile mit dem Namen der umnummerierten Figur.
 *   w_notiz  die einzige redaktionelle Notiz, die SKY-0821 nennt — die hat
 *            Schritt 6 des Laufs geschrieben, eben damit der Zusammenhang
 *            lesbar bleibt.
 *
 * Stimmen sie nicht ueberein oder ist einer nicht eindeutig, schlaegt 104 an
 * und es wird nichts weiter behauptet.
 */
w_band as (
  select sky_id from public.skylanders
   where sky_id between 'SKY-0928' and 'SKY-4999'
),
w_name as (
  select sky_id from public.skylanders where name = 'Gold Fire Kraken'
),
w_notiz as (
  select sky_id from public.catalog_editorial where admin_note like '%SKY-0821%'
),
neu as (
  select coalesce(
    -- eine ausdrueckliche Angabe hat Vorrang, sonst der abgeleitete Weg
    nullif(btrim(coalesce(current_setting('skyisles.neu', true), '')), ''),
    (select sky_id from w_band)
  ) as id,
  (nullif(btrim(coalesce(current_setting('skyisles.neu', true), '')), '') is not null)
    as vorgegeben
),
f   as (select s.* from public.skylanders s, neu where s.sky_id = neu.id),
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
vertrag as (
  /*
   * DIE BASELINE AUS DEM PREFLIGHT-LAUF VOM 2026-10-30, hier eingetragen
   * statt uebergeben.
   *
   * Sie ist KEIN erfundener Wert: sie ist Zeile 900 des Preflights, wie der
   * Betreiber sie gemeldet hat, und ihre eigene Selbstprobe
   * (`left(md5(kern), 12)`) stimmt — `d464d3436a04` gegen den Kern
   * `694|1066|287|21|d1e68c3afd1c5d2a005da61c5fa9c39b`, nachgerechnet.
   *
   * Dass ein Sollwert in der Pruefdatei steht, ist hier richtig: es IST ein
   * Sollwert, so wie jeder andere in dieser Datei. Der Unterschied zu einer
   * Erfindung ist die Herkunft, und die steht hier.
   */
  select coalesce(
    nullif(btrim(coalesce(current_setting('skyisles.0821', true), '')), ''),
    'skyisles-0821-1|694|1066|287|21|d1e68c3afd1c5d2a005da61c5fa9c39b|d464d3436a04'
  ) as roh,
  (nullif(btrim(coalesce(current_setting('skyisles.0821', true), '')), '') is not null)
    as vorgegeben
),
soll as (
  select roh, t[1] = 'skyisles-0821-1' as marke, t[7] as selbstprobe,
         t[2] as katalogzeilen, t[3] as journalzeilen, t[4] as lagerzeilen,
         t[5] as sammlungszeilen, t[6] as katalogabdruck
    from (select roh, string_to_array(roh, '|') as t from vertrag) q
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (1, 'Umgebung', 'Info: die gepruefte neue Nummer', (select id from neu), null),
  (2, 'Umgebung', 'Info: Herkunft der Nummer und der Baseline',
      (select case when n.vorgegeben then 'Nummer vorgegeben' else 'Nummer abgeleitet' end
              || ', ' ||
              case when v.vorgegeben then 'Baseline vorgegeben' else 'Baseline aus der Datei' end
         from neu n, vertrag v), null),

  -- ------------------------------------------- Die neue Nummer, dreifach belegt
  (101, 'Nummer', 'genau EINE Katalogzeile liegt im Band SKY-0928..SKY-4999',
      (select count(*)::text from w_band), '1'),
  (102, 'Nummer', 'genau EINE Zeile heisst Gold Fire Kraken',
      (select count(*)::text from w_name), '1'),
  (103, 'Nummer', 'genau EINE redaktionelle Notiz nennt SKY-0821',
      (select count(*)::text from w_notiz), '1'),
  /*
   * DER EIGENTLICHE RIEGEL. Drei Wege, die nichts voneinander wissen, muessen
   * dieselbe Nummer nennen. Erst dann steht fest, WORUEBER die Zeilen 201 ff.
   * urteilen.
   */
  (104, 'Nummer', 'und alle drei Wege nennen dieselbe',
      (select ((select sky_id from w_band) = (select sky_id from w_name)
           and (select sky_id from w_name) = (select sky_id from w_notiz))::text), 'true'),
  (105, 'Nummer', 'sie liegt im freigegebenen Band',
      (select (substring(id from 5)::integer between 928 and 4999)::text from neu), 'true'),

  -- -------------------------------------------------------- Die neue Zeile
  (201, 'Neu', 'die Zeile steht',        (select count(*)::text from f), '1'),
  (202, 'Neu', 'name',                   (select name from f), 'Gold Fire Kraken'),
  (203, 'Neu', 'slug',                   (select slug from f), 'gold-fire-kraken'),
  (204, 'Neu', 'series_code',            (select series_code from f), 'SF'),
  (205, 'Neu', 'category_id',            (select category_id::text from f), '20'),
  (206, 'Neu', 'card_type',              (select card_type from f), 'chase'),
  (207, 'Neu', 'catalog_status — hidden, NICHT draft: ein Entwurf waere vom '
               'Katalogabgleich ausgeschlossen',
      (select catalog_status from f), 'hidden'),
  (208, 'Neu', 'catalog_visible',        (select catalog_visible::text from f), 'false'),
  (209, 'Neu', 'character_id (105 = Fire Kraken)',
      (select character_id::text from f), '105'),
  (210, 'Neu', 'types und visible_type',
      (select array_to_string(types, '+') || '|' || visible_type || '|'
              || visible_type_decided::text from f), 'chase+swapper|chase|true'),
  /*
   * KEIN PREIS, KEIN BILD, KEINE BASIS. Die alte Zeile trug nichts davon, und
   * dieser Lauf erfindet nichts. `market_price` bleibt NULL — unbekannt, nie
   * 0 (ADR-0010).
   */
  (211, 'Neu', 'kein Preis, kein Bild, keine Basisfigur, keine USK-Angabe, '
               'kein Anzeigename',
      (select concat_ws('|', coalesce(market_price::text, '~'),
                        coalesce(image_file, '~'), coalesce(image_override_path, '~'),
                        coalesce(base_sky_id, '~'), coalesce(usk_rating::text, '~'),
                        coalesce(display_name_override, '~')) from f),
      '~|~|~|~|~|~'),
  (212, 'Neu', 'item_type kommt aus der Kategorie (Trigger)',
      (select item_type from f), 'figure'),

  -- ----------------------------------------------- Die alte Nummer ist fort
  (221, 'Alt', 'SKY-0821 steht nicht mehr in der Tabelle',
      (select count(*)::text from public.skylanders where sky_id = 'SKY-0821'), '0'),
  /*
   * UND SIE IST VERBRAUCHT. Das Journal haengt an einem Text und hat hierher
   * keinen Fremdschluessel — darum ueberleben die zwei alten Zeilen das
   * Loeschen, und `admin_delete_figure` legt eine dritte dazu. Diese Spur ist
   * der Beweis, dass SKY-0821 auf Staging nie wiederkommt (ADR-0001).
   */
  (222, 'Alt', 'ihre Journalzeilen stehen weiter da — mindestens created, '
               'card_type und deleted',
      (select count(*)::text from public.catalog_admin_changes
        where entity = 'skylander' and entity_id = 'SKY-0821'), '3'),
  (223, 'Alt', 'und die deleted-Zeile ist darunter',
      (select count(*)::text from public.catalog_admin_changes
        where entity = 'skylander' and entity_id = 'SKY-0821' and field = 'deleted'), '1'),

  -- ------------------------------------------------------------ Die Herkunft
  (231, 'Herkunft', 'die neue Zeile hat eine created-Journalzeile',
      (select count(*)::text from public.catalog_admin_changes, neu
        where entity = 'skylander' and entity_id = neu.id and field = 'created'), '1'),
  (232, 'Herkunft', 'und eine redaktionelle Notiz, die SKY-0821 nennt',
      (select (count(*) > 0)::text from public.catalog_editorial ce, neu
        where ce.sky_id = neu.id and ce.admin_note like '%SKY-0821%'), 'true'),
  /*
   * EINE FOLGE, DIE MAN KENNEN MUSS, KEIN FEHLER.
   *
   * Das Staging-Markerpaar `SKY-0821`+`SKY-0822` ist jetzt unvollstaendig.
   * `staging-sky-id-band.sql` haette danach nicht mehr laufen koennen — sie
   * ist aber einmalig und schon gefahren. Die sieben vorbereiteten
   * Production-Dateien (`prod-0135` bis `prod-0141`) tragen den UMGEKEHRTEN
   * Riegel: sie brechen ab, wenn das VOLLSTAENDIGE Paar da ist. Auf Staging
   * faengt sie ab jetzt nicht mehr A1, sondern nur noch A2 (`0133` fehlt
   * hier) und A3. Der Schutz bleibt, er ist nur einschichtig statt
   * zweischichtig — genau der Fall, den P41 vorfuehrt.
   */
  (233, 'Herkunft', 'Hinweis: das Markerpaar ist jetzt unvollstaendig (1 statt 2) '
                    '— Production-Dateien faengt auf Staging ab jetzt A2, nicht A1',
      (select count(*)::text from public.skylanders
        where sky_id in ('SKY-0821','SKY-0822')), '1'),

  -- ------------------------------------------------------------- Die Sequenz
  (241, 'Band', 'das Band haelt unveraendert 928..4999, NO CYCLE',
      (select min_value::text || '..' || max_value::text || '|' || cycle::text
         from pg_sequences where schemaname = 'public' and sequencename = 'sky_id_seq'),
      '928..4999|false'),
  /* Hinter der Rechtepruefung und mit dem Namen im Literal — siehe Preflight. */
  (242, 'Band', 'die Sequenz steht auf der vergebenen Nummer, is_called true — '
                'sie wird nicht zweimal vergeben',
      (select case when has_sequence_privilege('public.sky_id_seq', 'SELECT')
                   then (xpath('/row/c/text()', query_to_xml(
                          'select last_value::text || ''|'' || is_called::text as c '
                          'from public.sky_id_seq', false, true, '')))[1]::text
                   else 'KEIN-RECHT' end),
      (select substring(id from 5)::integer::text || '|true' from neu)),
  (243, 'Band', 'die neue Nummer liegt im Band',
      (select (substring(id from 5)::integer between 928 and 4999)::text from neu), 'true'),

  -- -------------------------------------------- Nichts sonst hat sich bewegt
  (301, 'Baseline', 'eine Baseline ist uebergeben worden',
      (select (roh is not null)::text from soll), 'true'),
  (302, 'Baseline', 'sie traegt die Marke skyisles-0821-1',
      (select coalesce(marke::text, 'false') from soll), 'true'),
  /*
   * DIE BASELINE PRUEFT SICH SELBST. Ihr letztes Feld ist `left(md5(kern),
   * 12)`; stimmt es nicht, ist beim Kopieren etwas verlorengegangen, und
   * jeder Vergleich darunter waere Unsinn.
   */
  (303, 'Baseline', 'ihre Selbstprobe stimmt — nichts beim Kopieren verloren',
      (select left(md5(katalogzeilen || '|' || journalzeilen || '|' || lagerzeilen || '|'
                       || sammlungszeilen || '|' || katalogabdruck), 12) from soll),
      (select selbstprobe from soll)),
  /*
   * DIE ZAHLEN AENDERN SICH, UND ZWAR GENAU UM DIESE BETRAEGE. Eine
   * Nachkontrolle, die „unveraendert" verlangt, waere hier falsch: eine Zeile
   * ist gegangen und eine gekommen (Katalog bleibt gleich), und das Journal
   * ist um die Zeilen des Laufs gewachsen.
   */
  (311, 'Unveraendert', 'Katalogzeilen — eine kam, eine ging, also gleich',
      (select katalogzeilen from mess), (select katalogzeilen from soll)),
  (312, 'Unveraendert', 'Lagerzeilen',
      (select lagerzeilen from mess), (select lagerzeilen from soll)),
  (313, 'Unveraendert', 'Sammlungszeilen',
      (select sammlungszeilen from mess), (select sammlungszeilen from soll)),
  (314, 'Gewachsen', 'Journalzeilen — mehr als vorher, denn jeder Schritt hat '
                     'geschrieben',
      (select (mess.journalzeilen::bigint > soll.journalzeilen::bigint)::text
         from mess, soll), 'true'),
  (315, 'Info', 'Journalzeilen vorher -> nachher',
      (select soll.journalzeilen || ' -> ' || mess.journalzeilen from mess, soll), null),
  /*
   * DER ABDRUCK MUSS SICH AENDERN — er enthaelt die SKY-ID jeder Zeile. Waere
   * er gleich, haette die Umnummerierung nicht stattgefunden.
   */
  (316, 'Veraendert', 'der Katalogabdruck ist ANDERS als vorher — sonst waere '
                      'nichts passiert',
      (select (mess.katalogabdruck <> soll.katalogabdruck)::text from mess, soll), 'true')
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
