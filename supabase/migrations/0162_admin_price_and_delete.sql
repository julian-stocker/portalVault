-- ---------------------------------------------------------------------------
-- 0162 — der Marktwert an der Kachel, und die Loeschung einer unbenutzten Zeile
--
-- ZWEI FUNKTIONEN, UND BEIDE SIND KLEIN (CAT-09).
--
--   `admin_set_market_price(text, numeric)`   schreibt EINE Spalte
--   `admin_delete_figure(text)`               loescht EINE Zeile, wenn
--                                             nichts auf sie zeigt
--
-- Dazu zwei neue Journalwerte. Sonst nichts: keine Tabelle, keine Spalte,
-- kein Trigger, keine Richtlinie, kein Index, kein Recht an fremden
-- Objekten.
--
-- ===========================================================================
-- DER MARKTWERT — UND DIE FALLE, DIE DER BETREIBER BENANNT HAT
-- ===========================================================================
--
-- `skylanders.market_price` ist der GESPEICHERTE Wert. Was der Katalog
-- ANZEIGT, ist seit dem Zuschlag etwas anderes:
--
--     Anzeige = market_price × (1 + boost/100)
--
-- gerechnet in `src/lib/catalog/market-boost.ts`, im letzten Moment, in der
-- Komponente, die ihn druckt — und nie gespeichert. Schriebe die
-- Inlinebearbeitung den ANGEZEIGTEN Wert zurueck, waere der Zuschlag beim
-- naechsten Lesen zweimal drin, und zwar jedes Mal wieder.
--
-- DIESE FUNKTION NIMMT DESHALB DEN GESPEICHERTEN WERT und nichts anderes.
-- Die Oberflaeche fuellt das Feld mit `figure.marketPrice` (gespeichert) und
-- nicht mit dem gedruckten Betrag; `src/lib/catalog/market-boost.test.ts`
-- und `src/lib/admin/inline-price.test.ts` halten beides fest.
--
-- `NULL` IST „PREIS OFFEN" UND NICHT NULL EURO (ADR-0010). Die Constraint
-- `skylanders_market_price_positive` sagt `null or > 0`; eine 0 waere also
-- ohnehin abgewiesen — aber die Meldung soll sagen, was gemeint ist, und
-- nicht die der Constraint. `price_updated_at` folgt dem Wert: ein Datum
-- ohne Preis waere eine Auskunft ueber nichts.
--
-- ===========================================================================
-- DIE LOESCHUNG — WAS SIE PRUEFT UND WARUM SIE MEHR PRUEFT ALS DER
-- FREMDSCHLUESSEL
-- ===========================================================================
--
-- `admin_discard_draft` (`0155`) loescht EINEN importierten Entwurf. Diese
-- Funktion ist dieselbe Bauform ohne die drei entwurfsspezifischen Riegel —
-- und mit DREI Pruefungen, die `0155` nicht braucht:
--
--   1. DIE GEZAEHLTEN VERWEISE. `admin_merge_references` (`0154`, berichtigt
--      in `0159`) leitet aus `pg_constraint` her, wer auf die SKY-ID zeigt.
--      Gemessen am 2026-10-29: VIERZEHN Fremdschluessel.
--
--   2. DIE CASCADE-SCHLUESSEL, EINZELN. Vier der vierzehn stehen auf
--      `ON DELETE CASCADE`: `cart_items`, `catalog_editorial`,
--      `inventory_import_mappings`, `orderbook_name_mappings`. Ein `delete`
--      wuerde sie MITNEHMEN, und genau das darf nicht geschehen (Anforderung
--      8). `admin_merge_references` zaehlt sie mit, aber diese Funktion
--      nennt sie einzeln in der Meldung — ein Warenkorb, der still
--      verschwindet, ist kein blockierter Loeschvorgang, sondern ein
--      stiller.
--
--      `catalog_editorial` ist die EINE Ausnahme, und sie ist keine: diese
--      Zeile gehoert der Figur selbst (Notiz, Gruppe), `0154` nimmt sie
--      ausdruecklich aus der Zaehlung, und `0155` loescht sie vor der Figur.
--      Hier genauso.
--
--   3. DER STILLE VERWEIS. `order_lines.sky_id` ist ein TEXT-Feld OHNE
--      Fremdschluessel — gemessen, die einzige solche Spalte im Schema. Eine
--      Bestellzeile ist ein historischer Beleg und soll Katalogaenderungen
--      ueberleben; deshalb steht dort kein Schluessel, und deshalb sieht
--      `admin_merge_references` sie NICHT. Diese Funktion fragt sie
--      ausdruecklich. Ohne diese Zeile waere „referenzfrei" eine Behauptung.
--
-- WAS SIE NICHT TUT, und jedes davon ist eine Anforderung:
--
--   * Sie haengt nichts um (keine fremde SKY-ID bekommt die Daten).
--   * Sie loescht keine Variante, keine Familie, keinen Charakter.
--   * Sie benutzt KEIN `cascade` als Umweg: sie prueft vorher und bricht ab.
--   * Sie faesst KEINE Datei in Supabase Storage an. Gemessen: 44 Bilddateien
--      sind von 103 Zeilen GETEILT (Grundfigur und Variante, das Projekt tut
--      das absichtlich). Eine geloeschte Zeile hinterlaesst also hoechstens
--      eine verwaiste Datei, und das ist der harmlose Fehler; eine geloeschte
--      Datei naehme einer anderen Figur das Bild. Der Bereinigungsbedarf
--      steht in `supabase/checks/0162_storage_note.md`.
--   * Sie gibt die SKY-ID NICHT zurueck in den Umlauf. Neue Nummern kommen
--      aus `sky_id_seq` (`0033`), und eine Sequenz geht nur vorwaerts —
--      gemessen stehen heute schon 232 Luecken im Nummernband, und keine
--      davon wurde je neu vergeben.
--
-- DAS JOURNAL UEBERLEBT DIE LOESCHUNG. `catalog_admin_changes` hat KEINEN
-- Fremdschluessel auf `skylanders` (gemessen), also bleibt die Zeile stehen,
-- wenn die Figur fort ist — und sie wird VOR dem `delete` geschrieben,
-- derselbe Ablauf wie in `0155`. Ein Auditsatz, der die referenzfreie
-- Loeschung selbst blockiert, waere der Widerspruch aus Anforderung 16.
--
-- ATOMAR UND GEGEN NEBENLAEUFIGKEIT: `select … for update` auf der Zeile,
-- dann pruefen, dann schreiben — alles in einer Transaktion. Legt jemand
-- zwischen Pruefung und `delete` eine Sammlungszeile an, scheitert der
-- `delete` am Fremdschluessel, und die ganze Transaktion rollt zurueck. Die
-- Constraint ist die letzte Schicht, nicht die erste.
--
-- Ruecknahme: `supabase/rollback/R0162_drop_price_and_delete.sql`.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $vor$
begin
  if to_regprocedure('public.admin_merge_references(text)') is null then
    raise exception '0162 setzt 0154 voraus: admin_merge_references() fehlt';
  end if;
  if to_regprocedure('public.is_platform_admin()') is null then
    raise exception '0162 setzt 0026 voraus: is_platform_admin() fehlt';
  end if;
  if to_regclass('public.order_lines') is null then
    raise exception '0162 setzt 0010 voraus: order_lines fehlt — ohne sie kann '
      'die Loeschung den stillen Verweis nicht pruefen';
  end if;
  -- Die Zeile, die `0159` zuletzt gesetzt hat: zwoelf Werte.
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = to_regclass('public.catalog_admin_changes')
       and c.conname = 'catalog_admin_changes_field_known'
       and pg_get_constraintdef(c.oid) like '%base_sky_id%') then
    raise exception '0162 setzt 0159 voraus: die Audit-Constraint kennt '
      'base_sky_id nicht';
  end if;
  if to_regprocedure('public.admin_set_market_price(text,numeric)') is not null
     or to_regprocedure('public.admin_delete_figure(text)') is not null then
    raise exception '0162 Abbruch: eine der beiden Funktionen steht schon. '
      'Diese Migration ist hier bereits angewendet.';
  end if;
