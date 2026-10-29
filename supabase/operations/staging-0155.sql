-- ===========================================================================
-- STAGING — EIN LAUF FUER 0155
--            (einen importierten Entwurf verwerfen)
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
--
-- *** SIE LEGT EINE FUNKTION AN UND LOESCHT NICHTS ***
--
-- `admin_discard_draft()` entsteht; angewendet wird sie erst, wenn jemand im
-- Adminbereich auf den Papierkorb klickt und bestaetigt. Der Katalog sieht
-- nach diesem Lauf aus wie vorher.
--
-- *** SIE SETZT 0154 VORAUS ***
--
-- Die Referenzpruefung kommt aus `admin_merge_references()`. Es soll sie
-- genau EINMAL geben — eine zweite Fassung derselben Regel waere bei einer
-- Loeschung die teuerste Sorte Fehler.
--
-- ERWARTET: die NOTICE-Zeile der Migration und `commit`.
-- ===========================================================================

begin;

do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) <> 2 then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden. Diese Datei '
      'laeuft nur auf Staging qqxcpesbwfxzgytkdsac.';
  end if;

  if to_regprocedure('public.admin_merge_references(text)') is null then
    raise exception 'ABBRUCH A2: admin_merge_references() fehlt — 0154 ist hier '
      'nicht angewendet. 0155 benutzt sie fuer die Referenzpruefung.';
  end if;

  if not exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('public.skylanders')
                    and a.attname = 'catalog_status' and not a.attisdropped) then
    raise exception 'ABBRUCH A3: skylanders.catalog_status fehlt (0152).';
  end if;

  if to_regclass('public.catalog_admin_changes') is null then
    raise exception 'ABBRUCH A4: catalog_admin_changes fehlt (0004) — der '
      'dritte Riegel liest das Journal.';
  end if;

  if to_regprocedure('public.admin_discard_draft(text)') is not null then
    raise notice 'A5: admin_discard_draft steht schon — dieser Lauf ersetzt sie '
      'durch dieselbe Fassung.';
  end if;
end
$lauf_a$;

-- >>> EINGEBETTET: supabase/migrations/0155_discard_draft.sql
-- ---------------------------------------------------------------------------
-- 0155 — einen importierten Entwurf verwerfen
--
-- CAT-05D. Der Adminbereich bekommt drei Handlungen je Zeile: zusammenführen,
-- bearbeiten, **verwerfen**. Die ersten beiden gibt es; diese Datei liefert
-- die dritte.
--
-- *** NUR EIN IMPORTIERTER ENTWURF, UND NUR OHNE VERWEISE ***
--
-- Sie löscht eine Zeile, und das ist die einzige Stelle im Produkt, an der
-- ein Katalogeintrag wirklich verschwindet — der Import deaktiviert sonst
-- über `is_active`, statt zu löschen (`0001`). Deshalb drei Riegel:
--
--   1. `catalog_status = 'draft'` — eine öffentliche oder versteckte Figur
--      wird NIE gelöscht, auch nicht auf ausdrückliche Anweisung.
--   2. `source = 'admin'` — nur selbst angelegte Zeilen. Was der
--      Katalogimport besitzt, gehört ihm.
--   3. sie stand nie öffentlich — das Journal aus `0152` weiß es. Eine
--      Zeile, die einmal live war, wird versteckt und nicht vernichtet.
--   4. keine Verweise — `admin_merge_references()` aus `0154` zählt sie,
--      hergeleitet aus `pg_catalog` statt aus einer getippten Liste.
--
-- *** WAS DIESE VIER ZUSAMMEN BEDEUTEN ***
--
-- Am 2026-10-28 auf Staging gemessen: 128 Zeilen tragen `source = admin`,
-- davon sind **105 Entwürfe — genau die importierten** —, und die übrigen 23
-- sind öffentlich. Die Funktion trifft heute also exakt den Import. Sie ist
-- trotzdem nicht darauf festgeschrieben: eine später von Hand angelegte
-- Figur, die niemand benutzt und die nie öffentlich war, darf ebenso
-- verschwinden. Das ist die Regel — „ein Entwurf, auf den nichts zeigt und
-- der nie live war" —, und sie ist nachprüfbar, während eine Festlegung auf
-- die 105 an einer bearbeitbaren Notiz hinge.
--
-- *** SIE SETZT `0154` VORAUS ***
--
-- Nicht aus Bequemlichkeit: die Referenzprüfung soll es GENAU EINMAL geben.
-- Eine zweite Fassung derselben Regel wäre eine zweite Wahrheit, und bei
-- einer Löschung ist das die teuerste Sorte Fehler.
--
-- *** DAS BILD BLEIBT LIEGEN, UND DAS IST ABSICHT ***
--
-- Hat der Entwurf ein `image_override_path`, zeigt es auf ein Objekt im
-- Bucket `catalog`. Diese Funktion löscht es NICHT: SQL erreicht den Storage
-- nicht, und ein Löschen über zwei Systeme wäre nicht mehr eine Transaktion.
-- Das verwaiste Objekt kostet ein paar Kilobyte und schadet niemandem; es
-- still zu entfernen wäre der größere Eingriff. Der Rückgabewert NENNT den
-- Pfad, damit ein Mensch entscheiden kann.
--
-- DIE SKY-ID WIRD NICHT WIEDERVERWENDET. `sky_id_seq` läuft weiter; eine
-- gelöschte Zeile hinterlässt eine Lücke, und das ist ausdrücklich so
-- gewollt (ADR-0070).
--
-- KEINE EIGENE TRANSAKTIONSKLAMMER — die setzt die Einfüge-Hülle.
-- ---------------------------------------------------------------------------

