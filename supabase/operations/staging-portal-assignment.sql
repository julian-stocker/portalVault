-- ===========================================================================
-- STAGING — DIE 35 PORTALPOSITIONEN BEKOMMEN IHRE SKY-ID
--
-- ###########################################################################
-- ##  NICHT AUSGEFUEHRT. Braucht eine ausdrueckliche Freigabe.             ##
-- ##  Befund und Begruendung: accessory_assignment_proposal.md             ##
-- ###########################################################################
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
-- Ein Fehler irgendwo rollt alles zurueck.
--
-- WAS SIE TUT, UND NUR DAS
--
-- Sie setzt auf 35 Einkaufspositionen die `sky_id` eines Portalartikels.
-- EINE SPALTE, plus `updated_at`. Nichts sonst.
--
-- WARUM NICHT UEBER `seller_set_purchase_item_sky()`
--
-- Das waere der gebaute Weg (`0054`), und er ist der richtige — aber er ist
-- aus dem SQL-Editor NICHT erreichbar: die Funktion fragt als erste Anweisung
-- `can_operate_active_seller()`, und das verlangt ein `auth.uid()`, das eine
-- Editor-Sitzung nicht hat. Sie wuerde mit `insufficient_privilege`
-- abbrechen.
--
-- Diese Datei bildet deshalb nach, was die Funktion tut, und zwar genau:
--
--   * sie schreibt NUR `sky_id` und `updated_at` — wie die Funktion, die
--     ihre uebrigen Spalten ausdruecklich „deliberately untouched" nennt;
--   * sie beruehrt `raw_name`, `source_row`, die Legacy-Flaggen, `state`,
--     `position` und `condition` nicht, und Abschnitt C beweist das mit
--     einem Abdruck ueber genau diese Felder;
--   * sie weist jede Position ab, die eine Lagerbewegung besitzt — dieselbe
--     Bedingung, mit der die Funktion sich schuetzt;
--   * sie bewegt keinen Bestand: kein `insert` in `inventory_movements`,
--     keine Zeile in `shop_inventory`, kein Einbuchen.
--
-- WAS SIE AUSDRUECKLICH NICHT TUT
--
--   * KEINE unscharfe Suche. Verglichen wird auf EXAKTE Gleichheit mit elf
--     ausgeschriebenen Rohnamen — kein `ilike`, kein `trim`, kein
--     `lower()`, keine Normalisierung. Die elf Paare stehen unten als Daten,
--     nicht als Regel.
--   * KEIN weiterer Artikel. Die 171 uebrigen Freitextpositionen —
--     Disney Infinity, Amiibo, Figurenteile, Taschen — bleiben unberuehrt.
--   * KEIN Preis, keine Menge, keine Kostenaufteilung, keine bezahlte Summe.
--   * KEIN Eigenbeleg, kein Belegzaehler. Die Belegsperre wird nicht
--     beruehrt.
--   * Nichts an Production. Bricht auf jeder Datenbank ab, die den
--     Staging-Stempel nicht traegt.
--
-- SIE IST WIEDERHOLBAR UND UNVOLLSTAENDIG-FEST. Abschnitt A bestimmt die 35
-- Zielpositionen als Vereinigung aus „noch Freitext" und „schon zugeordnet".
-- Wer vorher eine Position von Hand zuordnet (empfohlen: `SKY-0622`, eine
-- Position), kann diese Datei danach unveraendert fahren — sie findet dann
-- 34 offene und 1 fertige und kommt auf dieselben 35.
--
-- ERWARTETES ERGEBNIS: das Raster in D zeigt 35 zugeordnete Positionen,
-- Freitext 206 → 171, und JEDEN anderen Bezugswert unveraendert.
--
-- RUECKNAHME: `supabase/rollback/R_portal_assignment.sql`.
-- ===========================================================================

begin;

set local statement_timeout = '60s';
set local lock_timeout = '5s';

create temporary table pa_abdruck (
  schluessel text primary key,
  wert       text not null
) on commit drop;

/*
 * DIE ENTSCHEIDUNG DES BETREIBERS, ALS DATEN.
 *
 * Elf Paare, jedes ausgeschrieben. Das ist die namensweise Entscheidung, die
 * ADR-0128 Punkt 10 verlangt — keine Regel, die irgendetwas ableitet. Wer
 * ein Paar streicht, laesst dessen Positionen Freitext; die Nachbedingung
 * rechnet dann mit der kleineren Summe, weil sie aus dieser Tabelle kommt.
 */
create temporary table pa_zuordnung (
  sky_id   text primary key,
  raw_name text not null unique,
  erwartet integer not null
) on commit drop;