end
$vor$;


-- ---------------------------------------------------------------------------
-- 2. Das Journal kennt zwei weitere Werte
--
-- Dieselbe Lehre zum vierten Mal: wer eine Spalte journalisiert, muss ihren
-- Namen in die Liste aufnehmen. `0152` hat es vergessen und jeder
-- Statuswechsel lief in `23514`.
--
--   `market_price`  die Inlinebearbeitung
--   `deleted`       die Loeschung. NICHT `discarded` — das ist `0157`s Wert
--                   fuer das Verwerfen eines ENTWURFS, und die beiden sollen
--                   sich im Journal unterscheiden lassen.
-- ---------------------------------------------------------------------------
alter table public.catalog_admin_changes
  drop constraint if exists catalog_admin_changes_field_known;

alter table public.catalog_admin_changes
  add constraint catalog_admin_changes_field_known
    check (field in (
      -- die sieben aus `0004`/`0007`/`0033`:
      'catalog_visible', 'display_name_override', 'admin_note', 'catalog_group',
      'image_override_path', 'card_type', 'created',
      -- die drei aus `0157`:
      'catalog_status', 'merged_from', 'discarded',
      -- der elfte aus `0158`, der zwoelfte aus `0159`:
      'character_id', 'base_sky_id',
      -- und die zwei aus dieser Migration:
      'market_price', 'deleted'
    ));


