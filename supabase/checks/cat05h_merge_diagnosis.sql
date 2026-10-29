-- ===========================================================================
-- DIAGNOSE CAT-05H: der erste echte Merge-Versuch ist fehlgeschlagen
--
-- DER BEFUND DES BETREIBERS
--   Entwurf  SKY-0824  „Pirate Seas"
--   Ziel     SKY-0103  „Pirate Ship"
--   Auswahl  nur Name; Bild abgewaehlt
--   Antwort  „Das hat nicht geklappt." — das ist `de.admin.writeFailed`, der
--            Auffangtext von `call()`. Er erscheint genau dann, wenn der
--            RPC einen Fehler liefert, den kein Zuordner erkannt hat.
--
-- WAS DIESE DATEI ENTSCHEIDEN SOLL, und zwar REIN LESEND:
--
--   1. 101-108  IST SCHON ETWAS GESCHEHEN? Beide Zeilen muessen unveraendert
--               dastehen: SKY-0103 weiterhin „Pirate Ship", SKY-0824
--               weiterhin ein Entwurf. Waere eine Haelfte geschrieben, waere
--               das der schwerste denkbare Befund — die Funktion laeuft in
--               EINER Transaktion, es darf keinen halben Stand geben.
--   2. 111-116  DIE RPC-AUFLOESUNG. Wie viele Fassungen von
--               `admin_merge_draft` stehen, mit welchen Parameterzahlen und
--               welchen Vorgabewerten. **Das ist der Hauptverdacht:**
--               PostgREST waehlt eine ueberladene Funktion anhand der
--               Schluessel im Rumpf der Anfrage. Steht eine Fassung mit
--               Vorgabewerten daneben, kann die Wahl mehrdeutig werden
--               (`PGRST203`) — und dieser Fehlercode wird von
--               `istUnbekannteFunktion()` NICHT erkannt, fuehrt also genau
--               zu „Das hat nicht geklappt."
--   3. 121-124  DIE RECHTE. Ob `authenticated` beide Fassungen ausfuehren
--               darf, und ob eine davon ein offenes Recht traegt.
--   4. 131-139  DER PLAN. Was eine Zusammenfuehrung an SKY-0103 aendern
--               WUERDE — gerechnet aus den echten Zeilen, ohne sie
--               anzufassen. Daran laesst sich ablesen, ob der angezeigte
--               Ausgangswert „Pirate Ship" der ist, mit dem der Server
--               rechnet. Weicht er ab, ist es die Veraltungspruefung.
--   5. 141-144  DIE REFERENZEN auf den Entwurf. Zeigt etwas darauf, bricht
--               die Funktion ab — und die Oberflaeche zeigte dann allerdings
--               „Auf diesen Entwurf zeigen noch Daten", nicht den
--               Auffangtext. Mitgemessen, um es auszuschliessen.
--
-- SIE SCHREIBT NICHTS. Kein `update`, kein `insert`, kein `delete`, und sie
-- ruft `admin_merge_draft` NICHT auf. `admin_merge_plan` ist `stable`.
-- ===========================================================================