insert into pa_zuordnung (sky_id, raw_name, erwartet) values
  ('SKY-0615', '84157790 (SA)',            1),
  ('SKY-0616', '83973080 (SA)',            2),
  ('SKY-0617', '83973080A Wireless (SA)',  5),
  ('SKY-0618', '0000502 (G)',              7),
  ('SKY-0619', '0000547 (SF)',            11),
  ('SKY-0620', '0000586 (T)',              2),
  ('SKY-0621', '0000655 (SC)',             3),
  ('SKY-0622', '0000726 (I)',              1),
  ('SKY-0624', '84151790 (SA)',            1),
  ('SKY-0627', '84704790 (SF)',            1),
  ('SKY-0637', '84721790 (SF, T, SC)',     1);

/*
 * DIE ZIELPOSITIONEN, EINMALIG BESTIMMT — VOR JEDEM SCHREIBEN.
 *
 * Abschnitt B schreibt ausschliesslich Zeilen, deren `id` hier steht. Damit
 * ist der Umfang nicht von der Reihenfolge der Anweisungen abhaengig und
 * nicht von einem `where`, das waehrend des Laufs anderes trifft.
 */
create temporary table pa_ziel (
  id          bigint primary key,
  sky_id      text   not null,
  schon       boolean not null
) on commit drop;


-- ---------------------------------------------------------------------------
-- A. Vorher: Umgebung, Vorbedingungen, Zielmenge, Bezugswerte
-- ---------------------------------------------------------------------------
do $pa_a$
declare
  v_zahl integer;
  v_text text;