-- ---------------------------------------------------------------------------
-- 3. Der Marktwert, eine Spalte
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_market_price(
  p_sky_id text,
  p_price  numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.skylanders%rowtype;
  v_alt numeric;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_row from public.skylanders where sky_id = p_sky_id for update;
  if not found then
    raise exception '0162: die Figur % gibt es nicht', p_sky_id;
  end if;
  v_alt := v_row.market_price;

  /*
   * `NULL` IST „PREIS OFFEN", `0` IST EIN FEHLER (ADR-0010). Die Constraint
   * `skylanders_market_price_positive` wuerde die 0 auch abweisen; die
   * Meldung hier sagt, was gemeint ist.
   */
  if p_price is not null and p_price <= 0 then
    raise exception '0162: ein Marktwert von % ist kein Preis. Fuer „Preis '
      'offen" das Feld leer lassen — das schreibt NULL und nicht 0.', p_price;
  end if;
  if p_price is not null and p_price > 99999999.99 then
    raise exception '0162: % ist zu gross fuer numeric(10,2)', p_price;
  end if;

  if v_alt is not distinct from p_price then
    return jsonb_build_object('sky_id', p_sky_id, 'market_price', p_price,
                              'changed', false);
  end if;

  /*
   * EINE SPALTE UND IHR DATUM. `price_updated_at` folgt dem Wert: ein Datum
   * ohne Preis waere eine Auskunft ueber nichts (`0001` haelt das als Regel
   * fest). Kein Name, kein Slug, keine Sichtbarkeit, kein Status, kein
   * Bild, keine Serie, keine Kategorie, kein `card_type` — die
   * Preisbearbeitung aendert den Preis.
   */
  update public.skylanders
     set market_price     = p_price,
         price_updated_at = case when p_price is null then null else now() end
   where sky_id = p_sky_id;

  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', p_sky_id, 'market_price',
          v_alt::text, p_price::text, (select auth.uid()));

  return jsonb_build_object('sky_id', p_sky_id, 'market_price', p_price,
                            'old_market_price', v_alt, 'changed', true);
end;
$$;

comment on function public.admin_set_market_price(text, numeric) is
  'Sets skylanders.market_price, the STORED reference price, or clears it with NULL for "price unknown" (0162, CAT-09). NULL is not zero (ADR-0010) and zero is refused with a sentence rather than with the constraint message. It writes ONE column plus its date: price_updated_at follows the value, because a date without a price states nothing. The catalogue DISPLAYS market_price times the temporary boost (src/lib/catalog/market-boost.ts), computed at print time and never stored - the editor therefore binds to the stored value, and writing the displayed one back would compound the boost on every save. Journals market_price, the thirteenth allowed field. Platform admins only.';

