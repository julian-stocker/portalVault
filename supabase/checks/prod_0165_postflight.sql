-- ===========================================================================
-- PRODUCTION — NACHKONTROLLE ZU 0165, REIN LESEND
--
-- EINE ANWEISUNG. Im SQL-Editor des Projekts zmiwxswrpkmizvqsgype als
-- `postgres`. **Erwartet: Zeile 9999 = `0`.**
--
-- *** DIE BASELINE STEHT IN DIESER DATEI. KEINE UEBERGABE NOETIG ***
--
-- Einfuegen, ausfuehren, fertig. Kein `set_config` davor.
--
-- WARUM — UND WARUM NICHT TRANSAKTIONSLOKAL
--
-- Die erste Fassung verlangte die Baseline per
-- `set_config('skyisles.p0165', …, true)` in DERSELBEN Klammer. Am
-- 2026-10-30 ist der Postflight auf Production ohne sie gelaufen und meldete
-- `9999 = 3`, davon zwei allein deswegen. Das war mein Konstruktionsfehler,
-- und es war der ZWEITE dieser Art — die Nachkontrolle zur
-- SKY-0821-Umnummerierung meldete aus demselben Grund 19 Abweichungen.
--
-- `set_config(..., true)` ist TRANSAKTIONSLOKAL. Im SQL-Editor ist jede
-- Ausfuehrung eine eigene Transaktion; ein Wert aus dem Preflight kann einen
-- spaeteren Lauf also gar nicht erreichen. Er taugt als Uebergabe zwischen
-- getrennten Ausfuehrungen NICHT, und auf `false` (sitzungsweit) ist er
-- genauso unzuverlaessig, weil der Editor keine Sitzung zusagt.
--
-- DIE REGEL, DIE DARAUS FOLGT — und sie gilt ab jetzt fuer jedes
-- Preflight/Postflight-Paar dieses Projekts:
--
--   Eine Baseline, die eine SPAETERE Ausfuehrung braucht, gehoert ALS LITERAL
--   IN DIE PRUEFDATEI, mit ihrer Herkunft im Kommentar. `current_setting`
--   bleibt ein Ueberschreiben fuer denselben Lauf, nie der Traeger.
--
-- Das ist kein geschoenter Sollwert: er ist Zeile 900 des Preflight-Laufs,
-- wie der Betreiber sie gemeldet hat, und Zeile 303 laesst ihn sich selbst
-- beweisen. Eine NACHTRAEGLICH gemessene Baseline waere wertlos — sie wuerde
-- den Zustand nach dem Lauf gegen sich selbst halten.
--
-- *** SIE RUFT DIE FUNKTION NICHT AUF ***
--
-- Kein `select system_sync_create_figure(...)`. Eine Nachkontrolle, die eine
-- Figur anlegt, um zu pruefen, ob man eine anlegen kann, hat die Pruefung zur
-- Handlung gemacht. Geprueft wird der ZUSTAND der Funktion: Existenz,
-- Signatur, `security definer`, leerer `search_path`, Rechte, und dass ihr
-- Rumpf weder `sky_id_seq` noch `market_price` nennt.
--
--   101-106  DIE UMGEBUNG, unveraendert positiv wie im Preflight
--   201-209  DER FUNKTIONSZUSTAND, Rumpfabdruck eingeschlossen
--   211-215  DIE RECHTE — service_role ja, anon/authenticated/PUBLIC nein
--   221-222  DIE JOURNAL-CONSTRAINT ist unberuehrt
--   231-232  DIE SEQUENZ ist unberuehrt
--   301-310  BESTAND UND NUTZERDATEN unveraendert, gegen die Baseline aus
--            dieser Datei. Eine fehlende Grundlage FAELLT DURCH, sie
--            schweigt nicht mehr.
-- ===========================================================================