begin
  -- A1. Bin ich auf Staging?
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) <> 2 then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden. Diese Datei '
      'laeuft nur auf Staging qqxcpesbwfxzgytkdsac.';
  end if;

  -- A2. Laeuft sie in einer Transaktion?
  if to_regclass('pg_temp.pa_abdruck') is null
     or to_regclass('pg_temp.pa_zuordnung') is null then
    raise exception 'ABBRUCH A2: die Datei laeuft nicht in einer Transaktion — '
      'vollstaendig einfuegen, nicht in Teilen ausfuehren.';
  end if;

  -- A3. Die elf Artikel gibt es, sie heissen genau so, und sie sind Portale.
  select count(*) into v_zahl
    from pa_zuordnung z
    join public.skylanders s on s.sky_id = z.sky_id
   where s.name = z.raw_name and s.item_type = 'portal';
  if v_zahl <> (select count(*) from pa_zuordnung) then
    raise exception 'ABBRUCH A3: nur % von % Paaren finden einen Portalartikel mit '
      'genau diesem Namen — 0138 fehlt, oder ein Name weicht ab.',
      v_zahl, (select count(*) from pa_zuordnung);
  end if;

  /*
   * A4. JEDER ROHNAME TRIFFT GENAU EINEN KATALOGARTIKEL.
   *
   * Gaebe es zwei Artikel desselben Namens, waere die Zuordnung mehrdeutig
   * und diese Datei duerfte sie nicht treffen.
   */
  select string_agg(z.raw_name, ', ' order by z.raw_name) into v_text
    from pa_zuordnung z
   where (select count(*) from public.skylanders s where s.name = z.raw_name) <> 1;
  if v_text is not null then
    raise exception 'ABBRUCH A4: mehrdeutiger Rohname: %', v_text;
  end if;

  -- A5. Die Zielmenge: noch Freitext ODER schon zugeordnet.
  insert into pa_ziel (id, sky_id, schon)
  select pi.id, z.sky_id, pi.sky_id is not null
    from public.purchase_items pi
    join pa_zuordnung z on z.raw_name = pi.raw_name
   where pi.sky_id is null or pi.sky_id = z.sky_id;

  select count(*) into v_zahl from pa_ziel;
  if v_zahl <> (select sum(erwartet) from pa_zuordnung) then
    raise exception 'ABBRUCH A5: % Zielpositionen gefunden, erwartet % — die Datenlage '
      'hat sich seit der Bestandsaufnahme vom 2026-10-20 bewegt. Erst '
      'accessory_assignment_readonly.sql fahren und klaeren.',
      v_zahl, (select sum(erwartet) from pa_zuordnung);
  end if;

  -- Und je Artikel genau die erwartete Zahl, nicht nur in der Summe.
  select string_agg(x.zeile, ', ' order by x.zeile) into v_text
    from (select z.sky_id || ': ' || count(t.id)::text || ' statt ' || z.erwartet::text as zeile
            from pa_zuordnung z
            left join pa_ziel t on t.sky_id = z.sky_id
           group by z.sky_id, z.erwartet
          having count(t.id) <> z.erwartet) x;
  if v_text is not null then
    raise exception 'ABBRUCH A5: Abweichung je Artikel — %', v_text;
  end if;

  /*
   * A6. KEINE DER 35 BESITZT EINE LAGERBEWEGUNG.
   *
   * Dieselbe Bedingung, mit der `seller_set_purchase_item_sky` sich schuetzt:
   * die Bewegung benennt die Figur, die in den Bestand ging. Eine Position
   * umzuhaengen, an der eine Bewegung haengt, liesse beide verschiedene
   * Dinge beschreiben.
   */
  select count(*) into v_zahl
    from public.purchase_items pi join pa_ziel t on t.id = pi.id
   where pi.movement_id is not null;
  if v_zahl > 0 then
    raise exception 'ABBRUCH A6: % Zielposition(en) besitzen eine Lagerbewegung — '
      'erst die Buchung zuruecknehmen, dann zuordnen.', v_zahl;
  end if;

  -- A7. Die Bezugswerte, und der Abdruck ueber genau die 35.
  insert into pa_abdruck (schluessel, wert) values
    ('ziel',          (select count(*)::text from pa_ziel)),
    ('schon',         (select count(*)::text from pa_ziel where schon)),
    ('positionen',    (select count(*)::text from public.purchase_items)),
    ('ohne_sky_id',   (select count(*)::text from public.purchase_items where sky_id is null)),
    ('auf_portalen',  (select count(*)::text from public.purchase_items pi
                        join public.skylanders s on s.sky_id = pi.sky_id
                       where s.item_type = 'portal')),
    ('auf_spielen',   (select count(*)::text from public.purchase_items pi
                        join public.skylanders s on s.sky_id = pi.sky_id
                       where s.item_type = 'game')),
    ('lagerzeilen',   (select count(*)::text from public.shop_inventory)),
    ('einheiten',     (select coalesce(sum(quantity), 0)::text from public.shop_inventory)),
    ('bewegungen',    (select count(*)::text from public.inventory_movements)),
    ('verkaufspos',   (select count(*)::text from public.sale_items)),
    ('sammlung',      (select count(*)::text from public.collection_items)),
    ('katalogzeilen', (select count(*)::text from public.skylanders)),
    ('einkaeufe',     (select count(*)::text from public.purchases)),
    ('belege',        (select count(*)::text from public.purchase_receipts)),
    ('angebote',      (select count(*)::text from public.shop_offers())),
    ('angebote_md5',  (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                        || coalesce(o.price::text, ''),
                                        ';' order by o.sky_id, o.condition), ''))
                         from public.shop_offers() o)),
    /*
     * DER ABDRUCK, DER DIE EIGENTLICHE ZUSICHERUNG TRAEGT.
     *
     * Ueber `id`, `raw_name`, `state` und `condition` der 35 Zielpositionen.
     * Keines dieser Felder darf sich bewegen; Abschnitt C vergleicht
     * denselben Ausdruck ueber dieselben Ids.
     */
    ('felder_md5',
       (select md5(coalesce(string_agg(pi.id::text || '|' || coalesce(pi.raw_name, '') || '|'
                                       || pi.state || '|' || pi.condition,
                                       ';' order by pi.id), ''))
          from public.purchase_items pi join pa_ziel t on t.id = pi.id)),
    ('kosten_md5',
       (select md5(coalesce(string_agg(p.id::text || '|' || coalesce(p.total_cost::text, ''),
                                       ';' order by p.id), ''))
          from public.purchases p
         where p.id in (select distinct pi.purchase_id from public.purchase_items pi
                          join pa_ziel t on t.id = pi.id)));

  raise notice 'A ok: Staging, % Zielpositionen (% schon zugeordnet), keine mit '
    'Lagerbewegung, % Bezugswerte erfasst.',
    (select wert from pa_abdruck where schluessel = 'ziel'),
    (select wert from pa_abdruck where schluessel = 'schon'),
    (select count(*) from pa_abdruck);
end $pa_a$;


-- ---------------------------------------------------------------------------
-- B. Die Zuordnung — eine Anweisung, eine Spalte
--
-- NUR ZEILEN AUS `pa_ziel`, und nur die noch freien. `movement_id is null`
-- steht trotzdem noch einmal da: Abschnitt A hat es geprueft, und eine
-- Bedingung, die beides tut, kostet nichts.
--
-- `updated_at` wird mitgesetzt, weil `seller_set_purchase_item_sky` es
-- mitsetzt. Alles andere bleibt, wie es ist.
-- ---------------------------------------------------------------------------
update public.purchase_items pi
   set sky_id     = t.sky_id,
       updated_at = now()
  from pa_ziel t
 where pi.id = t.id
   and pi.sky_id is null
   and pi.movement_id is null;