revoke all on function public.admin_set_market_price(text, numeric) from public, anon;
grant execute on function public.admin_set_market_price(text, numeric) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Die Loeschung einer Zeile, auf die nichts zeigt
-- ---------------------------------------------------------------------------
create or replace function public.admin_delete_figure(p_sky_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row       public.skylanders%rowtype;
  v_refs      bigint := 0;
  v_liste     text   := '';
  v_cascade   text   := '';
  v_bestell   bigint := 0;
  v_varianten bigint := 0;
  r           record;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_row from public.skylanders where sky_id = p_sky_id for update;
  if not found then
    raise exception '0162: die Figur % gibt es nicht', p_sky_id;
  end if;

  -- ---- 1. DIE GEZAEHLTEN VERWEISE, aus `pg_constraint` hergeleitet.
  for r in select tabelle, spalte, zeilen
             from public.admin_merge_references(p_sky_id)
  loop
    v_refs := v_refs + r.zeilen;
    if r.zeilen > 0 then
      v_liste := v_liste || case when v_liste = '' then '' else ', ' end
                 || r.tabelle || '.' || r.spalte || '=' || r.zeilen::text;
      /*
       * DIE CASCADE-SCHLUESSEL NAMENTLICH. Ein `delete` nimmt sie mit; genau
       * deshalb werden sie hier genannt und nicht nur gezaehlt.
       */
      /*
       * `admin_merge_references` gibt den Tabellennamen SCHON QUALIFIZIERT
       * zurueck — `conrelid::regclass::text` rendert bei leerem `search_path`
       * `public.cart_items`. Ein vorangestelltes `public.` machte daraus
       * `public.public.cart_items`, und PostgreSQL liest das als Datenbank,
       * Schema, Tabelle: `0A000 cross-database references are not
       * implemented`. Gefunden von Probelauf P71 — jede Loeschung einer Zeile
       * MIT Verweisen waere daran gescheitert, und zwar mit dieser Meldung
       * statt der lesbaren.
       */
      if exists (select 1 from pg_constraint c
                  where c.conrelid = to_regclass(r.tabelle)
                    and c.contype = 'f'
                    and c.confrelid = to_regclass('public.skylanders')
                    and c.confdeltype = 'c') then
        v_cascade := v_cascade || case when v_cascade = '' then '' else ', ' end
                     || r.tabelle;
      end if;
    end if;
  end loop;

  -- ---- 2. DER STILLE VERWEIS: `order_lines.sky_id` traegt keinen Schluessel.
  select count(*) into v_bestell from public.order_lines where sky_id = p_sky_id;

  -- ---- 3. UND DIE VARIANTEN. Der Fremdschluessel aus `0159` faengt es auch,
  --         aber mit einer Meldung, die niemand lesen will.
  select count(*) into v_varianten
    from public.skylanders where base_sky_id = p_sky_id;

  if v_varianten > 0 then
    raise exception '0162: auf % zeigen % Variante(n) als Basisfigur. Sie wird '
      'nicht geloescht — erst die Varianten loesen (admin_set_variant_base '
      'mit NULL).', p_sky_id, v_varianten;
  end if;
  if v_bestell > 0 then
    raise exception '0162: % steht in % Bestellzeile(n). Eine Bestellung ist '
      'ein Beleg und wird nicht veraendert; die Figur bleibt.',
      p_sky_id, v_bestell;
  end if;
  if v_refs > 0 then
    raise exception '0162: auf % zeigen noch Daten: %.%  Die Figur wird nicht '
      'geloescht und es wird nichts mitgeloescht.',
      p_sky_id, v_liste,
      case when v_cascade = '' then ''
           else ' Darunter mit ON DELETE CASCADE: ' || v_cascade
                || ' — die waeren stillschweigend mitgegangen.' end;
  end if;

  -- ---- DAS JOURNAL ZUERST, denn es muss die Zeile ueberleben.
  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', p_sky_id, 'deleted',
          v_row.name || ' | ' || v_row.series_code || ' | '
            || v_row.catalog_status || ' | ' || v_row.source
            || coalesce(' | ' || v_row.market_price::text, ''),
          null, (select auth.uid()));

  /*
   * Die redaktionelle Zeile gehoert der Figur selbst (`0154` nimmt sie aus
   * der Zaehlung, `0155` loescht sie genauso). Ausdruecklich und nicht per
   * `cascade`: so steht im Code, was verschwindet.
   */
  delete from public.catalog_editorial where sky_id = p_sky_id;
  delete from public.skylanders where sky_id = p_sky_id;

  return jsonb_build_object(
    'sky_id',   p_sky_id,
    'name',     v_row.name,
    'deleted',  true,
    -- Das Bild bleibt liegen: geteilte Dateien (gemessen 44) duerfen nicht
    -- verschwinden. `supabase/checks/0162_storage_note.md` haelt fest, was
    -- dadurch aufzuraeumen bleibt.
    'image_file', v_row.image_file);
