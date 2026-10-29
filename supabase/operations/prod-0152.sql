-- ========================================================================
-- PRODUCTION — GRUPPE G2: EIN LAUF FUER 0152
--              (der Katalog bekommt einen redaktionellen Status)
--
-- ###########################################################################
-- ##  DIES IST EINE PRODUCTION-DATEI. Projekt zmiwxswrpkmizvqsgype.        ##
-- ##  Sie bricht auf Staging ab, und zwar bevor sie etwas anfasst.         ##
-- ###########################################################################
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Production-Projekts zmiwxswrpkmizvqsgype einfuegen,
-- ausfuehren. Nichts in Teilen.
--
-- DIESE MIGRATION IST DIE RISKANTESTE DES RESTS, UND ZWAR AUS DREI GRUENDEN:
--
--   1. Sie schreibt in JEDE der 624 Katalogzeilen (Backfill von
--      `catalog_status` aus `catalog_visible`).
--   2. Sie ERSETZT `log_skylander_editorial_change()` — die
--      AFTER-Triggerfunktion aus `0004`, durch die jeder Katalogschreibvorgang
--      laeuft. Ein Fehler darin betrifft nicht eine Funktion, sondern alle.
--   3. Sie legt einen neuen BEFORE-Trigger an `skylanders` an.
--
-- Deshalb traegt diese Huelle VIER Abschnitte Absicherung statt zwei, und
-- jeder davon kann zurueckrollen:
--
--   A4  Shop- und Sammlungsvertrag, selbst gemessen (wie prod-0149)
--   A5  der SICHTBARKEITS-ABDRUCK aller Katalogzeilen plus die zwei Zahlen,
--       aus denen der Backfill ableitet
--   A6  die beiden zu ersetzenden Ruempfe, VORHER auf ihre Eigenschaften
--       geprueft — die Migration selbst tut das nicht
--   A7  die Triggerliste an `skylanders`, vorher benannt
--
--   B   alles davon noch einmal, Vergleich, und `raise exception` bei jeder
--       Abweichung: B3 Shop, B4 Sammlung, B5 Sichtbarkeit, B6/B7 Backfill
--       trifft genau die zwei Zahlen, B8 kein Entwurf, B9 genau ein Trigger
--       mehr.
--
-- WAS 0152 FACHLICH TUT: `catalog_status` mit drei Werten (public, hidden,
-- draft), zwei CHECKs (bekannter Wert; und `(status = 'public') =
-- catalog_visible` — die beiden koennen nie auseinanderlaufen), der
-- BEFORE-Trigger `skylanders_sync_catalog_status`, der jedem bestehenden
-- Schreibpfad die andere Spalte ableitet, die neue Funktion
-- `admin_set_catalog_status(text,text)` (nur `authenticated`, kein `anon`),
-- und die zwei ersetzten Ruempfe.
--
-- WAS SIE NICHT ANFASST: keine RLS-Politik — `skylanders_select_anon` und
-- `skylanders_select_authenticated` lesen weiter `is_active and
-- catalog_visible`; keinen Index; keine Sicht; kein `shop_offers()`; keine
-- SKY-ID; keine Sammlungs-, Favoriten-, Lager- oder Angebotsbeziehung. Und
-- `admin_set_catalog_visible(text,boolean)` bleibt stehen.
--
-- RUECKWAERTSKOMPATIBILITAET VON `admin_create_figure`: die Signatur ist
-- ZEICHENGLEICH die aus `0034` — acht Parameter, dieselben Namen, dieselbe
-- Reihenfolge, dieselben Vorgabewerte (mechanisch verglichen). PostgREST
-- loest ueber Namen auf; der deployte Anwendungscode ruft sie unveraendert.
-- A6d/A6e stellen vorher sicher, dass es GENAU EINE Fassung mit dieser
-- Signatur gibt — sonst waere die Ersetzung eine Ueberladung.
--
-- RUECKNAHME: `supabase/rollback/R0152_drop_catalog_status.sql`.
--
-- VOR DEM LAUF `prod-s-preflight-0152.sql`, DANACH
-- `prod-s-postflight-0152.sql`.
--
-- ERWARTETES ERGEBNIS: die `NOTICE`-Zeilen der Migration und des Abschnitts
-- B, und `commit`.
-- ========================================================================

begin;

do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) = 2 then
    raise exception 'ABBRUCH A1: das vollstaendige STAGING-Markerpaar ist da '
      '(SKY-0821 UND SKY-0822). Diese Datei ist fuer Production '
      '(zmiwxswrpkmizvqsgype) — auf Staging gehoert '
      'supabase/operations/staging-0152.sql.';
  end if;

  if to_regprocedure('public.purchases_paid_total_is_final()') is null then
    raise exception 'ABBRUCH A2: 0133 ist hier nicht angewendet. Auf Production ist '
      'sie es seit dem 2026-10-18; diese Datenbank ist also nicht Production.';
  end if;

  if (select count(*) from public.skylanders) < 100 then
    raise exception 'ABBRUCH A3: der Katalog hat weniger als 100 Zeilen — das ist '
      'kein Production-Projekt.';
  end if;