with ziel as (
  select * from public.skylanders where sky_id = 'SKY-0103'
),
entwurf as (
  select * from public.skylanders where sky_id = 'SKY-0824'
),
fassungen as (
  select p.oid, p.pronargs, p.pronargdefaults, p.prosecdef, p.provolatile,
         pg_get_function_identity_arguments(p.oid) as sig,
         pg_get_function_arguments(p.oid)          as sig_mit_vorgaben
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_merge_draft'
),
pruef (nr, bereich, pruefung, befund) as (values
  -- ------------------------------------- 1. Ist schon etwas geschehen?
  (101, 'Zustand', 'SKY-0103 steht',
      (select count(*)::text from ziel)),
  (102, 'Zustand', 'SKY-0103 Name — erwartet unveraendert "Pirate Ship"',
      (select coalesce(max(name), '(fehlt)') from ziel)),
  (103, 'Zustand', 'SKY-0103 Status | sichtbar | Serie | Kategorie',
      (select coalesce(max(catalog_status || ' | ' || catalog_visible::text
                       || ' | ' || series_code || ' | ' || category_id::text), '(fehlt)')
         from ziel)),
  (104, 'Zustand', 'SKY-0103 Bild (override | Altimport)',
      (select coalesce(max(coalesce(image_override_path, '-') || ' | '
                       || coalesce(image_file, '-')), '(fehlt)') from ziel)),
  (105, 'Zustand', 'SKY-0824 steht noch — 1 heisst: nichts geloescht',
      (select count(*)::text from entwurf)),
  (106, 'Zustand', 'SKY-0824 Name | Status | Herkunft',
      (select coalesce(max(name || ' | ' || catalog_status || ' | ' || source), '(fehlt)')
         from entwurf)),
  (107, 'Zustand', 'SKY-0824 Bild',
      (select coalesce(max(coalesce(image_override_path, '-')), '(fehlt)') from entwurf)),
  /*
   * DER AUSSCHLAGGEBENDE: hat jemand an SKY-0103 schon geschrieben? Das
   * Journal aus `0004`/`0152` fuehrt jede Aenderung mit Zeitstempel. Eine
   * Zeile `merged_from` hiesse, die Funktion ist durchgelaufen.
   */
  /*
   * EINGEKAPSELT, WEIL DER PRUEFZUGANG DAS JOURNAL NICHT LESEN DARF
   * (ADR-0141). Direkt gelesen bricht die GANZE Datei mit
   * "permission denied" ab — und dann sagt die Diagnose nichts, obwohl
   * sechzehn andere Zeilen lesbar waeren. Genau das ist beim ersten Lauf
   * passiert.
   */
  (108, 'Zustand', 'Journalzeilen zu SKY-0103/SKY-0824 — merged_from waere ein Lauf',
      case when has_table_privilege('public.catalog_admin_changes', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 $q$select coalesce(string_agg(field || ':' || to_char(changed_at, 'MM-DD HH24:MI'), ', ' order by changed_at desc), '(keine)') as c from public.catalog_admin_changes where entity_id in ('SKY-0103', 'SKY-0824')$q$,
                 false, true, '')))[1]::text, '(keine)')
           else 'KEIN-RECHT' end),

  -- -------------------------------- 2. Die RPC-Aufloesung (Hauptverdacht)
  (111, 'RPC', 'Fassungen von admin_merge_draft',
      (select count(*)::text from fassungen)),
  (112, 'RPC', 'ihre Signaturen',
      (select coalesce(string_agg(sig, '  ||  ' order by pronargs), '(keine)')
         from fassungen)),
  /*
   * DIE ENTSCHEIDENDE ZEILE. PostgREST waehlt unter ueberladenen Funktionen
   * anhand der Schluessel im JSON-Rumpf. Eine Fassung MIT Vorgabewerten
   * deckt mehrere Parameterzahlen ab; wenn beide Fassungen fuer denselben
   * Rumpf in Frage kommen, antwortet PostgREST `PGRST203` („could not
   * choose the best candidate function") statt zu waehlen.
   */
  (113, 'RPC', 'Parameterzahl : davon mit Vorgabewert',
      (select coalesce(string_agg(pronargs::text || ':' || pronargdefaults::text,
                                  '  ||  ' order by pronargs), '(keine)')
         from fassungen)),
  (114, 'RPC', 'Signaturen MIT Vorgabewerten — hier steht das DEFAULT',
      (select coalesce(string_agg(sig_mit_vorgaben, '  ||  ' order by pronargs), '(keine)')
         from fassungen)),
  (115, 'RPC', 'admin_merge_plan(text,text,text) steht',
      (to_regprocedure('public.admin_merge_plan(text,text,text)') is not null)::text),
  (116, 'RPC', 'die Vierparameterfassung steht',
      (to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)') is not null)::text),

  -- ------------------------------------------------------- 3. Die Rechte
  (121, 'Rechte', 'EXECUTE fuer authenticated, je Fassung',
      (select coalesce(string_agg(f.pronargs::text || ':' || a.grantee::regrole::text,
                                  ', ' order by f.pronargs), '(keines)')
         from fassungen f, aclexplode((select p.proacl from pg_proc p where p.oid = f.oid)) a
        where a.privilege_type = 'EXECUTE'
          and a.grantee::regrole::text = 'authenticated')),
  (122, 'Rechte', 'offene EXECUTE-Rechte (anon/public) — muss 0 sein',
      (select count(*)::text
         from fassungen f, aclexplode((select p.proacl from pg_proc p where p.oid = f.oid)) a
        where a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public')))),
  (123, 'Rechte', 'beide security definer',
      (select coalesce(string_agg(prosecdef::text, ', ' order by pronargs), '(keine)')
         from fassungen)),
  (124, 'Rechte', 'is_platform_admin() steht',
      (to_regprocedure('public.is_platform_admin()') is not null)::text),

  -- --------------------------------------------------------- 4. Der Plan
  /*
   * WAS DER SERVER RECHNET. `admin_merge_plan` ist `stable` und schreibt
   * nicht. Sie verlangt allerdings `is_platform_admin()`; der lesende
   * Pruefzugang ist kein Admin, der Aufruf scheitert also mit `42501`.
   * Deshalb wird der Plan hier NICHT aufgerufen, sondern seine Eingaben
   * werden nebeneinandergelegt — Spalte fuer Spalte, genau die neun Felder
   * der Allowlist.
   */
  (131, 'Plan', 'name:        Ziel  ->  Entwurf',
      (select coalesce((select name from ziel), '-') || '  ->  '
           || coalesce((select name from entwurf), '-'))),
  (132, 'Plan', 'display_name_override',
      (select coalesce((select display_name_override from ziel), '-') || '  ->  '
           || coalesce((select display_name_override from entwurf), '-'))),
  (133, 'Plan', 'series_code / category_id',
      (select coalesce((select series_code || '/' || category_id::text from ziel), '-')
           || '  ->  '
           || coalesce((select series_code || '/' || category_id::text from entwurf), '-'))),
  (134, 'Plan', 'card_type',
      (select coalesce((select card_type from ziel), '-') || '  ->  '
           || coalesce((select card_type from entwurf), '-'))),
  (135, 'Plan', 'item_type',
      (select coalesce((select item_type from ziel), '-') || '  ->  '
           || coalesce((select item_type from entwurf), '-'))),
  (136, 'Plan', 'character_id',
      (select coalesce((select character_id::text from ziel), '-') || '  ->  '
           || coalesce((select character_id::text from entwurf), '-'))),
  (137, 'Plan', 'image_override_path',
      (select coalesce((select image_override_path from ziel), '-') || '  ->  '
           || coalesce((select image_override_path from entwurf), '-'))),
  (138, 'Plan', 'admin_note (Laenge Ziel | Laenge Entwurf)',
      case when has_table_privilege('public.catalog_editorial', 'select')
             then (xpath('/row/c/text()', query_to_xml(
                 'select coalesce((select length(admin_note) from public.catalog_editorial '
                 'where sky_id = ''SKY-0103''), -1)::text || '' | '' || '
                 'coalesce((select length(admin_note) from public.catalog_editorial '
                 'where sky_id = ''SKY-0824''), -1)::text as c',
                 false, true, '')))[1]::text
           else 'KEIN-RECHT' end),
  (139, 'Plan', 'Info: wie viele Felder der Plan also nennen wuerde (ohne Notiz)',
      (select count(*)::text from (
        select 1 where (select name from ziel) is distinct from (select name from entwurf)
        union all select 1 where (select display_name_override from ziel)
                                   is distinct from (select display_name_override from entwurf)
                              and (select display_name_override from entwurf) is not null
        union all select 1 where (select series_code from ziel)
                                   is distinct from (select series_code from entwurf)
        union all select 1 where (select card_type from ziel)
                                   is distinct from (select card_type from entwurf)
        union all select 1 where (select item_type from ziel)
                                   is distinct from (select item_type from entwurf)
        union all select 1 where (select character_id from ziel)
                                   is distinct from (select character_id from entwurf)
                              and (select character_id from entwurf) is not null
      ) x)),

  -- ---------------------------------------------------- 5. Die Referenzen
  (141, 'Verweise', 'Sammlungszeilen auf SKY-0824',
      (select count(*)::text from public.collection_items where sky_id = 'SKY-0824')),
  (142, 'Verweise', 'Lagerzeilen auf SKY-0824',
      (select count(*)::text from public.shop_inventory where sky_id = 'SKY-0824')),
  (143, 'Verweise', 'Sammlungszeilen auf SKY-0103 — die muessen ERHALTEN bleiben',
      (select count(*)::text from public.collection_items where sky_id = 'SKY-0103')),
  (144, 'Verweise', 'Lagerzeilen auf SKY-0103',
      (select count(*)::text from public.shop_inventory where sky_id = 'SKY-0103'))
)
select nr, bereich, pruefung, befund, null::text as erwartet, null::boolean as ok
  from pruef
 order by nr;