end;
$$;

comment on function public.admin_delete_figure(text) is
  'Deletes ONE catalogue row that nothing points at (0162, CAT-09). Three checks, because a foreign key alone is not enough: admin_merge_references counts every FK derived from pg_constraint (fourteen today), the four ON DELETE CASCADE keys are named individually in the message because a plain delete would silently take them, and order_lines.sky_id is asked explicitly - it is the only SKY-ID column in the schema without a foreign key, because an order line is a historical record. Variants are refused with a readable sentence before the key refuses them. Nothing is re-pointed, nothing is cascaded, no variant or family is removed, and no file in Storage is touched: 44 image files are shared by 103 rows, so a deleted row leaves at most an orphan, while a deleted file would take another figure its picture. The audit row is written BEFORE the delete and survives it - catalog_admin_changes has no foreign key here, which is what lets a reference-free delete stay reference-free. The SKY-ID is not returned to circulation: new ones come from sky_id_seq. Atomic and locked with for update; the constraints remain the last layer, not the first. Platform admins only.';

revoke all on function public.admin_delete_figure(text) from public, anon;
grant execute on function public.admin_delete_figure(text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_def   text;
  v_offen integer;
begin
  for v_def in select unnest(array['public.admin_set_market_price(text,numeric)',
                                   'public.admin_delete_figure(text)'])
  loop
    if to_regprocedure(v_def) is null then
      raise exception '0162 Nachbedingung: % steht nicht', v_def;
    end if;
    if not exists (select 1 from pg_proc p
                    where p.oid = to_regprocedure(v_def)
                      and p.prosecdef and p.provolatile = 'v'
                      and (select count(*) = 1
                             from unnest(coalesce(p.proconfig, '{}')) c
                            where c like 'search\_path=%')) then
      raise exception '0162 Nachbedingung: % hat die Attribute nicht', v_def;
    end if;
    select count(*) into v_offen
      from pg_proc p, aclexplode(p.proacl) a
     where p.oid = to_regprocedure(v_def)
       and a.privilege_type = 'EXECUTE'
       and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
    if v_offen <> 0 then
      raise exception '0162 Nachbedingung: % offene EXECUTE-Rechte auf %',
        v_offen, v_def;
    end if;
  end loop;

  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null then
    raise exception '0162 Nachbedingung: die Audit-Constraint fehlt';
  end if;
  if v_def not like '%market_price%' or v_def not like '%deleted%' then
    raise exception '0162 Nachbedingung: die Audit-Constraint kennt die zwei '
      'neuen Werte nicht: %', v_def;
  end if;
  -- UND DIE ZWOELF ALTEN STEHEN NOCH. Dieselbe Pruefung wie in `0158`/`0159`.
  if v_def not like '%catalog_visible%' or v_def not like '%base_sky_id%'
     or v_def not like '%character_id%' or v_def not like '%discarded%'
     or v_def not like '%merged_from%' or v_def not like '%catalog_status%'
     or v_def not like '%created%' or v_def not like '%card_type%'
     or v_def not like '%image_override_path%' or v_def not like '%catalog_group%'
     or v_def not like '%admin_note%' or v_def not like '%display_name_override%' then
    raise exception '0162 Nachbedingung: ein alter Journalwert ist verloren: %', v_def;
  end if;

  -- Und diese Migration hat KEINE Zeile angefasst.
  if to_regprocedure('public.admin_discard_draft(text)') is null then
    raise exception '0162 Nachbedingung: admin_discard_draft aus 0155 ist fort';
  end if;

  raise notice '0162: admin_set_market_price und admin_delete_figure stehen, '
    'security definer, leerer Suchpfad, nur authenticated. Das Journal kennt '
    'vierzehn Werte.';
end
$nach$;