end
$lauf_a$;

-- ---------------------------------------------------------------------------
-- A4  DIE BEIDEN VERTRAEGE, VON DER HUELLE SELBST GEMESSEN
--
-- KEIN PLATZHALTER, KEIN KOPIEREN — wie in `prod-0149.sql`. Die Messung ist
-- zeichengleich die der Pruefdateien; abgelegt wird transaktionslokal.
-- ---------------------------------------------------------------------------
select set_config('skyisles.base', (
with sammelbar as (
  select s.sky_id
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active and s.catalog_visible
     and not (c.name = any (public.non_collectible_categories()))
),
basis_mess as (
  -- Die sieben Zahlen, einmal gerechnet, hier und in Zeile 900 benutzt.
  select
    /*
     * DIE ZWEI FELDER, DIE `shop_offers()` BRAUCHEN — und das ist die einzige
     * Stelle des Basis-Vertrags, an der ein Recht fehlen kann.
     *
     * Fehlt `execute`, steht hier `KEIN-RECHT`: die Zeilen 811 und 812 sind
     * dann OFFEN (Zeile 9998 zaehlt sie), die uebrigen fuenf Felder werden
     * weiter gemessen und verglichen. Ein fehlendes Recht nimmt also nicht
     * die ganze Baseline mit — aber es wird auch nicht stillschweigend
     * uebergangen.
     */
    case when has_function_privilege('public.shop_offers()', 'execute')
         then (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from public.shop_offers()',
             false, true, '')))[1]::text
         else 'KEIN-RECHT' end as angebote,
    case when has_function_privilege('public.shop_offers()', 'execute')
         then (xpath('/row/c/text()', query_to_xml(
             'select md5(coalesce(string_agg(o.sky_id || ''|'' || o.condition || ''|'' '
             '|| coalesce(o.price::text, ''''), '
             ''';'' order by o.sky_id, o.condition), '''')) as c '
             'from public.shop_offers() o',
             false, true, '')))[1]::text
         else 'KEIN-RECHT' end as angebote_md5,
    (select count(*)::text from public.skylanders s
      where public.is_shop_eligible(s.sky_id))                             as shopfaehig,
    (select count(*)::text from sammelbar)                                 as sammelbar,
    (select count(*)::text from public.shop_inventory)                     as lagerzeilen,
    (select count(*)::text from public.skylanders)                         as katalogzeilen,
    (select coalesce(md5(string_agg(i.id::text || '|' || i.is_listed::text || '|'
                                    || coalesce(i.sale_price::text, '-') || '|'
                                    || i.sale_released::text,
                                    E'\n' order by i.id)), '(leer)')
       from public.shop_inventory i)                                       as lager_md5
),
basis_feld as (
  select angebote || '|' || angebote_md5 || '|' || shopfaehig || '|' || sammelbar
         || '|' || lagerzeilen || '|' || katalogzeilen || '|' || lager_md5 as kern,
         m.*
    from basis_mess m
),
basis_zeile as (
  select 'skyisles-base-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from basis_feld f
)
select zeile from basis_zeile
), true);

select set_config('skyisles.coll', (
with coll_mess as (
  -- Die drei Zahlen der Sammlung, einmal gerechnet.
  select
    (select count(*)::text from public.collection_items)                   as zeilen,
    (select count(distinct user_id)::text from public.collection_items)    as konten,
    (select coalesce(md5(string_agg(ci.user_id::text || '|' || ci.sky_id || '|'
                                    || ci.quantity::text,
                                    E'\n' order by ci.user_id, ci.sky_id)), '(leer)')
       from public.collection_items ci)                                    as sammlung_md5
),
coll_feld as (
  select zeilen || '|' || konten || '|' || sammlung_md5 as kern, m.*
    from coll_mess m
),
coll_zeile as (
  select 'skyisles-coll-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from coll_feld f
)
select zeile from coll_zeile
), true);

-- ---------------------------------------------------------------------------
-- A5  DER SICHTBARKEITS-ABDRUCK ALLER KATALOGZEILEN
--
-- DIE ZENTRALE ZUSAGE DIESER MIGRATION, und hier wird sie einklagbar: `0152`
-- schreibt in JEDE Katalogzeile (`update … set catalog_status = case when
-- catalog_visible then 'public' else 'hidden' end`). Was sich dabei NICHT
-- bewegen darf, ist die Sichtbarkeit selbst — denn an ihr haengen RLS, der
-- Teilindex, `shop_offers()` und der Fortschrittsnenner.
--
-- Abschnitt B rechnet denselben Abdruck noch einmal und bricht ab, wenn er
-- sich bewegt hat. Dazu die zwei Zahlen, aus denen der Backfill seine Werte
-- ableitet: sichtbar -> 'public', unsichtbar -> 'hidden'. B prueft, dass die
-- Statusverteilung GENAU diese zwei Zahlen trifft und keine Zeile 'draft'
-- geworden ist.
-- ---------------------------------------------------------------------------
select set_config('skyisles.sicht', (
  select coalesce(md5(string_agg(s.sky_id || '|' || s.catalog_visible::text, E'\n'
                                 order by s.sky_id)), '(leer)')
    from public.skylanders s
), true);

select set_config('skyisles.sichtbar', (
  select count(*)::text from public.skylanders where catalog_visible
), true);

select set_config('skyisles.unsichtbar', (
  select count(*)::text from public.skylanders where not catalog_visible
), true);

-- ---------------------------------------------------------------------------
-- A6  DIE ZWEI RUEMPFE, DIE ERSETZT WERDEN — VORHER ANGESEHEN
--
-- `0152` ersetzt `log_skylander_editorial_change()` (die AFTER-Triggerfunktion
-- aus `0004`, durch die JEDER Katalogschreibvorgang laeuft) und
-- `admin_create_figure(...)` mit `create or replace`. Die Migration selbst
-- prueft den vorgefundenen Rumpf NICHT — auf Staging war das unkritisch, auf
-- Production ist es eine Luecke: eine fremde Fassung wuerde stillschweigend
-- ueberschrieben.
--
-- Dieser Abschnitt schliesst sie, und zwar umgebungsunabhaengig: er fragt
-- nicht nach einem Abdruck (der waere eine Konstante von vorgestern), sondern
-- nach den EIGENSCHAFTEN, die die erwartete Fassung haben MUSS.
-- ---------------------------------------------------------------------------
do $lauf_a6$
declare
  v_journal text;
  v_create  text;
  v_n       integer;
begin
  select p.prosrc into v_journal from pg_proc p
    where p.oid = to_regprocedure('public.log_skylander_editorial_change()');
  if v_journal is null then
    raise exception 'ABBRUCH A6a: log_skylander_editorial_change() fehlt — '
      'das ist nicht die Datenbank, fuer die 0152 geschrieben ist (0004).';
  end if;
  if v_journal like '%catalog_status%' then
    raise exception 'ABBRUCH A6b: log_skylander_editorial_change() kennt '
      'catalog_status schon. Entweder liegt 0152 bereits, oder hier steht eine '
      'fremde Fassung — in beiden Faellen wird sie nicht ueberschrieben.';
  end if;
  if v_journal not like '%catalog_visible%'
     or v_journal not like '%display_name_override%'
     or v_journal not like '%card_type%'
     or v_journal not like '%image_override_path%' then
    raise exception 'ABBRUCH A6c: der vorgefundene Journalrumpf nennt nicht die '
      'vier erwarteten Felder (catalog_visible, display_name_override, '
      'card_type, image_override_path — die Fassung aus 0004, erweitert in '
      '0007 und 0033). Er wird nicht ueberschrieben.';
  end if;

  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_create_figure';
  if v_n <> 1 then
    raise exception 'ABBRUCH A6d: % Fassung(en) von admin_create_figure — '
      'erwartet genau eine. Eine Ueberladung waere nach der Ersetzung eine '
      'zweite Funktion mit demselben Namen.', v_n;
  end if;
  select p.prosrc into v_create from pg_proc p
    where p.oid = to_regprocedure('public.admin_create_figure(text,text,bigint,text,boolean,text,text,text)');
  if v_create is null then
    raise exception 'ABBRUCH A6e: admin_create_figure gibt es nicht mit der '
      'erwarteten Signatur aus 0034 (acht Parameter). Die Ersetzung wuerde eine '
      'Ueberladung anlegen statt zu ersetzen.';
  end if;
  if v_create like '%catalog_status%' then
    raise exception 'ABBRUCH A6f: admin_create_figure kennt catalog_status schon.';
  end if;
end
$lauf_a6$;

-- ---------------------------------------------------------------------------
-- A7  DIE TRIGGER AN `skylanders`, VORHER GEZAEHLT UND BENANNT
--
-- `0152` legt GENAU EINEN neuen Trigger an. B prueft, dass es genau einer
-- mehr ist und dass kein bestehender verschwunden oder umbenannt wurde.
-- ---------------------------------------------------------------------------
select set_config('skyisles.trigger', (
  select coalesce(string_agg(t.tgname, ',' order by t.tgname), '(keine)')
    from pg_trigger t
   where t.tgrelid = to_regclass('public.skylanders') and not t.tgisinternal
), true);

-- >>> EINGEBETTET: supabase/migrations/0152_catalog_status.sql
-- ===========================================================================
-- 0152 — KATALOGSTATUS: OEFFENTLICH · VERSTECKT · ENTWURF (ADR-0151, CAT-02B)
--
-- ###########################################################################
-- ##  NICHT ANGEWENDET — weder auf Staging noch auf Production.            ##
-- ##  Braucht eine eigene Freigabe des Betreibers.                         ##
-- ###########################################################################
--
-- WOFUER. Der Katalog kennt heute zwei redaktionelle Zustaende:
-- `catalog_visible` true oder false. Der Betrieb braucht einen dritten —
-- „Entwurf" —, damit ein neu angelegter oder spaeter importierter Eintrag
-- sagen kann „noch nicht fertig" statt „zurueckgezogen". Beide sind nicht
-- oeffentlich; sie unterscheiden sich in der ABSICHT, nicht im Verhalten.
--
-- WAS DIESE MIGRATION NICHT ANFASST, und das ist ihr Zuschnitt:
--
--   * keine RLS-Politik. `skylanders_select_anon` und
--     `skylanders_select_authenticated` lesen weiter `is_active and
--     catalog_visible`, und `catalog_visible` behaelt genau seine Bedeutung.
--   * keinen Index. `skylanders_public_catalog_idx` bleibt.
--   * keine Sicht, kein `shop_offers()`.
--   * keine SKY-ID, keine Sammlungs-, Favoriten-, Lager- oder
--     Angebotsbeziehung.
--
-- Nach dieser Migration hat jede der bestehenden Zeilen genau den Status, den
-- ihr `catalog_visible` heute schon bedeutet. **Kein bestehender Eintrag wird
-- zum Entwurf.**
--
-- ---------------------------------------------------------------------------
-- WARUM EIN TRIGGER UND NICHT NUR EIN CHECK
-- ---------------------------------------------------------------------------
--
-- Der naheliegende Entwurf waere eine Spalte plus
--
--     check ((catalog_status = 'public') = catalog_visible)
--
-- und er haette DREI bestehende Schreibpfade zerbrochen — nachgezaehlt, nicht
-- vermutet:
--
--   admin_set_catalog_visible    `update … set catalog_visible = p_visible`
--                                schreibt den Status nicht mit → CHECK verletzt
--   admin_create_figure          `insert … catalog_visible = false` ohne Status
--                                → Vorgabewert waere 'public' → CHECK verletzt
--   seller_create_catalog_item   dasselbe, aus dem Einkaufsbuch (0137)
--
-- Der Trigger dreht das um: **wer nur eine der beiden Spalten schreibt,
-- bekommt die andere abgeleitet.** Damit funktioniert jeder bestehende
-- Schreibpfad unveraendert weiter, und der CHECK ist trotzdem da — als
-- Beweis, dass die beiden nie auseinanderlaufen koennen. Erst der Trigger
-- macht die Zusage einhaltbar, erst der CHECK macht sie nachweisbar.
--
-- DAS MUSTER IST NICHT NEU. `0135` leitet `skylanders.item_type` mit einem
-- BEFORE-Trigger aus der Kategorie ab, und `0001` schuetzt die SKY-ID mit
-- einem. Ein dritter Trigger derselben Art ist keine neue Bauart.
--
-- REIHENFOLGE DER TRIGGER: der neue ist BEFORE, das Journal
-- (`skylanders_log_editorial`, 0004) ist AFTER. Das Journal sieht also die
-- bereits korrigierten Werte, und ein Statuswechsel steht mit seinem
-- richtigen alten und neuen Wert darin.
--
-- KEINE SPALTENVORGABE, UND DAS IST ABSICHT. `catalog_status` hat **keinen**
-- DEFAULT: NULL beim INSERT ist das Signal „der Aufrufer hat nichts gesagt",
-- und genau dann leitet der Trigger aus `catalog_visible` ab. Ein Vorgabewert
-- 'public' wuerde `seller_create_catalog_item` widersprechen, das
-- ausdruecklich `catalog_visible = false` schreibt.
--
-- KEINE EIGENE TRANSAKTIONSKLAMMER, und das ist die Hausform dieses
-- Projekts (wie `0150` und `0151`): die Klammer setzt die Einfuege-Huelle
-- `supabase/operations/staging-0152.sql`, weil ihre Umgebungs- und
-- Zustandswaechter MIT in dieselbe Transaktion gehoeren. Eine Klammer hier
-- waere eine zweite — das innere `commit` wuerde die aeussere Transaktion
-- vorzeitig abschliessen und die Waechter wirkungslos machen.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Die Spalte, noch ohne Zwang
--
-- Nullable und ohne Vorgabewert, damit der Backfill und der Trigger darunter
-- arbeiten koennen. `set not null` folgt in Abschnitt 3 — BEFORE-Trigger
-- laufen vor der Constraint-Pruefung, ein INSERT ohne Status bleibt also auch
-- danach gueltig.
-- ---------------------------------------------------------------------------
alter table public.skylanders
  add column catalog_status text;

comment on column public.skylanders.catalog_status is
  'Editorial status (CAT-02B, ADR-0151): public, hidden or draft. public and hidden mean exactly what catalog_visible meant; draft is the third state for an entry that has never been released. hidden and draft are behaviourally identical - neither is public - and differ in intent only. Admin-owned: no import writes it. catalog_visible stays the machine-readable visibility that RLS, the partial index and shop_offers() read; a trigger keeps the two in step and a CHECK proves they are.';


-- ---------------------------------------------------------------------------
-- 2. Backfill — kein Eintrag wird zum Entwurf
-- ---------------------------------------------------------------------------
update public.skylanders
   set catalog_status = case when catalog_visible then 'public' else 'hidden' end;


-- ---------------------------------------------------------------------------
-- 3. Der Zwang: bekannter Wert, und nie im Widerspruch zur Sichtbarkeit
-- ---------------------------------------------------------------------------
alter table public.skylanders
  alter column catalog_status set not null;

alter table public.skylanders
  add constraint skylanders_catalog_status_known
    check (catalog_status in ('public', 'hidden', 'draft')),
  add constraint skylanders_catalog_status_matches_visibility
    check ((catalog_status = 'public') = catalog_visible);


-- ---------------------------------------------------------------------------
-- 4. Der Trigger, der jeden bestehenden Schreibpfad weiterleben laesst
-- ---------------------------------------------------------------------------
create or replace function public.skylanders_sync_catalog_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.catalog_status is null then
      -- Der Aufrufer hat nichts gesagt: die Sichtbarkeit entscheidet.
      new.catalog_status := case when new.catalog_visible then 'public' else 'hidden' end;
    else
      -- Der Aufrufer hat den Status gesagt: er entscheidet die Sichtbarkeit.
      new.catalog_visible := (new.catalog_status = 'public');
    end if;
    return new;
  end if;

  if new.catalog_status is distinct from old.catalog_status then
    new.catalog_visible := (new.catalog_status = 'public');
  elsif new.catalog_visible is distinct from old.catalog_visible then
    /*
     * DER ALTE SCHREIBPFAD, UND DIE EINE FEINHEIT DARIN.
     *
     * `admin_set_catalog_visible(sky_id, false)` auf einem ENTWURF soll ihn
     * nicht stillschweigend zu „versteckt" umbenennen: beide sind nicht
     * oeffentlich, und die Absicht gehoert dem, der sie gesetzt hat. Nur ein
     * Wechsel nach sichtbar ist eindeutig — das ist 'public'.
     */
    new.catalog_status := case
      when new.catalog_visible          then 'public'
      when old.catalog_status = 'draft' then 'draft'
      else                                   'hidden'
    end;
  end if;
  return new;
end;
$$;

comment on function public.skylanders_sync_catalog_status() is
  'Keeps skylanders.catalog_status and catalog_visible in step (0152). Whichever column a write names, the other is derived - which is what lets admin_set_catalog_visible, admin_create_figure and seller_create_catalog_item keep working unchanged. Hiding a draft leaves it a draft: both are non-public, and the intent belongs to whoever set it. BEFORE, so the CHECK constraints and the AFTER journal trigger both see the corrected row.';

create trigger skylanders_sync_catalog_status
  before insert or update on public.skylanders
  for each row execute function public.skylanders_sync_catalog_status();


-- ---------------------------------------------------------------------------
-- 5. Das Journal kennt ein Feld mehr
--
-- `log_skylander_editorial_change` journalisiert vier redaktionelle Felder
-- (0004, erweitert in 0007 und 0033). `create or replace` ersetzt den ganzen
-- Rumpf, also stehen alle vier hier noch einmal — unveraendert — plus
-- `catalog_status`.
--
-- `catalog_visible` BLEIBT ebenfalls journalisiert. Ein Statuswechsel
-- erzeugt damit zwei Zeilen, und das ist richtig: der alte Schreibpfad
-- schreibt weiterhin nur die eine Spalte, und ein Journal, das die
-- Sichtbarkeit nicht mehr nennt, haette eine Luecke genau dort.
-- ---------------------------------------------------------------------------
create or replace function public.log_skylander_editorial_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.catalog_status is distinct from old.catalog_status then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'catalog_status',
            old.catalog_status, new.catalog_status,
            (select auth.uid()));
  end if;
  if new.catalog_visible is distinct from old.catalog_visible then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'catalog_visible',
            old.catalog_visible::text, new.catalog_visible::text,
            (select auth.uid()));
  end if;
  if new.display_name_override is distinct from old.display_name_override then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'display_name_override',
            old.display_name_override, new.display_name_override,
            (select auth.uid()));
  end if;
  if new.image_override_path is distinct from old.image_override_path then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'image_override_path',
            old.image_override_path, new.image_override_path,
            (select auth.uid()));
  end if;
  if new.card_type is distinct from old.card_type then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'card_type',
            old.card_type, new.card_type,
            (select auth.uid()));
  end if;
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. Der Schreibweg des Admins
--
-- Ein UPDATE fuer beide Spalten, damit der CHECK nicht einmal
-- zwischenzeitlich verletzt ist. Der Trigger wuerde es auch alleine richten;
-- beides zu schreiben macht die Absicht an der Aufrufstelle lesbar.
--
-- `is_platform_admin()` ist das Tor, nicht `is_shop_admin()`: seit ADR-0077
-- sind Plattformadmin und Verkaeuferbetrieb getrennt, und der Katalog gehoert
-- der Plattform. Dieselbe Pruefung, die `admin_set_catalog_visible` seit 0041
-- benutzt.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_catalog_status(
  p_sky_id text,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required' using errcode = 'insufficient_privilege';
  end if;

  if p_status is null or p_status not in ('public', 'hidden', 'draft') then
    raise exception 'unknown catalog status %', coalesce(p_status, '(null)')
      using errcode = 'check_violation';
  end if;

  update public.skylanders
     set catalog_status  = p_status,
         catalog_visible = (p_status = 'public')
   where sky_id = p_sky_id;

  if not found then
    raise exception 'unknown sky_id %', p_sky_id using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function public.admin_set_catalog_status(text, text) is
  'Sets the editorial status of one catalogue figure (0152, CAT-02B). Platform administrators only. Writes status and visibility in ONE update, so the CHECK is never transiently violated. Rejects any value outside public/hidden/draft. The change is journalled by skylanders_log_editorial; there is no approval step and no second actor.';

revoke all on function public.admin_set_catalog_status(text, text) from public, anon;
grant execute on function public.admin_set_catalog_status(text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. `admin_set_catalog_visible` BLEIBT, unveraendert
--
-- Sie wird nicht geloescht und nicht umgeschrieben. Drei Gruende:
--
--   * Rueckwaertskompatibilitaet: jeder Aufrufer, der sie heute benutzt,
--     benutzt sie weiter, und der Trigger setzt den Status mit.
--   * Sie bleibt die richtige Antwort auf die ZWEI-Zustands-Frage „oeffentlich
--     oder nicht", die es in Zubehoer- und Betriebsflaechen weiterhin gibt.
--   * Eine Funktion zu entfernen, die noch aufgerufen wird, waere eine
--     Aenderung mit Reichweite — und diese Migration soll keine haben.
--
-- Die Adminoberfläche ruft ab CAT-02B `admin_set_catalog_status` auf. Beide
-- Wege fuehren zu einem gueltigen Zustand.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 8. Eine neu angelegte Figur ist ein Entwurf
--
-- Wortgleich die Fassung aus 0041, mit GENAU einer fachlichen Aenderung: der
-- INSERT nennt `catalog_status`. Die Signatur bleibt identisch — ein
-- zusaetzlicher Parameter waere eine Ueberladung und keine Ersetzung, und
-- dann gaebe es zwei Funktionen mit demselben Namen.
--
-- `seller_create_catalog_item` (0137) wird NICHT angefasst: sie legt Zubehoer
-- aus dem Einkaufsbuch an, bekommt vom Trigger 'hidden' und funktioniert
-- unveraendert. Ob dort 'draft' die richtigere Beschriftung waere, ist eine
-- eigene Entscheidung und keine dieser Migration.
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_figure(
  p_name                  text,
  p_series_code           text,
  p_category_id           bigint,
  p_card_type             text    default 'standard',
  p_catalog_visible       boolean default false,
  p_display_name_override text    default null,
  p_admin_note            text    default null,
  p_template_sky_id       text    default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name      text   := btrim(coalesce(p_name, ''));
  v_next      bigint;
  v_sky_id    text;
  v_slug      text;
  v_override  text   := nullif(btrim(coalesce(p_display_name_override, '')), '');
  v_note      text   := nullif(btrim(coalesce(p_admin_note, '')), '');
  v_template  text   := nullif(btrim(coalesce(p_template_sky_id, '')), '');
  v_character bigint := null;
  v_found     boolean;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required' using errcode = 'insufficient_privilege';
  end if;

  if v_name = '' then
    raise exception 'a figure needs a name' using errcode = 'check_violation';
  end if;

  /*
   * The template, read from the catalogue rather than believed.
   *
   * A SKY-ID that does not exist is refused instead of silently ignored: the
   * operator picked something, and a create that quietly dropped the
   * relationship would produce a figure that looks derived and is not.
   *
   * `v_character` may still be NULL afterwards - that is a template without a
   * curated character, and it is a normal answer.
   */
  if v_template is not null then
    select s.character_id, true
      into v_character, v_found
      from public.skylanders s
     where s.sky_id = v_template;

    if not coalesce(v_found, false) then
      raise exception 'unknown template figure %', v_template
        using errcode = 'no_data_found';
    end if;
  end if;

  v_next := nextval('public.sky_id_seq');

  if v_next > 8999 then
    raise exception
      'SKY-ID allocation range exhausted: % is beyond SKY-8999, and SKY-9000-9999 is the reserved system/test range (ADR-0070)',
      v_next
      using errcode = 'check_violation';
  end if;

  v_sky_id := 'SKY-' || lpad(v_next::text, 4, '0');
  v_slug   := public.next_figure_slug(v_name, p_series_code, v_sky_id);

  insert into public.skylanders
    (sky_id, name, slug, series_code, category_id,
     card_type, catalog_visible, catalog_status, display_name_override,
     character_id, source, is_active)
  values
    (v_sky_id, v_name, v_slug, p_series_code, p_category_id,
     coalesce(nullif(btrim(coalesce(p_card_type, '')), ''), 'standard'),
     coalesce(p_catalog_visible, false),
     -- DIE EINE FACHLICHE AENDERUNG (CAT-02B, Teil F): eine neu angelegte
     -- Figur ist ein ENTWURF, nicht ein verstecktes Objekt. Beides ist
     -- nicht oeffentlich, aber nur eines sagt „noch nicht fertig".
     -- Wer ausdruecklich sichtbar anlegt, bekommt weiter 'public'.
     case when coalesce(p_catalog_visible, false) then 'public' else 'draft' end,
     v_override, v_character, 'admin', true);

  if v_note is not null then
    insert into public.catalog_editorial (sky_id, admin_note)
    values (v_sky_id, v_note);
  end if;

  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', v_sky_id, 'created', null, v_name, (select auth.uid()));

  return v_sky_id;
end;
$$;


-- ===========================================================================
-- WAS DANACH GILT
--
--   * 594 Zeilen tragen einen Status, kein einziger ist 'draft'.
--   * `catalog_visible` ist unveraendert die Spalte, die RLS, der Teilindex
--     und `shop_offers()` lesen. Keine Sichtbarkeit hat sich geaendert.
--   * Jeder bestehende Schreibpfad funktioniert: der Trigger leitet ab, was
--     der Aufrufer nicht nennt.
--   * Eine neu angelegte Figur ist ein Entwurf.
--
-- WAS DIESE MIGRATION NICHT TUT
--
--   * Sie erweitert die Lesepolitik NICHT um Favoriten. Wer ein Objekt
--     vorgemerkt, aber nicht besessen hat, verliert es weiterhin aus seiner
--     Wunschliste, sobald es nicht oeffentlich ist — das gilt heute schon fuer
--     `hidden` und ist eine eigene Entscheidung (CAT-02A, P7).
--   * Sie fasst `seller_create_catalog_item` nicht an.
--   * Sie legt keine Figur an und vergibt keine SKY-ID.
-- ===========================================================================
-- <<< ENDE: supabase/migrations/0152_catalog_status.sql

-- ---------------------------------------------------------------------------
-- B  DERSELBE MASSSTAB, NOCH EINMAL — UND DER VERGLEICH, DER ZURUECKROLLT
-- ---------------------------------------------------------------------------
do $lauf_b$
declare
  v_vor_base  text := current_setting('skyisles.base', true);
  v_vor_coll  text := current_setting('skyisles.coll', true);
  v_vor_sicht text := current_setting('skyisles.sicht', true);
  v_vor_ja    text := current_setting('skyisles.sichtbar', true);
  v_vor_nein  text := current_setting('skyisles.unsichtbar', true);
  v_vor_trig  text := current_setting('skyisles.trigger', true);
  v_nach_base text;
  v_nach_coll text;
  v_nach      text;
  v_n         integer;
begin
  if v_vor_base is null or btrim(v_vor_base) = '' then
    raise exception 'ABBRUCH B1: die Shop-Baseline fehlt. Abschnitt A4 dieser '
      'Huelle hat sie nicht gesetzt — ohne Vergleich wird nichts committet.';
  end if;
  if v_vor_coll is null or btrim(v_vor_coll) = '' then
    raise exception 'ABBRUCH B2: die Sammlungs-Baseline fehlt (siehe B1).';
  end if;
  if v_vor_sicht is null or btrim(v_vor_sicht) = ''
     or v_vor_ja is null or v_vor_nein is null or v_vor_trig is null then
    raise exception 'ABBRUCH B2b: der Sichtbarkeits-Abdruck, die zwei Zahlen '
      'oder die Triggerliste fehlen — Abschnitt A5/A7 hat sie nicht gesetzt.';
  end if;

  with sammelbar as (
  select s.sky_id
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active and s.catalog_visible
     and not (c.name = any (public.non_collectible_categories()))
),
basis_mess as (
  -- Die sieben Zahlen, einmal gerechnet, hier und in Zeile 900 benutzt.
  select
    /*
     * DIE ZWEI FELDER, DIE `shop_offers()` BRAUCHEN — und das ist die einzige
     * Stelle des Basis-Vertrags, an der ein Recht fehlen kann.
     *
     * Fehlt `execute`, steht hier `KEIN-RECHT`: die Zeilen 811 und 812 sind
     * dann OFFEN (Zeile 9998 zaehlt sie), die uebrigen fuenf Felder werden
     * weiter gemessen und verglichen. Ein fehlendes Recht nimmt also nicht
     * die ganze Baseline mit — aber es wird auch nicht stillschweigend
     * uebergangen.
     */
    case when has_function_privilege('public.shop_offers()', 'execute')
         then (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from public.shop_offers()',
             false, true, '')))[1]::text
         else 'KEIN-RECHT' end as angebote,
    case when has_function_privilege('public.shop_offers()', 'execute')
         then (xpath('/row/c/text()', query_to_xml(
             'select md5(coalesce(string_agg(o.sky_id || ''|'' || o.condition || ''|'' '
             '|| coalesce(o.price::text, ''''), '
             ''';'' order by o.sky_id, o.condition), '''')) as c '
             'from public.shop_offers() o',
             false, true, '')))[1]::text
         else 'KEIN-RECHT' end as angebote_md5,
    (select count(*)::text from public.skylanders s
      where public.is_shop_eligible(s.sky_id))                             as shopfaehig,
    (select count(*)::text from sammelbar)                                 as sammelbar,
    (select count(*)::text from public.shop_inventory)                     as lagerzeilen,
    (select count(*)::text from public.skylanders)                         as katalogzeilen,
    (select coalesce(md5(string_agg(i.id::text || '|' || i.is_listed::text || '|'
                                    || coalesce(i.sale_price::text, '-') || '|'
                                    || i.sale_released::text,
                                    E'\n' order by i.id)), '(leer)')
       from public.shop_inventory i)                                       as lager_md5
),
basis_feld as (
  select angebote || '|' || angebote_md5 || '|' || shopfaehig || '|' || sammelbar
         || '|' || lagerzeilen || '|' || katalogzeilen || '|' || lager_md5 as kern,
         m.*
    from basis_mess m
),
basis_zeile as (
  select 'skyisles-base-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from basis_feld f
)
  select zeile into v_nach_base from basis_zeile;

  if v_nach_base is distinct from v_vor_base then
    raise exception 'ABBRUCH B3: Shop, Lager oder Katalog haben sich waehrend '
      'dieser Gruppe veraendert. VORHER % — NACHHER %. Die Gruppe rollt '
      'zurueck; nichts davon liegt.', v_vor_base, v_nach_base;
  end if;

  with coll_mess as (
  -- Die drei Zahlen der Sammlung, einmal gerechnet.
  select
    (select count(*)::text from public.collection_items)                   as zeilen,
    (select count(distinct user_id)::text from public.collection_items)    as konten,
    (select coalesce(md5(string_agg(ci.user_id::text || '|' || ci.sky_id || '|'
                                    || ci.quantity::text,
                                    E'\n' order by ci.user_id, ci.sky_id)), '(leer)')
       from public.collection_items ci)                                    as sammlung_md5
),
coll_feld as (
  select zeilen || '|' || konten || '|' || sammlung_md5 as kern, m.*
    from coll_mess m
),
coll_zeile as (
  select 'skyisles-coll-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from coll_feld f
)
  select zeile into v_nach_coll from coll_zeile;

  if v_nach_coll is distinct from v_vor_coll then
    raise exception 'ABBRUCH B4: die Sammlung hat sich waehrend dieser Gruppe '
      'veraendert. VORHER % — NACHHER %.', v_vor_coll, v_nach_coll;
  end if;

  -- B5  KEINE SICHTBARKEIT HAT SICH BEWEGT — Zeile fuer Zeile, nicht gezaehlt.
  select coalesce(md5(string_agg(s.sky_id || '|' || s.catalog_visible::text, E'\n'
                                 order by s.sky_id)), '(leer)')
    into v_nach from public.skylanders s;
  if v_nach is distinct from v_vor_sicht then
    raise exception 'ABBRUCH B5: die SICHTBARKEIT einer Katalogzeile hat sich '
      'veraendert. Abdruck vorher %, nachher %. Das darf 0152 nicht tun — die '
      'Gruppe rollt zurueck.', v_vor_sicht, v_nach;
  end if;

  -- B6  DER BACKFILL TRIFFT GENAU DIE ZWEI ZAHLEN AUS A5.
  select count(*) into v_n from public.skylanders
   where catalog_status = 'public' and catalog_visible;
  if v_n::text is distinct from v_vor_ja then
    raise exception 'ABBRUCH B6: % Zeilen sind public UND sichtbar, erwartet % '
      '(die sichtbaren aus A5).', v_n, v_vor_ja;
  end if;
  select count(*) into v_n from public.skylanders
   where catalog_status = 'hidden' and not catalog_visible;
  if v_n::text is distinct from v_vor_nein then
    raise exception 'ABBRUCH B7: % Zeilen sind hidden UND unsichtbar, erwartet '
      '% (die unsichtbaren aus A5).', v_n, v_vor_nein;
  end if;

  -- B8  KEINE ZEILE IST ZUM ENTWURF GEWORDEN.
  select count(*) into v_n from public.skylanders where catalog_status = 'draft';
  if v_n <> 0 then
    raise exception 'ABBRUCH B8: % Zeile(n) stehen auf draft. 0152 macht aus '
      'keinem bestehenden Eintrag einen Entwurf.', v_n;
  end if;

  -- B9  GENAU EIN TRIGGER MEHR, UND KEINER VERSCHWUNDEN.
  select coalesce(string_agg(t.tgname, ',' order by t.tgname), '(keine)')
    into v_nach from pg_trigger t
   where t.tgrelid = to_regclass('public.skylanders') and not t.tgisinternal;
  if v_nach is distinct from
     (select coalesce(string_agg(x, ',' order by x), '(keine)')
        from unnest(string_to_array(v_vor_trig, ',')
                    || array['skylanders_sync_catalog_status']) as x) then
    raise exception 'ABBRUCH B9: die Triggerliste an skylanders ist % — '
      'erwartet die vorgefundene plus skylanders_sync_catalog_status. '
      'VORHER: %', v_nach, v_vor_trig;
  end if;

  raise notice '0152 auf Production: catalog_status steht, Sichtbarkeit '
    'unveraendert (% sichtbar / % unsichtbar), kein Entwurf, beide Vertraege '
    'unveraendert.', v_vor_ja, v_vor_nein;
end
$lauf_b$;

commit;
