-- ===========================================================================
-- DIAGNOSE CAT-07: sind die Funktionen aus 0159 sicher konfiguriert?
--
-- DER BEFUND DES BETREIBERS. Zeile 123 der Nachkontrolle meldet 0 statt 2:
-- „beide sind security definer mit genau einer search_path-Festlegung".
-- Zwei Erklaerungen sind moeglich, und sie fuehren zu entgegengesetzten
-- Schritten:
--
--   (1) DIE PRUEFUNG IST FALSCH. Dann ist nichts zu reparieren, nur eine
--       Zeile zu korrigieren.
--   (2) DIE FUNKTIONEN SIND FALSCH KONFIGURIERT. Dann stehen zwei
--       `security definer`-Funktionen ohne festen `search_path` in der
--       Datenbank, und das ist eine echte Luecke: ein veraenderbarer
--       Suchpfad laesst eine untergeschobene Funktion gleichen Namens
--       aufrufen.
--
-- DIESE DATEI ENTSCHEIDET DAS, und zwar an den ECHTEN Werten. Sie fragt
-- `prosecdef` und `proconfig` einzeln und AUSGEPACKT — nicht gegen ein
-- Literal verglichen. Genau dieser Fehler ist dem Projekt schon einmal
-- passiert (P51: eine Pruefzeile verlangte `search_path=` und war deshalb
-- rot, und dieselbe falsche Erwartung stand in der Nachkontrolle zu `0144`).
--
--   901-908  DIE ZWEI NEUEN aus `0159`, Attribut fuer Attribut.
--   911-914  DER TRIGGER aus `0159` — er ist auch `security definer`.
--   921-924  DER ERSETZTE RUMPF von `admin_merge_references`: hat das
--            Ersetzen Attribute oder Rechte veraendert?
--   931-936  DIE DREI aus `0158` zum Vergleich: sie sind dieselbe Bauform
--            und am 2026-10-28 gruen durchgelaufen. Wenn die hier anders
--            dastehen als die neuen, liegt es an `0159`; stehen sie gleich,
--            liegt es an der Pruefung.
--   941-944  DIE RECHTE im Volltext, und wer Eigner ist.
--
-- SIE SCHREIBT NICHTS und ruft keine der Funktionen auf.
-- ===========================================================================

with fn (nr, bez, sig) as (values
  (900, 'admin_set_variant_base',   'public.admin_set_variant_base(text,text,boolean)'),
  (910, 'admin_publish_with_base',  'public.admin_publish_with_base(text,text,boolean)'),
  (920, 'variant_base_guard',       'public.skylanders_variant_base_guard()'),
  (930, 'admin_merge_references',   'public.admin_merge_references(text)'),
  (940, 'admin_set_character',      'public.admin_set_character(text,bigint)'),
  (950, 'admin_create_character',   'public.admin_create_character(text)'),
  (960, 'admin_publish_as_variant', 'public.admin_publish_as_variant(text,bigint)')
),
gemessen as (
  select f.nr, f.bez, f.sig,
         p.oid,
         p.prosecdef,
         p.provolatile::text                              as volatil,
         p.proleakproof,
         coalesce(array_length(p.proconfig, 1), 0)         as config_anzahl,
         coalesce(array_to_string(p.proconfig, ' | '), '(keine)') as config_roh,
         /*
          * AUSGEPACKT, NICHT VERGLICHEN. PostgreSQL quotiert den Wert:
          * `set search_path = ''` liegt als `search_path=""` ab. Ein
          * Vergleich gegen ein Literal ist ein Fehlalarm in Wartestellung —
          * `migration-integrity.test.ts` haelt diese Regel fuer jede
          * Pruefdatei fest, die `proconfig` liest.
          */
         (select substring(c from 'search\_path=(.*)$')
            from unnest(coalesce(p.proconfig, '{}')) c
           where c like 'search\_path=%')                  as pfadwert,
         (select count(*) from unnest(coalesce(p.proconfig, '{}')) c
           where c like 'search\_path=%')                  as pfadanzahl,
         pg_get_userbyid(p.proowner)                       as eigner,
         coalesce(array_to_string(p.proacl, ' | '), '(Vorgabe: keine ACL)') as acl,
         /*
          * Die Rechte EINMAL mitgenommen, statt sie unten noch einmal aus
          * `pg_proc` zu holen. Ein zweiter Durchgriff waere derselbe Wert
          * mit einem zweiten Alias — und `check-sql-hazards.test.ts` liest
          * einen Alias in einer geschachtelten Skalar-Unterabfrage nicht
          * als gebunden. Diese Fassung braucht ihn nicht.
          */
         coalesce(p.proacl, '{}')                          as acl_roh
    from fn f
    left join pg_proc p on p.oid = to_regprocedure(f.sig)
),
pruef (nr, bereich, pruefung, befund, erwartet) as (
  select g.nr + 1, g.bez, 'die Funktion steht',
         (g.oid is not null)::text, 'true' from gemessen g
  union all
  select g.nr + 2, g.bez, 'security definer',
         coalesce(g.prosecdef::text, '(fehlt)'), 'true' from gemessen g
  union all
  select g.nr + 3, g.bez, 'Anzahl der Festlegungen in proconfig',
         coalesce(g.config_anzahl::text, '(fehlt)'), '1' from gemessen g
  union all
  select g.nr + 4, g.bez, 'proconfig im Volltext — hier steht, was wirklich gilt',
         coalesce(g.config_roh, '(fehlt)'), null from gemessen g
  union all
  select g.nr + 5, g.bez, 'Anzahl der search_path-Festlegungen (EIN Backslash im Muster)',
         coalesce(g.pfadanzahl::text, '(fehlt)'), '1' from gemessen g
  union all
  select g.nr + 6, g.bez, 'der ausgepackte Wert des Suchpfads — "" heisst LEER und ist sicher',
         coalesce(g.pfadwert, '(keiner)'), '""' from gemessen g
  union all
  select g.nr + 7, g.bez, 'Info: volatil | leakproof | Eigner',
         coalesce(g.volatil || ' | ' || g.proleakproof::text || ' | ' || g.eigner,
                  '(fehlt)'), null from gemessen g
  union all
  select g.nr + 8, g.bez, 'Info: die Rechte im Volltext',
         coalesce(g.acl, '(fehlt)'), null from gemessen g
  union all
  select g.nr + 9, g.bez, 'kein EXECUTE fuer anon oder public',
         coalesce((select count(*)::text from aclexplode(g.acl_roh) a
                    where a.privilege_type = 'EXECUTE'
                      and (a.grantee = 0 or a.grantee::regrole::text in ('anon','public'))),
                  '0'), '0'
    from gemessen g
)
select nr, bereich, pruefung, befund, erwartet,
       case when befund = 'KEIN-RECHT' then null
            when erwartet is null then null
            else befund is not distinct from erwartet end as ok
  from pruef
 order by nr;
