-- ===========================================================================
-- IST DER ANGEBOTSSPIEGEL FRISCH? — REIN LESEND, JEDERZEIT FAHRBAR
--
-- WARUM DIESE DATEI AM 2026-10-26 ENTSTANDEN IST. Der Betreiber hat Figuren
-- vorgemerkt, eingekauft und eingebucht — und keine Verfuegbarkeitsmeldung
-- bekommen. Die Ursache war nicht die Karenzzeit und nicht die
-- Meldungslogik: `refresh_offer_state()` hatte **keinen einzigen Aufrufer**.
-- `0146` hat den Spiegel bewusst ohne Trigger gebaut und das Nachziehen dem
-- Seitenaufbau eines angemeldeten Sammlers ueberlassen — gebaut hatte diesen
-- Aufrufer niemand. Vier Schritte (S1 bis S4) hingen damit an einer Tabelle,
-- die seit der Erstbefuellung niemand mehr nachgezogen hat.
--
-- DIESE DATEI IST DER WAECHTER DAGEGEN. Zeile 111 ist die eine blockierende:
-- ein Spiegel, der aelter als ein Tag ist, heisst, dass niemand nachzieht.
-- Alles andere ist Auskunft — und die Auskunft, auf die es ankommt, ist
-- Zeile 211: **wie weit Spiegel und Wirklichkeit auseinanderliegen.**
--
-- EINE FIGUR IM EINZELNEN. Optional, ueber eine Sitzungsvariable:
--
--     select set_config('skyisles.sky', 'SKY-0020', false);
--
-- Danach beantworten die Zeilen 401 bis 408 fuer genau diese SKY-ID: steht
-- sie im Spiegel, gilt sie dort als kaufbar, seit wann laeuft ihre Phase,
-- ist sie LIVE kaufbar, wie viele Konten haben sie vorgemerkt, wie viele
-- davon vor dem Phasenbeginn, und wie viele Meldungen existieren.
--
-- RECHTEGESCHUETZTE ZEILEN. Der lesende Pruefzugang darf `offer_state`,
-- `favorites` und `availability_notifications` nicht lesen und
-- `offer_availability_due()` nicht aufrufen. Ihm melden diese Zeilen
-- `KEIN-RECHT`, zaehlen in Zeile 9998 und sind OFFEN. **Die Antworten gibt
-- es nur im SQL-Editor als `postgres`** (ADR-0139, ADR-0141).
--
-- SIE SCHREIBT NICHTS. Insbesondere ruft sie `refresh_offer_state()` NICHT
-- auf: eine Diagnose, die den gemessenen Zustand selbst herstellt, misst
-- sich selbst.
-- ===========================================================================

