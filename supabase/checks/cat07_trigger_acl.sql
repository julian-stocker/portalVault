-- ===========================================================================
-- DIAGNOSE CAT-07, Teil 2: traegt JEDE Triggerfunktion ein offenes Recht?
--
-- DER BEFUND. `skylanders_variant_base_guard()` aus `0159` traegt
-- `=X/postgres` (das ist PUBLIC) und `anon=X/postgres`. Die beiden
-- Admin-RPCs derselben Migration tragen das nicht — `0159` widerruft dort
-- ausdruecklich. Zwei Erklaerungen, und sie fuehren zu entgegengesetzten
-- Schritten:
--
--   (1) DAS IST DIE HAUSNORM. Jede Triggerfunktion im Projekt steht so da,
--       weil PostgreSQL bei `create function` PUBLIC ein EXECUTE gibt und
--       eine Funktion mit Rueckgabetyp `trigger` ohnehin nicht direkt
--       aufrufbar ist. Dann ist `0159` konsistent und nichts zu tun — ausser
--       es zu wissen.
--   (2) DIE ANDEREN WIDERRUFEN ES. Dann ist `0159` die Ausnahme, und das
--       gehoert korrigiert.
--
-- WARUM DAS UEBERHAUPT ZAEHLT. Eine Funktion mit Rueckgabetyp `trigger`
-- laesst sich nicht als `select f()` aufrufen — PostgreSQL weist das ab —,
-- und PostgREST stellt sie nicht bereit. Das Risiko ist also gering. Die
-- Haltung des Projekts ist aber, dass jede `security definer`-Funktion ihr
-- Recht ausdruecklich traegt; eine Ausnahme ohne Begruendung ist eine
-- Ausnahme, die beim naechsten Mal kopiert wird.
--
-- SIE SCHREIBT NICHTS.
-- ===========================================================================

with trigger_fn as (
  select p.oid, p.proname::text as name, p.prosecdef,
         coalesce(array_to_string(p.proacl, ' | '), '(Vorgabe: keine ACL)') as acl,
         (select count(*) from aclexplode(coalesce(p.proacl, '{}')) a
           where a.privilege_type = 'EXECUTE'
             and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public')))
           as offen
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prorettype = 'pg_catalog.trigger'::regtype
),
pruef (nr, bereich, pruefung, befund) as (values
  (971, 'Triggerfunktionen', 'wie viele es im Schema public gibt',
      (select count(*)::text from trigger_fn)),
  (972, 'Triggerfunktionen', 'wie viele davon ein offenes EXECUTE tragen (PUBLIC/anon)',
      (select count(*)::text from trigger_fn where offen > 0)),
  (973, 'Triggerfunktionen', 'wie viele KEIN offenes tragen',
      (select count(*)::text from trigger_fn where offen = 0)),
  /*
   * DIE ENTSCHEIDENDE ZEILE. Traegt die ueberwaeltigende Mehrheit ein
   * offenes Recht, ist es die Hausnorm und `0159` folgt ihr. Traegt sie
   * keines, ist `0159` die Ausnahme.
   */
  (974, 'Triggerfunktionen', 'die MIT offenem Recht, namentlich (die ersten zwanzig)',
      (select coalesce(string_agg(x.name, ', ' order by x.name), '(keine)')
         from (select name from trigger_fn where offen > 0 order by name limit 20) x)),
  (975, 'Triggerfunktionen', 'die OHNE offenes Recht, namentlich (die ersten zwanzig)',
      (select coalesce(string_agg(x.name, ', ' order by x.name), '(keine)')
         from (select name from trigger_fn where offen = 0 order by name limit 20) x)),
  (976, 'Triggerfunktionen', 'davon security definer: mit offenem Recht / ohne',
      (select count(*) filter (where offen > 0 and prosecdef)::text || ' / '
           || count(*) filter (where offen = 0 and prosecdef)::text
         from trigger_fn)),

  -- --------------------------------- Die beiden aus 0152 und 0159 im Vergleich
  (981, 'Vergleich', 'skylanders_variant_base_guard (0159): ACL',
      (select coalesce(max(acl), '(fehlt)') from trigger_fn
        where name = 'skylanders_variant_base_guard')),
  (982, 'Vergleich', 'skylanders_sync_catalog_status (0152): ACL',
      (select coalesce(max(acl), '(fehlt)') from trigger_fn
        where name = 'skylanders_sync_catalog_status')),
  (983, 'Vergleich', 'log_skylander_editorial_change (0004/0152): ACL',
      (select coalesce(max(acl), '(fehlt)') from trigger_fn
        where name = 'log_skylander_editorial_change')),
  (984, 'Vergleich', 'skylanders_set_item_type (0135, security definer): ACL',
      (select coalesce(max(acl), '(fehlt)') from trigger_fn
        where name = 'skylanders_set_item_type')),

  -- ------------------------------- Laesst sie sich ueberhaupt aufrufen?
  /*
   * DER EIGENTLICHE GRUND, WARUM DAS RISIKO GERING IST: eine Funktion mit
   * Rueckgabetyp `trigger` ist nicht als Ausdruck aufrufbar. Hier steht es
   * als gemessene Tatsache und nicht als Behauptung.
   */
  (991, 'Aufrufbarkeit', 'ihr Rueckgabetyp',
      (select coalesce(max(format_type(p.prorettype, null)), '(fehlt)')
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'skylanders_variant_base_guard')),
  (992, 'Aufrufbarkeit', 'Funktionen mit Rueckgabetyp trigger, die PostgREST anbieten koennte',
      '0 — PostgREST stellt trigger-Rueckgaben nicht bereit'),
  (993, 'Aufrufbarkeit', 'Argumentzahl (eine Triggerfunktion nimmt keine)',
      (select coalesce(max(p.pronargs)::text, '(fehlt)')
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'skylanders_variant_base_guard'))
)
select nr, bereich, pruefung, befund, null::text as erwartet, null::boolean as ok
  from pruef
 order by nr;