-- ---------------------------------------------------------------------------
-- C. Nachher: dieselben Werte, verglichen
-- ---------------------------------------------------------------------------
do $pa_c$
declare
  v_ist  text;
  v_soll text;
  v_zahl integer;
begin
  if to_regclass('pg_temp.pa_abdruck') is null then
    raise exception 'ABBRUCH C0: der Abdruck aus A ist fort — der Lauf war nicht EINE '
      'Transaktion.';
  end if;

  -- C1. Jede Zielposition traegt jetzt ihre SKY-ID, und zwar die richtige.
  select count(*) into v_zahl
    from public.purchase_items pi join pa_ziel t on t.id = pi.id
   where pi.sky_id is distinct from t.sky_id;
  if v_zahl > 0 then
    raise exception 'ABBRUCH C1: % Zielposition(en) tragen nicht die vorgesehene SKY-ID', v_zahl;
  end if;

  -- C2. Und je Artikel genau die erwartete Zahl.
  select string_agg(x.zeile, ', ' order by x.zeile) into v_ist
    from (select z.sky_id || ': ' || count(pi.id)::text || ' statt ' || z.erwartet::text as zeile
            from pa_zuordnung z
            left join public.purchase_items pi on pi.sky_id = z.sky_id
           group by z.sky_id, z.erwartet
          having count(pi.id) <> z.erwartet) x;
  if v_ist is not null then
    raise exception 'ABBRUCH C2: Abweichung je Artikel — %', v_ist;
  end if;

  /*
   * C3. DIE EIGENTLICHE ZUSICHERUNG: Rohname, Zustand und Lage sind
   *     unberuehrt. Derselbe Ausdruck ueber dieselben Ids wie in A.
   */
  v_soll := (select wert from pa_abdruck where schluessel = 'felder_md5');
  v_ist  := (select md5(coalesce(string_agg(pi.id::text || '|' || coalesce(pi.raw_name, '') || '|'
                                            || pi.state || '|' || pi.condition,
                                            ';' order by pi.id), ''))
               from public.purchase_items pi join pa_ziel t on t.id = pi.id);
  if v_ist <> v_soll then
    raise exception 'ABBRUCH C3: Rohname, Zustand oder Lage haben sich geaendert '
      '(md5 % statt %)', v_ist, v_soll;
  end if;

  -- C4. Keine Lagerbewegung ist entstanden, und keine Zielposition hat eine.
  select count(*) into v_zahl
    from public.purchase_items pi join pa_ziel t on t.id = pi.id
   where pi.movement_id is not null;
  if v_zahl > 0 then
    raise exception 'ABBRUCH C4: % Zielposition(en) besitzen jetzt eine Lagerbewegung', v_zahl;
  end if;

  -- C5. Die bezahlten Summen der betroffenen Einkaeufe sind unberuehrt.
  v_soll := (select wert from pa_abdruck where schluessel = 'kosten_md5');
  v_ist  := (select md5(coalesce(string_agg(p.id::text || '|' || coalesce(p.total_cost::text, ''),
                                            ';' order by p.id), ''))
               from public.purchases p
              where p.id in (select distinct pi.purchase_id from public.purchase_items pi
                               join pa_ziel t on t.id = pi.id));
  if v_ist <> v_soll then
    raise exception 'ABBRUCH C5: eine bezahlte Summe hat sich geaendert (md5 % statt %)',
      v_ist, v_soll;
  end if;

  /*
   * C6. DIE WERTE VON NACHHER, unter `n_` daneben gelegt — dasselbe Muster
   *     wie in `staging-0137-0138.sql`. Ein Vergleich, eine Schleife, keine
   *     Ausnahme, die man uebersehen kann.
   */
  insert into pa_abdruck (schluessel, wert) values
    ('n_positionen',    (select count(*)::text from public.purchase_items)),
    ('n_ohne_sky_id',   (select count(*)::text from public.purchase_items where sky_id is null)),
    ('n_auf_portalen',  (select count(*)::text from public.purchase_items pi
                          join public.skylanders s on s.sky_id = pi.sky_id
                         where s.item_type = 'portal')),
    ('n_auf_spielen',   (select count(*)::text from public.purchase_items pi
                          join public.skylanders s on s.sky_id = pi.sky_id
                         where s.item_type = 'game')),
    ('n_lagerzeilen',   (select count(*)::text from public.shop_inventory)),
    ('n_einheiten',     (select coalesce(sum(quantity), 0)::text from public.shop_inventory)),
    ('n_bewegungen',    (select count(*)::text from public.inventory_movements)),
    ('n_verkaufspos',   (select count(*)::text from public.sale_items)),
    ('n_sammlung',      (select count(*)::text from public.collection_items)),
    ('n_katalogzeilen', (select count(*)::text from public.skylanders)),
    ('n_einkaeufe',     (select count(*)::text from public.purchases)),
    ('n_belege',        (select count(*)::text from public.purchase_receipts)),
    ('n_angebote',      (select count(*)::text from public.shop_offers())),
    ('n_angebote_md5',  (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                           || coalesce(o.price::text, ''),
                                           ';' order by o.sky_id, o.condition), ''))
                           from public.shop_offers() o));

  /*
   * Und jeder davon muss gleich sein — mit genau ZWEI benannten Ausnahmen.
   * Die beiden sind bezifferte Differenzen und werden in C7 geprueft.
   */
  select string_agg(a.schluessel || ': "' || n.wert || '" statt "' || a.wert || '"',
                    ', ' order by a.schluessel) into v_ist
    from pa_abdruck a
    join pa_abdruck n on n.schluessel = 'n_' || a.schluessel
   where a.schluessel not in ('ohne_sky_id', 'auf_portalen')
     and a.wert is distinct from n.wert;
  if v_ist is not null then
    raise exception 'ABBRUCH C6: diese Zuordnung hat einen Wert bewegt, den sie nicht '
      'bewegen darf — %', v_ist;
  end if;

  -- C7. Die zwei, die sich bewegen MUESSEN, und zwar um genau 35.
  v_soll := (select wert from pa_abdruck where schluessel = 'ohne_sky_id');
  v_ist  := (select count(*)::text from public.purchase_items where sky_id is null);
  if v_ist::integer <> v_soll::integer
       - ((select wert::integer from pa_abdruck where schluessel = 'ziel')
        - (select wert::integer from pa_abdruck where schluessel = 'schon')) then
    raise exception 'ABBRUCH C7: Freitextpositionen sind %, erwartet % minus der '
      'zugeordneten', v_ist, v_soll;
  end if;

  v_ist := (select count(*)::text from public.purchase_items pi
              join public.skylanders s on s.sky_id = pi.sky_id
             where s.item_type = 'portal');
  if v_ist <> (select wert from pa_abdruck where schluessel = 'ziel') then
    raise exception 'ABBRUCH C7: % Positionen auf Portalen, erwartet %',
      v_ist, (select wert from pa_abdruck where schluessel = 'ziel');
  end if;

  -- C8. Und die Belegsperre ist unveraendert dicht.
  if exists (select 1 from (values
               ('public.seller_issue_purchase_receipt(bigint)'),
               ('public.seller_issue_purchase_receipt_correction(bigint)')) f(sig)
              cross join (values ('anon'), ('authenticated'), ('service_role')) r(n)
             where to_regprocedure(f.sig) is not null
               and has_function_privilege(r.n, f.sig, 'execute')) then
    raise exception 'ABBRUCH C8: die Belegsperre ist nicht mehr dicht';
  end if;

  raise notice 'C ok: % Positionen auf 11 Portalen, Rohname/Zustand/Lage unveraendert, '
    'keine Lagerbewegung entstanden, Freitext % → %, jeder andere Bezugswert gleich.',
    (select wert from pa_abdruck where schluessel = 'ziel'),
    (select wert from pa_abdruck where schluessel = 'ohne_sky_id'),
    (select count(*) from public.purchase_items where sky_id is null);
end $pa_c$;


-- ---------------------------------------------------------------------------
-- D. Das Ergebnisraster — ins Protokoll uebernehmen
--
-- Erwartet: `ohne_sky_id` und `auf_portalen` bewegen sich, alles andere
-- steht. Die Spalte `befund` sagt es selbst.
-- ---------------------------------------------------------------------------
select
  a.schluessel                          as gegenstand,
  a.wert                                as vorher,
  coalesce(n.wert, a.wert)              as nachher,
  case
    when a.schluessel in ('ohne_sky_id', 'auf_portalen') then 'erwartet bewegt'
    when n.wert is null                                  then 'Abdruck, in C verglichen'
    when a.wert is not distinct from n.wert              then 'gleich'
    else 'GEAENDERT'
  end                                   as befund
from pa_abdruck a
left join pa_abdruck n on n.schluessel = 'n_' || a.schluessel
where a.schluessel not like 'n\_%'
order by a.schluessel;

commit;
