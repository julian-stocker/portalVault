-- ===========================================================================
-- CAT-10: die ABDRUECKE, die eine Migration als Riegel braucht.
--
-- `0163` ersetzt zwei vorhandene Funktionsruempfe (`admin_merge_plan` und
-- `admin_merge_draft` aus `0157`) und erweitert die Audit-Constraint. Bevor
-- sie einen fremden Rumpf blind ueberschreibt, muss sie wissen, welcher heute
-- dasteht — und diese Datei nennt ihn.
--
-- SIE SCHREIBT NICHTS.
-- ===========================================================================

with pruef (nr, bereich, pruefung, befund) as (values
  (101, 'Abdruecke', 'admin_merge_plan(text,text,text)',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_plan(text,text,text)'))),
  (102, 'Abdruecke', 'Laenge des Rumpfes',
      (select coalesce(length(p.prosrc)::text, '-') from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_plan(text,text,text)'))),
  (103, 'Abdruecke', 'admin_merge_draft(text,text,text,jsonb)',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)'))),
  (104, 'Abdruecke', 'Laenge des Rumpfes',
      (select coalesce(length(p.prosrc)::text, '-') from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)'))),
  (105, 'Abdruecke', 'admin_merge_draft(text,text,text) — die Weiterleitung',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.admin_merge_draft(text,text,text)'))),

  (201, 'Journal', 'die Audit-Constraint, wie sie heute steht',
      (select coalesce(max(pg_get_constraintdef(c.oid)), '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known')),
  (202, 'Journal', 'kennt sie market_price und deleted (= 0162 ist angewendet)?',
      (select coalesce(max((pg_get_constraintdef(c.oid) like '%market_price%'
                        and pg_get_constraintdef(c.oid) like '%deleted%')::text),
                       '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known')),

  (301, 'Spalten', 'types steht schon?',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'types' and not a.attisdropped)),
  (302, 'Spalten', 'visible_type steht schon?',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'visible_type' and not a.attisdropped)),
  (303, 'Spalten', 'visible_type_decided steht schon?',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'visible_type_decided' and not a.attisdropped)),
  (304, 'Spalten', 'der CHECK auf card_type, unveraendert',
      (select coalesce(max(pg_get_constraintdef(c.oid)), '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_card_type_known')),
  (305, 'Spalten', 'der Exportrumpf (0160) — 0164 ersetzt ihn',
      (select coalesce(md5(p.prosrc), '(fehlt)') from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()'))),
  (306, 'Spalten', 'seine Laenge',
      (select coalesce(length(p.prosrc)::text, '-') from pg_proc p
        where p.oid = to_regprocedure('public.system_platform_export()'))),

  /*
   * DIE ZWEI VORBEDINGUNGEN VON `0162`, die sonst erst ihr eigener Preflight
   * sieht (Zeilen 106 und 107 dort). Sie stehen hier, weil der Betreiber vor
   * der Freigabe wissen will, ob die Huellen auf dem aktuellen Bestand
   * ueberhaupt durchlaufen — und `skylanders_market_price_positive` ist die
   * letzte Schicht hinter der Preisregel: ohne sie waere „0 Euro ist kein
   * Preis" nur eine Bitte.
   */
  (307, 'Preis', 'skylanders_market_price_positive steht (Wortlaut)',
      (select coalesce(max(pg_get_constraintdef(c.oid)), '(FEHLT)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_market_price_positive')),
  (308, 'Preis', 'skylanders.price_updated_at steht',
      (select case when count(*) = 1 then 'steht' else 'FEHLT' end
         from pg_attribute a
        where a.attrelid = to_regclass('public.skylanders')
          and a.attname = 'price_updated_at' and not a.attisdropped)),
  (309, 'Preis', 'Zeilen mit Marktwert / ohne / mit Datum ohne Preis',
      (select count(*) filter (where market_price is not null)::text || ' / '
           || count(*) filter (where market_price is null)::text || ' / '
           || count(*) filter (where market_price is null
                                 and price_updated_at is not null)::text
         from public.skylanders)),
  /*
   * UND DER ABDRUCK DER KARTENKUNST, hier noch einmal — damit die EINE Zahl,
   * die sich seit der CAT-10-Messung bewegt hat, an der Stelle steht, an der
   * die Riegel der Huellen gepruft werden.
   */
  (310, 'Kartenkunst', 'der heutige Abdruck von card_type',
      (select coalesce(md5(string_agg(sky_id || '|' || card_type, E'\n'
                                      order by sky_id)), '(leer)')
         from public.skylanders))
)
select nr, bereich, pruefung, befund, null::text as erwartet, null::boolean as ok
  from pruef
 order by nr;