with
fn as (
  select p.oid, p.proname::text as name, p.prosecdef as definer, p.prosrc,
         p.proconfig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'system_sync_create_figure'
),
seq as (
  select min_value, max_value, cycle from pg_sequences
   where schemaname = 'public' and sequencename = 'sky_id_seq'
),
mess as (
  select
    (select count(*)::text from public.skylanders)              as katalogzeilen,
    (select count(*)::text from public.catalog_admin_changes)   as journalzeilen,
    (select count(*)::text from public.shop_inventory)          as lagerzeilen,
    (select count(*)::text from public.collection_items)        as sammlungszeilen,
    (select count(*)::text from public.favorites)               as favoriten,
    (select count(*)::text from public.cart_items)              as warenkoerbe,
    (select count(*)::text from public.order_lines)             as bestellpositionen,
    (select coalesce(md5(string_agg(s.sky_id || '|' || s.name || '|' || s.slug,
                                    chr(10) order by s.sky_id collate "C")), '(leer)')
       from public.skylanders s)                                as katalogabdruck
),
vertrag as (
  /*
   * DIE BASELINE AUS DEM PREFLIGHT-LAUF VOM 2026-10-30 AUF PRODUCTION,
   * wortgleich wie vom Betreiber gemeldet:
   *
   *   skyisles-p0165-1|624|217|340|622|95|0|2|
   *   95bbbb51bd6ca2fd9d0be184b22bfda4|42b1d29ab32e
   *
   * 624 Katalogzeilen, 217 Journalzeilen, 340 Lagerzeilen, 622
   * Sammlungszeilen, 95 Favoriten, 0 Warenkoerbe, 2 Bestellpositionen,
   * Katalogabdruck, Selbstprobe. Die Selbstprobe `42b1d29ab32e` ist
   * nachgerechnet und stimmt gegen den Kern.
   *
   * `current_setting` hat Vorrang, falls jemand eine andere Grundlage
   * pruefen will — aber es ist nicht mehr der Traeger.
   */
  select coalesce(
    nullif(btrim(coalesce(current_setting('skyisles.p0165', true), '')), ''),
    'skyisles-p0165-1|624|217|340|622|95|0|2|'
      || '95bbbb51bd6ca2fd9d0be184b22bfda4|42b1d29ab32e'
  ) as roh,
  (nullif(btrim(coalesce(current_setting('skyisles.p0165', true), '')), '') is not null)
    as vorgegeben
),
soll as (
  select roh, t[1] = 'skyisles-p0165-1' as marke,
         t[2] as katalogzeilen, t[3] as journalzeilen, t[4] as lagerzeilen,
         t[5] as sammlungszeilen, t[6] as favoriten, t[7] as warenkoerbe,
         t[8] as bestellpositionen, t[9] as katalogabdruck, t[10] as selbstprobe
    from (select roh, string_to_array(roh, '|') as t from vertrag) q
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  -- ---------------------------------------------------------- Die Umgebung
  /*
   * ZWEI ZEILEN STATT EINER. Eine zusammengefasste Pruefung sagt im
   * Fehlerfall nicht, welche Haelfte fehlt — und kostet einen zweiten Lauf.
   * Dasselbe Argument wie bei A5 der Huelle.
   */
  (101, 'Umgebung', '0133: die Triggerfunktion liegt weiter',
      (select (to_regprocedure('public.purchases_paid_total_is_final()') is not null)::text),
      'true'),
  (102, 'Umgebung', '0133: und ihr Trigger auf purchases auch',
      (select (count(*) > 0)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.purchases')
          and t.tgname = 'purchases_paid_total_immutable_trg' and not t.tgisinternal),
      'true'),
  (103, 'Umgebung', 'sky_id_seq traegt NICHT das Staging-Band',
      (select (count(*) = 0)::text from seq where min_value = 928 and max_value = 4999),
      'true'),

  -- ----------------------------------------------------- Der Funktionszustand
  (201, 'Funktion', 'sie liegt, genau einmal',
      (select count(*)::text from fn), '1'),
  (202, 'Funktion', 'mit der erwarteten Signatur',
      (select (to_regprocedure('public.system_sync_create_figure(text,text,text,text,'
               'bigint,text,text,text,text,text,smallint)') is not null)::text), 'true'),
  /*
   * `max(boolean)` gibt es in PostgreSQL nicht — `bool_or` ist das Aggregat
   * fuer Wahrheitswerte. Gefunden von `npm run verify:check-sql`, bevor die
   * Datei irgendwo lief.
   */
  (203, 'Funktion', 'security definer',
      (select coalesce(bool_or(definer)::text, 'fehlt') from fn), 'true'),
  /*
   * DER SUCH-PFAD — UND MEIN FEHLER VOM 2026-10-30.
   *
   * Die erste Fassung packte den Wert aus und erwartete eine LEERE
   * Zeichenkette. Production meldete `""` und die Zeile schlug an, obwohl die
   * Funktion in Ordnung war.
   *
   * PostgreSQL legt einen leeren GUC-Wert QUOTIERT ab: `set search_path = ''`
   * steht in `proconfig` als `search_path=""`, mit zwei
   * Anfuehrungszeichen. `""` IST die richtige Darstellung eines leeren
   * Suchpfads — es war die Erwartung, die falsch war.
   *
   * Dieselbe Falle hat `staging-0137.sql` am 2026-10-20 abbrechen lassen.
   * `0165` selbst macht es richtig, und zwar genau so:
   *
   *     nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
   *
   * Erst auspacken, dann die Anfuehrungszeichen abschneiden, dann auf leer
   * pruefen. Dieser Ausdruck ist von dort uebernommen, Zeichen fuer Zeichen;
   * eine zweite Fassung derselben Regel waere eine zweite Wahrheit.
   *
   * 204a fragt zuerst, DASS eine Festlegung da ist — eine
   * SECURITY-DEFINER-Funktion ohne festen Suchpfad ist eine
   * Rechteausweitung, und `(nicht gesetzt)` darf nicht als „leer" durchgehen.
   */
  (204, 'Funktion', 'eine search_path-Festlegung ist vorhanden',
      (select (count(*) > 0)::text from fn, unnest(coalesce(fn.proconfig, '{}'::text[])) c
        where c like 'search\_path=%'), 'true'),
  (205, 'Funktion', 'und sie ist LEER — ausgepackt und entquotet, nicht verglichen',
      (select coalesce((select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                          from fn, unnest(coalesce(fn.proconfig, '{}'::text[])) c
                         where c like 'search\_path=%'), '(leer)')), '(leer)'),
  (206, 'Funktion', 'ihr Rumpf nennt sky_id_seq NICHT — sie zieht keine Nummer',
      (select (position('sky_id_seq' in coalesce(max(prosrc), '')) = 0)::text from fn), 'true'),
  (207, 'Funktion', 'und market_price NICHT — ADR-0010',
      (select (position('market_price' in coalesce(max(prosrc), '')) = 0)::text from fn), 'true'),
  /*
   * DER RUMPFABDRUCK IST JETZT EINE ERWARTUNG, KEINE AUSKUNFT.
   *
   * Die erste Fassung meldete ihn nur. Der Lauf vom 2026-10-30 hat
   * `6a0383c5c4da7fec3cdd6a39041c3069` geliefert — und derselbe Wert kommt
   * heraus, wenn man den Rumpf AUS DER MIGRATIONSDATEI rechnet (4232
   * Zeichen). Production fuehrt also zeichengleich die Fassung aus dem
   * Repository. Das ist zu wertvoll, um es unverglichen zu lassen: weicht der
   * Abdruck ab, laeuft dort eine andere Funktion als die freigegebene.
   */
  (208, 'Funktion', 'der Rumpfabdruck ist der aus der Migrationsdatei',
      (select coalesce(md5(max(prosrc)), 'fehlt') from fn),
      '6a0383c5c4da7fec3cdd6a39041c3069'),
  (209, 'Funktion', 'sie ist nicht aufgerufen worden: keine Figur im Importbereich',
      ((select count(*) from public.skylanders
         where sky_id between 'SKY-0822' and 'SKY-0928')
       + (select count(*) from public.catalog_admin_changes
           where entity = 'skylander' and entity_id between 'SKY-0822' and 'SKY-0928'))::text,
      '0'),

  -- -------------------------------------------------------------- Die Rechte
  /*
   * DAS EXECUTE-RECHT IST DIE AUTORISIERUNG — es gibt in dieser Funktion
   * keine Rollenpruefung im Rumpf, genau wie bei `system_set_image_override`
   * (0035) und `system_record_inventory_movement` (0003). Deshalb ist diese
   * Zeile keine Formalie.
   */
  (211, 'Rechte', 'service_role darf ausfuehren',
      (select has_function_privilege('service_role',
         'public.system_sync_create_figure(text,text,text,text,bigint,text,text,text,'
         'text,text,smallint)', 'execute')::text), 'true'),
  (212, 'Rechte', 'anon darf NICHT',
      (select has_function_privilege('anon',
         'public.system_sync_create_figure(text,text,text,text,bigint,text,text,text,'
         'text,text,smallint)', 'execute')::text), 'false'),
  (213, 'Rechte', 'authenticated darf NICHT',
      (select has_function_privilege('authenticated',
         'public.system_sync_create_figure(text,text,text,text,bigint,text,text,text,'
         'text,text,smallint)', 'execute')::text), 'false'),
  /*
   * PUBLIC IST DER GEFAEHRLICHE FALL: ein NULL-ACL heisst Standard, und der
   * Standard fuer eine Funktion ist EXECUTE FUER PUBLIC. `aclexplode` auf
   * einem NULL-ACL gibt NICHTS zurueck — die Frage muss deshalb ueber
   * `has_function_privilege('public', ...)` laufen.
   */
  (214, 'Rechte', 'PUBLIC darf NICHT — und das ist der Fall, den ein NULL-ACL '
                  'stillschweigend erlauben wuerde',
      (select has_function_privilege('public',
         'public.system_sync_create_figure(text,text,text,text,bigint,text,text,text,'
         'text,text,smallint)', 'execute')::text), 'false'),
  (215, 'Rechte', 'der ACL im Volltext',
      (select coalesce(string_agg(g.grantee || '=' || g.priv, ', '
                                  order by g.grantee collate "C"), '(NULL-ACL!)')
         from (select (aclexplode(p.proacl)).grantee::regrole::text as grantee,
                      (aclexplode(p.proacl)).privilege_type as priv
                 from pg_proc p where p.oid = (select oid from fn)) g), null),

  -- --------------------------------------------------- Die Journal-Constraint
  (221, 'Journal', 'die Constraint ist unberuehrt und kennt created weiter',
      (select (coalesce(pg_get_constraintdef(c.oid), '') like '%''created''%')::text
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), 'true'),
  (222, 'Journal', 'Info: ihr Volltext',
      (select coalesce(pg_get_constraintdef(c.oid), '(fehlt)') from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), null),

  -- -------------------------------------------------------------- Die Sequenz
  /*
   * NO CYCLE IST EINE ERWARTUNG, die Grenzen sind Auskunft. `cycle = true`
   * waere nie richtig — eine umlaufende Sequenz vergibt eine SKY-ID zweimal
   * (ADR-0001). Die Grenzen dagegen aendern sich zulaessig, sobald das
   * Production-Band gesetzt wird; sie bleiben deshalb ohne Sollwert.
   */
  (231, 'Sequenz', 'NO CYCLE — eine umlaufende Sequenz vergaebe eine SKY-ID zweimal',
      (select (not cycle)::text from seq), 'true'),
  (2311, 'Sequenz', 'Grenzen — Auskunft, sie aendern sich mit dem Production-Band',
      (select min_value::text || '..' || max_value::text from seq), null),
  (232, 'Sequenz', 'Stand — 0165 zieht nicht, der Lauf ruft nicht auf',
      (select case when has_sequence_privilege('public.sky_id_seq', 'SELECT')
                   then (xpath('/row/c/text()', query_to_xml(
                          'select last_value::text || ''|'' || is_called::text as c '
                          'from public.sky_id_seq', false, true, '')))[1]::text
                   else 'KEIN-RECHT' end), null),

  -- ----------------------------------------- Bestand und Nutzerdaten
  (301, 'Baseline', 'eine Baseline ist uebergeben worden',
      (select (roh is not null)::text from soll), 'true'),
  (302, 'Baseline', 'sie traegt die Marke skyisles-p0165-1',
      (select coalesce(marke::text, 'false') from soll), 'true'),
  /*
   * JEDE ERWARTUNG IST MIT `coalesce` GEGEN NULL GESICHERT — UND DAS IST DIE
   * ZWEITE HAELFTE DER KORREKTUR.
   *
   * Die `ok`-Spalte lautet `case when erwartet is null then null else … end`.
   * Fehlte die Baseline, war jede Erwartung hier NULL, und die Zeilen 303-309
   * gaben GAR KEIN Urteil ab — sie zaehlten nicht als Abweichung. Der Lauf
   * vom 2026-10-30 meldete deshalb `9999 = 3`, obwohl sieben Vergleiche
   * ueberhaupt nicht stattgefunden hatten. Die Zahl war zu klein, nicht zu
   * gross.
   *
   * Mit `coalesce(…, '(BASELINE FEHLT)')` wird aus dem Schweigen ein
   * Fehlschlag. Eine Pruefung, die ohne Grundlage abstiniert, ist schlimmer
   * als eine, die anschlaegt.
   */
  (303, 'Baseline', 'ihre Selbstprobe stimmt gegen den URSPRUENGLICHEN Wert — '
                    'nichts beim Kopieren verloren',
      (select coalesce(left(md5(katalogzeilen || '|' || journalzeilen || '|' || lagerzeilen
                       || '|' || sammlungszeilen || '|' || favoriten || '|' || warenkoerbe
                       || '|' || bestellpositionen || '|' || katalogabdruck), 12),
                       '(BASELINE FEHLT)') from soll),
      (select coalesce(selbstprobe, '(BASELINE FEHLT)') from soll)),
  (304, 'Unveraendert', 'Katalogzeilen',
      (select katalogzeilen from mess),
      (select coalesce(katalogzeilen, '(BASELINE FEHLT)') from soll)),
  (305, 'Unveraendert', 'Journalzeilen — 0165 schreibt keine',
      (select journalzeilen from mess),
      (select coalesce(journalzeilen, '(BASELINE FEHLT)') from soll)),
  (306, 'Unveraendert', 'Lagerzeilen',
      (select lagerzeilen from mess),
      (select coalesce(lagerzeilen, '(BASELINE FEHLT)') from soll)),
  (307, 'Nutzerdaten', 'Sammlungen und Favoriten',
      (select sammlungszeilen || '|' || favoriten from mess),
      (select coalesce(sammlungszeilen || '|' || favoriten, '(BASELINE FEHLT)') from soll)),
  (308, 'Nutzerdaten', 'Warenkoerbe und Bestellpositionen',
      (select warenkoerbe || '|' || bestellpositionen from mess),
      (select coalesce(warenkoerbe || '|' || bestellpositionen, '(BASELINE FEHLT)') from soll)),
  /*
   * DER ABDRUCK MUSS GLEICH BLEIBEN. Anders als bei der Umnummerierung
   * aendert `0165` keine Zeile — ein abweichender Abdruck hiesse, dass
   * zwischen Preflight und Nachkontrolle etwas anderes geschrieben hat.
   */
  (309, 'Unveraendert', 'der Katalogabdruck — hier MUSS er gleich sein',
      (select katalogabdruck from mess),
      (select coalesce(katalogabdruck, '(BASELINE FEHLT)') from soll)),
  (310, 'Baseline', 'Info: Herkunft der Grundlage',
      (select case when vorgegeben then 'uebergeben' else 'aus der Datei' end
         from vertrag), null)
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