with gewuenscht as (
  select nullif(btrim(coalesce(current_setting('skyisles.sky', true), '')), '') as sky
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values

  -- ------------------------------------------------- Wie frisch ist er?
  (101, 'Frische', 'Info: wann wurde der Spiegel zuletzt nachgezogen',
      case when has_table_privilege('public.offer_state', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select coalesce(max(s.checked_at)::text, ''(leer)'') as c '
               'from public.offer_state s', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (102, 'Frische', 'Info: und wie lange ist das her',
      case when has_table_privilege('public.offer_state', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select coalesce((now() - max(s.checked_at))::text, ''(leer)'') as c '
               'from public.offer_state s', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  /*
   * DIE EINE BLOCKIERENDE ZEILE. Ein Tag ist grosszuegig: gedrosselt ist das
   * Nachziehen auf eine Minute, und jeder angemeldete Aufruf von
   * `/favoriten` stoesst es an. Steht hier `false`, hat seit einem Tag
   * niemand nachgezogen — dann ist entweder niemand gekommen, oder der
   * Aufrufer fehlt wieder.
   */
  (111, 'Frische', 'der Spiegel ist juenger als ein Tag',
      case when has_table_privilege('public.offer_state', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select coalesce((now() - max(s.checked_at) < interval ''1 day'')::text, '
               '''false'') as c from public.offer_state s', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, 'true'),

  -- ------------------------- Spiegel gegen Wirklichkeit
  /*
   * AUF DIE VIEW GEPRUEFT, NICHT AUF DIE FUNKTION — und das war ein Fehler
   * in der ersten Fassung. Diese Zeilen lesen `offer_state_live`, und die
   * ist allen API-Rollen und dem Pruefzugang entzogen (`0146`). Geprueft
   * wurde aber `has_function_privilege` auf `shop_offers()`, das der
   * Pruefzugang HAT — also waere der Wachtposten durchgewinkt und
   * `query_to_xml` haette die ganze Einreichung mit `42501` abgebrochen,
   * statt `KEIN-RECHT` zu melden. Dieselbe Klasse Fehler wie bei
   * `information_schema` (ADR-0141): der Waechter fragte das Falsche.
   */
  (201, 'Abgleich', 'Info: Figuren mit kaufbarem Angebot — LIVE (offer_state_live)',
      case when has_table_privilege('public.offer_state_live', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.offer_state_live l',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (202, 'Abgleich', 'Info: Figuren, die der SPIEGEL als kaufbar fuehrt',
      case when has_table_privilege('public.offer_state', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.offer_state s where s.buyable',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  /*
   * DIE AUSKUNFT, AUF DIE ES ANKOMMT. Null heisst: Spiegel und Wirklichkeit
   * sind deckungsgleich. Eine kleine Zahl ist normal — zwischen zwei
   * Nachziehvorgaengen liegt bis zu eine Minute. Eine GROSSE Zahl neben
   * einem alten Zeitstempel in Zeile 101 ist der Fehler vom 2026-10-26.
   *
   * Absichtlich nicht blockierend: wie viel „zu viel" ist, haengt am
   * Betrieb, und eine geratene Schwelle waere eine Behauptung. Zeile 111
   * blockiert stattdessen auf die Frische, und die ist eindeutig.
   */
  (211, 'Abgleich', 'Info: Figuren, bei denen Spiegel und Wirklichkeit '
        'auseinanderliegen (0 = deckungsgleich)',
      case when has_table_privilege('public.offer_state', 'select')
            and has_table_privilege('public.offer_state_live', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from ('
               '  select l.sky_id, true as buyable, l.cheapest_cents'
               '    from public.offer_state_live l'
               '  union all'
               '  select s.sky_id, false, null::integer from public.offer_state s'
               '   where not exists (select 1 from public.offer_state_live l'
               '                      where l.sky_id = s.sky_id)'
               ') soll'
               ' left join public.offer_state alt on alt.sky_id = soll.sky_id'
               ' where alt.sky_id is null'
               '    or alt.buyable is distinct from soll.buyable'
               '    or alt.cheapest_cents is distinct from soll.cheapest_cents',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (212, 'Abgleich', 'Info: davon NEU kaufbar — im Angebot, aber im Spiegel '
        'nicht als kaufbar gefuehrt (das sind die stummen Ereignisse)',
      case when has_table_privilege('public.offer_state', 'select')
            and has_table_privilege('public.offer_state_live', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.offer_state_live l'
               ' where not exists (select 1 from public.offer_state s'
               '                    where s.sky_id = l.sky_id and s.buyable)',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (213, 'Abgleich', 'Info: und welche (bis zu zehn SKY-IDs)',
      case when has_table_privilege('public.offer_state', 'select')
            and has_table_privilege('public.offer_state_live', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select coalesce(string_agg(x.sky_id, '', '' order by x.sky_id), ''(keine)'') '
               'as c from (select l.sky_id from public.offer_state_live l'
               ' where not exists (select 1 from public.offer_state s'
               '                    where s.sky_id = l.sky_id and s.buyable)'
               ' order by l.sky_id limit 10) x', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),

  -- ------------------------------------- Was daraus faellig ist
  (301, 'Meldungen', 'Info: faellige Verfuegbarkeitsereignisse',
      case when has_function_privilege('public.offer_availability_due()', 'execute')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.offer_availability_due() d',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (302, 'Meldungen', 'Info: davon betroffene Favoriten (created_at < buyable_since)',
      case when has_function_privilege('public.offer_availability_due()', 'execute')
            and has_table_privilege('public.favorites', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.offer_availability_due() d '
               'join public.favorites v on v.sky_id = d.sky_id '
               'where v.created_at < d.buyable_since', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  /*
   * WARTEN IST NICHT STILLSTAND. Eine Figur, die kaufbar ist und deren
   * Phase laeuft, aber noch keine 30 Minuten — die ist NOCH nicht faellig
   * und wird es. Diese Zeile unterscheidet „die Karenzzeit laeuft" von
   * „es passiert nichts".
   */
  (303, 'Meldungen', 'Info: kaufbare Phasen in der Karenzzeit (werden noch faellig)',
      case when has_table_privilege('public.offer_state', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.offer_state s '
               'where s.buyable and s.buyable_since is not null '
               '  and now() - s.buyable_since < public.offer_availability_grace() '
               '  and (s.announced_at is null or s.buyable_since > s.announced_at)',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (311, 'Meldungen', 'Info: gespeicherte Meldungen insgesamt',
      case when has_table_privilege('public.availability_notifications', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.availability_notifications',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (312, 'Meldungen', 'Info: davon ungelesen',
      case when has_table_privilege('public.availability_notifications', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.availability_notifications '
               'where read_at is null', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),

  -- --------------------------------- Eine Figur im Einzelnen
  (401, 'Figur', 'Info: welche SKY-ID untersucht wird (set_config '
        '''skyisles.sky'' setzen)',
      coalesce((select sky from gewuenscht), '(keine angegeben)'), null),
  (402, 'Figur', 'Info: ihr Name im Katalog',
      coalesce((select s.name from public.skylanders s
                 where s.sky_id = (select sky from gewuenscht)), '(nicht gefunden)'),
      null),
  (403, 'Figur', 'Info: steht sie im Spiegel, und gilt sie dort als kaufbar',
      case when (select sky from gewuenscht) is null then '(keine angegeben)'
           when has_table_privilege('public.offer_state', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select coalesce((select s.buyable::text from public.offer_state s '
               'where s.sky_id = ' || quote_literal((select sky from gewuenscht))
               || '), ''(keine Zeile im Spiegel)'') as c', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (404, 'Figur', 'Info: seit wann laeuft ihre Verfuegbarkeitsphase',
      case when (select sky from gewuenscht) is null then '(keine angegeben)'
           when has_table_privilege('public.offer_state', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select coalesce((select s.buyable_since::text from public.offer_state s '
               'where s.sky_id = ' || quote_literal((select sky from gewuenscht))
               || '), ''(keine Zeile im Spiegel)'') as c', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (405, 'Figur', 'Info: und wann wurde sie zuletzt gemeldet (announced_at)',
      case when (select sky from gewuenscht) is null then '(keine angegeben)'
           when has_table_privilege('public.offer_state', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select coalesce((select coalesce(s.announced_at::text, ''(nie)'') '
               'from public.offer_state s where s.sky_id = '
               || quote_literal((select sky from gewuenscht))
               || '), ''(keine Zeile im Spiegel)'') as c', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (406, 'Figur', 'Info: ist sie LIVE kaufbar, und zu welchem Preis in Cent',
      case when (select sky from gewuenscht) is null then '(keine angegeben)'
           when has_table_privilege('public.offer_state_live', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select coalesce((select l.cheapest_cents::text '
               'from public.offer_state_live l where l.sky_id = '
               || quote_literal((select sky from gewuenscht))
               || '), ''(nicht kaufbar)'') as c', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (407, 'Figur', 'Info: wie viele Konten haben sie vorgemerkt, und wie viele davon '
        'VOR dem Phasenbeginn',
      case when (select sky from gewuenscht) is null then '(keine angegeben)'
           when has_table_privilege('public.favorites', 'select')
            and has_table_privilege('public.offer_state', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*)::text || '' / '' || count(*) filter ('
               '  where s.buyable_since is not null and v.created_at < s.buyable_since'
               ')::text as c from public.favorites v '
               'left join public.offer_state s on s.sky_id = v.sky_id '
               'where v.sky_id = ' || quote_literal((select sky from gewuenscht)),
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (408, 'Figur', 'Info: und wie viele Meldungen existieren fuer sie',
      case when (select sky from gewuenscht) is null then '(keine angegeben)'
           when has_table_privilege('public.availability_notifications', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.availability_notifications n '
               'where n.sky_id = ' || quote_literal((select sky from gewuenscht)),
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),

  -- ----------------------------------- Die Einstellungen, wie sie gelten
  (501, 'Regeln', 'Info: Karenzzeit (offer_availability_grace)',
      case when has_function_privilege('public.offer_availability_grace()', 'execute')
           then (xpath('/row/c/text()', query_to_xml(
               'select public.offer_availability_grace()::text as c',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (502, 'Regeln', 'Info: Drosselung des Nachziehens (offer_state_window)',
      case when has_function_privilege('public.offer_state_window()', 'execute')
           then (xpath('/row/c/text()', query_to_xml(
               'select public.offer_state_window()::text as c',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null)
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
select 9998, 'GESAMT', 'Zeilen, die diese Rolle nicht lesen durfte '
       '(0 = vollstaendig geprueft)',
       (select count(*) from ergebnis where befund = 'KEIN-RECHT')::text, null, null
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