create or replace function public.admin_discard_draft(p_draft text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.skylanders%rowtype;
  v_refs  integer := 0;
  v_liste text    := '';
  r       record;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_row from public.skylanders where sky_id = p_draft for update;
  if not found then
    raise exception '0155: % gibt es nicht', p_draft;
  end if;

  -- ---- Riegel 1: nur Entwürfe.
  if v_row.catalog_status <> 'draft' then
    raise exception '0155: % ist kein Entwurf (Status %) — oeffentliche und '
      'versteckte Figuren werden nicht geloescht', p_draft, v_row.catalog_status;
  end if;

  -- ---- Riegel 2: nur selbst angelegte Zeilen.
  if v_row.source <> 'admin' then
    raise exception '0155: % traegt source=% — was der Katalogimport besitzt, '
      'wird ueber is_active deaktiviert und nicht geloescht', p_draft, v_row.source;
  end if;

  -- ---- Riegel 3: war die Zeile schon einmal öffentlich?
  --
  -- WARUM DAS EIN EIGENER RIEGEL IST. Die ersten beiden fragen, WAS die
  -- Zeile heute ist; dieser fragt, was sie einmal WAR. Eine Figur, die
  -- öffentlich stand, kann verlinkt, zwischengespeichert oder in einer
  -- Bestellung aufgetaucht sein — auch wenn heute nichts mehr auf sie zeigt.
  -- Wer sie wieder auf `draft` gesetzt hat, wollte sie verbergen und nicht
  -- vernichten.
  --
  -- Das Journal weiß es: `0152` schreibt jeden Statuswechsel mit. Die 105
  -- importierten Entwürfe entstanden ALS Entwurf und haben keine solche
  -- Zeile — für sie ändert dieser Riegel nichts.
  if exists (select 1 from public.catalog_admin_changes c
              where c.entity = 'skylander' and c.entity_id = p_draft
                and c.field = 'catalog_status' and c.old_value = 'public') then
    raise exception '0155: % stand schon einmal oeffentlich — eine Zeile mit '
      'Vergangenheit wird nicht geloescht, sondern versteckt', p_draft;
  end if;

  -- ---- Riegel 4: keine Verweise. Dieselbe Zählung wie bei der Zusammenführung.
  for r in select * from public.admin_merge_references(p_draft) loop
    v_refs := v_refs + 1;
    v_liste := v_liste || r.tabelle || ' (' || r.zeilen || ') ';
  end loop;
  if v_refs > 0 then
    raise exception '0155: auf % zeigen noch Daten: % — der Entwurf wird nicht '
      'geloescht. Erst klaeren, was damit geschehen soll.', p_draft, v_liste;
  end if;

  -- ---- Erst ins Journal, dann weg. Die Zeile ueberlebt die Figur.
  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', p_draft, 'discarded', v_row.name, null, (select auth.uid()));

  delete from public.catalog_editorial where sky_id = p_draft;
  delete from public.skylanders where sky_id = p_draft;

  return jsonb_build_object(
    'sky_id', p_draft,
    'name', v_row.name,
    'deleted', true,
    -- DER VERWAISTE PFAD, benannt statt still gelassen.
    'orphaned_image', v_row.image_override_path);
end;
$$;

comment on function public.admin_discard_draft(text) is
  'Deletes ONE imported draft (0155, CAT-05D). Four locks: catalog_status must be draft, source must be admin, the row must never have been public (the 0152 journal knows), and nothing may reference it (admin_merge_references from 0154, derived from pg_catalog). Writes a journal row before deleting, so the act outlives the figure. Does NOT touch storage: the image object stays and is named in the result, because SQL cannot reach the bucket and a two-system delete would stop being one transaction. The SKY-ID is never reused (ADR-0070). Platform admins only.';

revoke all on function public.admin_discard_draft(text) from public, anon;
grant execute on function public.admin_discard_draft(text) to authenticated;


-- ---------------------------------------------------------------------------
-- Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_offen integer;
begin
  if to_regprocedure('public.admin_merge_references(text)') is null then
    raise exception '0155 setzt 0154 voraus: admin_merge_references() fehlt';
  end if;
  if to_regprocedure('public.admin_discard_draft(text)') is null then
    raise exception '0155 Nachbedingung: admin_discard_draft fehlt';
  end if;

  select count(*) into v_offen
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid = to_regprocedure('public.admin_discard_draft(text)')
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
  if v_offen <> 0 then
    raise exception '0155 Nachbedingung: % offene EXECUTE-Rechte', v_offen;
  end if;

  raise notice '0155: admin_discard_draft steht, nur fuer authenticated, '
    'vier Riegel im Rumpf, Storage unberuehrt.';
end
$nach$;
-- <<< ENDE: supabase/migrations/0155_discard_draft.sql

commit;
