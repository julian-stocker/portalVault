-- ===========================================================================
-- 0105 — Der vollständige Plattform-Export, Teil 1: Historie und Dokument
--
-- WOFÜR. Production läuft auf Supabase Free. Dort gibt es keine nativen
-- Backups und kein PITR, und ein automatischer Lauf INNERHALB desselben
-- Projekts wäre ohnehin keine Sicherung, sondern eine zweite Kopie im selben
-- Brandabschnitt. Deshalb: ein MANUELLER vollständiger Export, den der
-- Plattformadmin auslöst und als Datei aus dem Projekt herausträgt. Diese
-- Migration liefert dafür zwei Dinge — die Historie der Läufe und das
-- Datenbankdokument. Mehr nicht.
--
-- WAS HIER AUSDRÜCKLICH NICHT DRINSTEHT: keine Route, keine Admin-Oberfläche,
-- keine Verbindung zum ZIP-Schreiber, kein Storage-Download, kein
-- auth.users-Inventar, kein Erinnerungsmechanismus, kein Restore. Diese
-- Funktion erzeugt genau eine Datei des späteren Archivs: `database.json`.
--
-- ZWEI GETRENNTE SYSTEME. `0104`/`seller_business_backup()` ist der Export
-- DES BETRIEBS — was yulez.collectibles über sein eigenes Geschäft mitnehmen
-- können muss. Dieses hier ist der Export DER PLATTFORM — alles, was nötig
-- wäre, um SkyIsles neu aufzubauen. Sie überschneiden sich inhaltlich, aber
-- sie haben verschiedene Leser, verschiedene Feldregeln und verschiedene
-- Wächter. `0104` bleibt unverändert; nichts hier fasst es an.
--
-- DIE AUSWAHL STEHT NICHT HIER, SONDERN IN
-- `src/lib/backup/platform-manifest.ts`. 53 Bereiche,
-- 486 Felder insgesamt — davon 4 gebildete —, 9 ganz ausgeschlossene Tabellen und
-- 33 global gesperrte Felder. Der Rumpf unten wurde aus dem Manifest
-- ERZEUGT, nicht abgeschrieben; `platform-sql.test.ts` vergleicht beide
-- Seiten Feld für Feld. Laufen sie auseinander, wird der Test rot — und die
-- Reparatur ist eine bewusste Entscheidung, nicht ein stilles Angleichen.
--
-- WARUM DER `data`-BLOCK AUS SECHS TEILEN BESTEHT
--
-- PostgreSQL nimmt höchstens 100 Argumente pro Funktionsaufruf
-- (`FUNC_MAX_ARGS`). 53 Bereiche als Schlüssel/Wert-Paare sind 106
-- Argumente — ein einziges `jsonb_build_object()` scheitert daran mit
-- `54023`, und zwar schon beim Anlegen der Funktion, weil Postgres
-- SQL-Rümpfe sofort analysiert. Deshalb sechs Aufrufe, geschnitten genau
-- entlang der Gruppen, in die `PLATFORM_SECTIONS` ohnehin gegliedert ist:
--   Katalog                   6 Bereiche · 12 Argumente
--   Nutzer und Sammlung       2 Bereiche ·  4 Argumente
--   Seller und Shop          10 Bereiche · 20 Argumente
--   Lager und Orderbuch      12 Bereiche · 24 Argumente
--   Bestellungen             18 Bereiche · 36 Argumente
--   Tester                    5 Bereiche · 10 Argumente
--
-- Zusammengesetzt mit `||`. Das ist KEINE zweite Abfrage und KEIN zweiter
-- Moment: `||` auf zwei `jsonb`-Objekten mischt nur die Schlüssel, alles
-- bleibt EIN Ausdruck in EINER Anweisung. Das Ergebnisdokument ist identisch
-- zur einteiligen Fassung — `jsonb` speichert Schlüssel ohnehin sortiert,
-- die Gruppierung ist in der Ausgabe nicht sichtbar. `platform-sql.test.ts`
-- analysiert die Aufrufe klammerweise und hält jeden unter 80 Argumenten,
-- damit diese Grenze nicht ein zweites Mal überrascht.
--
-- WARUM EINE EINZIGE ANWEISUNG. `language sql` mit genau einem `select`:
-- ein Statement sieht genau eine MVCC-Momentaufnahme. Jeder Bereich stammt
-- damit aus demselben Augenblick, ohne `begin`, ohne Isolationsstufe, ohne
-- Sperre. Käme während des Exports eine Bestellung an, enthielte die Datei
-- sie entweder ganz oder gar nicht, aber niemals eine Bewegung ohne ihre
-- Bestellung.
--
-- `pg_current_snapshot()` UND NICHT `txid_current()`. Die erste ist
-- `stable` und liest nur; die zweite ist `volatile` und VERGIBT eine
-- Transaktionsnummer — ein Schreibvorgang in einer Funktion, die keiner sein
-- darf.
--
-- GELD ALS TEXT. Jeder Betrag wird `::text` ausgegeben, nicht als
-- JSON-Zahl. `jsonb` kennt nur `numeric`, aber jeder Leser danach hat einen
-- Gleitkommatyp, und aus `7.85` wird irgendwo `7.849999999999999`.
--
-- WER FRAGEN DARF. `is_platform_admin()` als erste Bedingung. Für alle
-- anderen `null` — nicht ein Fehler: „nicht deins" und „nichts vorhanden"
-- sollen gleich aussehen. Kein `anon`, kein `public`, keine
-- Service-Role-Freigabe: die spätere Route läuft in der Sitzung des Admins,
-- also reicht `authenticated` plus der Wächter im Rumpf.
--
-- KEINE GEHEIMNISSE. `client_salt`, Stripe- und Resend-Kennungen,
-- Zahlungstoken, Kartenschnappschüsse und sämtliche Auth-Token stehen im
-- Manifest unter `PLATFORM_FORBIDDEN_FIELDS` und kommen in keinem Bereich
-- vor. `auth.*` wird hier überhaupt nicht gelesen.
--
-- KEINE LEGACY-TABELLEN. `legacy_stock_events`, `inventory_imports`,
-- `inventory_import_rows` und `inventory_import_mappings` fehlen
-- absichtlich. Ein Backup, das sie enthielte, lüde irgendwann jemanden ein,
-- sie zurückzuspielen — und genau dieser Weg ist dauerhaft verboten.
--
-- RÜCKBAU.
--   drop function if exists public.system_platform_export();
--   drop table if exists public.platform_export_runs;
-- Es wird nichts migriert, nichts überschrieben und nichts gelöscht.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Die Historie der Läufe
--
-- WARUM SO WENIG. Diese Tabelle beantwortet genau eine Frage: „Wann lag
-- zuletzt eine vollständige Sicherung nachweislich außerhalb des Projekts?"
-- Alles, was diese Frage nicht beantwortet, steht nicht drin. Insbesondere
-- NICHT: das Archiv selbst, irgendein JSON, Käuferdaten, Auth-Daten,
-- Storage-Pfade, Datenbankfehlermeldungen, Stacktraces, freier Fehlertext,
-- Geheimnisse jeder Art. Ein Fehlschlag wird als STUFE festgehalten, nicht
-- als Text — eine Meldung aus Postgres kann Werte aus Zeilen enthalten.
--
-- DREI ZUSTÄNDE, KEIN „HERUNTERGELADEN".
--   generated — das Archiv wurde erzeugt und ausgeliefert. Ob es beim
--               Empfänger heil ankam, weiß der Server hier noch nicht.
--   received  — der Admin hat die Datei bestätigt; erst das zählt als
--               Sicherung außerhalb des Projekts.
--   failed    — die Erzeugung oder die Bestätigung ist gescheitert.
-- „downloaded" wäre eine Behauptung über einen Browservorgang, den der
-- Server nicht beobachten kann.
--
-- ZEITEN. `created_at` ist der Versuch, `received_at` die Bestätigung. Ein
-- eigenes `generated_at` wäre stets gleich `created_at` (die Zeile
-- entsteht, wenn das Archiv fertig ist), und ein `failed_at` wäre entweder
-- gleich `created_at` oder — beim Scheitern der Bestätigung — der Moment,
-- in dem `received_at` gerade nicht gesetzt wird. Zwei Zeitstempel tragen
-- also alles, was drei tragen würden.
--
-- KEIN `created_by`. Es gibt genau einen Plattformadmin; eine Kontokennung
-- neben jedem Lauf wäre ein Personenbezug ohne Erkenntnisgewinn.
--
-- KEIN `format`. Es gäbe genau einen Wert. `format_version` allein
-- benennt den Vertrag; eine zweite Formatfamilie bekäme die Spalte dann,
-- wenn es sie gibt.
--
-- ZUGRIFF. RLS an, keine Policy, keine Grants. Diese Tabelle ist von außen
-- vollständig geschlossen; der Weg hinein führt ausschließlich über
-- `security definer`-Funktionen, die mit der Route kommen. Das ist Absicht:
-- eine Historie, die ein Client direkt schreiben kann, ist keine.
-- ---------------------------------------------------------------------------

create table if not exists public.platform_export_runs (
  id bigint generated always as identity primary key,

  -- generated | received | failed. Siehe oben.
  status text not null,

  -- Der Versuch.
  created_at timestamptz not null default now(),

  -- Die Bestätigung des Admins, dass die Datei angekommen und lesbar ist.
  -- Nur hier entsteht die Aussage „liegt außerhalb".
  received_at timestamptz,

  -- Welcher Vertrag. Bestimmt, wie ein späterer Leser die Datei deutet.
  format_version integer,

  -- Staging oder Production. Ohne das lässt sich eine Historie nicht lesen,
  -- sobald jemand beide Umgebungen kennt. Die Projektreferenz ist öffentlich
  -- (sie steht in NEXT_PUBLIC_SUPABASE_URL) und kein Geheimnis.
  source_project text,

  -- Plausibilität der Datei. Die Größe fällt auf, wenn ein Export plötzlich
  -- ein Zehntel wiegt; der Hash ist das, was der Admin gegenprüft.
  size_bytes bigint,
  sha256 text,

  -- Gezählt am tatsächlichen Dokument, nicht aus dem Code übernommen.
  -- Weicht section_count von der Manifestgröße ab, ist etwas verloren
  -- gegangen.
  section_count integer,

  -- Wie viele Storage-Objekte im Archiv liegen und wie viele laut
  -- Objektliste fehlten. Ein Backup mit Lücke soll als solches erkennbar
  -- sein, statt still vollständig zu wirken.
  storage_file_count integer,
  storage_missing_count integer,

  -- Wo es abbrach — als Stufe aus einer festen Liste, nie als Fehlertext.
  failure_stage text,

  constraint platform_export_runs_status_known
    check (status in ('generated', 'received', 'failed')),

  -- „received" und „received_at" sagen dasselbe; sie dürfen nicht
  -- auseinanderlaufen.
  constraint platform_export_runs_received_matches_status
    check ((status = 'received') = (received_at is not null)),

  -- Ein erfolgreicher Lauf hat eine Datei, und eine Datei hat Kennzahlen.
  constraint platform_export_runs_success_is_measured
    check (
      status = 'failed'
      or (format_version is not null and source_project is not null
          and size_bytes is not null and sha256 is not null
          and section_count is not null and storage_file_count is not null
          and storage_missing_count is not null)
    ),

  constraint platform_export_runs_failure_stage_known
    check (
      failure_stage is null
      or failure_stage in ('database', 'auth_inventory', 'storage_manifest',
                           'storage_files', 'archive', 'confirmation')
    ),

  constraint platform_export_runs_failure_stage_only_on_failure
    check (status = 'failed' or failure_stage is null),

  -- Hexadezimal, 64 Zeichen, klein geschrieben. Ein Hash in anderer Form ist
  -- ein Vergleich, der später scheitert.
  constraint platform_export_runs_sha256_shape
    check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),

  constraint platform_export_runs_source_project_shape
    check (source_project is null or source_project ~ '^[a-z0-9]{8,64}$'),

  constraint platform_export_runs_counts_are_sane
    check (
      coalesce(size_bytes, 0) >= 0
      and coalesce(format_version, 1) > 0
      and coalesce(section_count, 0) >= 0
      and coalesce(storage_file_count, 0) >= 0
      and coalesce(storage_missing_count, 0) >= 0
    )
);

comment on table public.platform_export_runs is
  'One row per manual platform export (0105). It answers exactly one question: when did a complete backup last provably leave this project? Three states — generated (archive built and served), received (the admin confirmed the file), failed. No "downloaded": the server cannot observe a browser. Deliberately holds no archive, no JSON, no buyer or auth data, no storage paths, no database error text and no secrets; a failure is recorded as a stage, never as a message. RLS is on with no policy and no grants: the only way in is through the security-definer functions that arrive with the route.';

comment on column public.platform_export_runs.received_at is
  'Set only when the admin confirms the downloaded file. This, not created_at, is the moment a backup counts as held outside the project.';

comment on column public.platform_export_runs.failure_stage is
  'A stage from a fixed list, never free text: a Postgres message can carry row values.';

alter table public.platform_export_runs enable row level security;

-- Supabase grants the public schema to anon/authenticated by default. This
-- table is closed even to them; nothing but a definer function reaches it.
revoke all on table public.platform_export_runs from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. Das Datenbankdokument — `database.json`
--
-- Genau 53 Bereiche unter `data`, dazu die wenigen Angaben, die nur
-- die Datenbank kennt. Alles Übrige des späteren `manifest.json` —
-- Dateiliste, Auth-Anzahl, Storage-Zählungen, Prüfsummen — füllt die Route;
-- `PLATFORM_METADATA_SOURCE` im Manifest hält fest, welche Seite welches
-- Feld liefert. Ein Postgres kennt seine Supabase-Projektreferenz nicht, und
-- ein Feld, das so aussähe, als wüsste es sie, wäre schlimmer als keines.
-- ---------------------------------------------------------------------------

create or replace function public.system_platform_export()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.is_platform_admin() then null else jsonb_build_object(

    /* ---- Was nur die Datenbank weiß --------------------------------- */
    'format',         'skyisles-platform-backup',
    'format_version', 1,
    'created_at',     now(),
    'commerce_mode',  (select s.mode from public.commerce_settings s limit 1),
    'snapshot_txid',  pg_current_snapshot()::text,

    /* ---- Die Bereiche, in sechs Gruppen wegen FUNC_MAX_ARGS ---------- */
    'data', (
      /* ---- Katalog — 6 Bereiche, 12 Argumente ---- */
      jsonb_build_object(
        'skylanders', coalesce((
          select jsonb_agg(jsonb_build_object(
            'sky_id', t.sky_id,
            'name', t.name,
            'slug', t.slug,
            'series_code', t.series_code,
            'category_id', t.category_id,
            'market_price', t.market_price::text,
            'price_updated_at', t.price_updated_at,
            'image_file', t.image_file,
            'image_override_path', t.image_override_path,
            'is_active', t.is_active,
            'catalog_visible', t.catalog_visible,
            'display_name_override', t.display_name_override,
            'card_type', t.card_type,
            'source', t.source,
            'character_id', t.character_id,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.sky_id)
            from public.skylanders t
        ), '[]'::jsonb),

        'series', coalesce((
          select jsonb_agg(jsonb_build_object(
            'code', t.code,
            'label', t.label,
            'release_year', t.release_year,
            'position', t.position,
            'created_at', t.created_at
          ) order by t.code)
            from public.series t
        ), '[]'::jsonb),

        'categories', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'series_code', t.series_code,
            'position', t.position,
            'name', t.name,
            'catalog_group', t.catalog_group,
            'created_at', t.created_at
          ) order by t.id)
            from public.categories t
        ), '[]'::jsonb),

        'characters', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'canonical_name', t.canonical_name,
            'element', t.element,
            'species', t.species,
            'role_type', t.role_type,
            'short_description', t.short_description,
            'source_url', t.source_url,
            'source_label', t.source_label,
            'verified_at', t.verified_at,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.characters t
        ), '[]'::jsonb),

        'catalog_editorial', coalesce((
          select jsonb_agg(jsonb_build_object(
            'sky_id', t.sky_id,
            'admin_note', t.admin_note,
            'updated_at', t.updated_at
          ) order by t.sky_id)
            from public.catalog_editorial t
        ), '[]'::jsonb),

        'catalog_admin_changes', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'entity', t.entity,
            'entity_id', t.entity_id,
            'field', t.field,
            'old_value', t.old_value,
            'new_value', t.new_value,
            'changed_at', t.changed_at
          ) order by t.id)
            from public.catalog_admin_changes t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Nutzer und Sammlung — 2 Bereiche, 4 Argumente ---- */
      jsonb_build_object(
        'profiles', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'username', t.username,
            'display_name', t.display_name,
            'country', t.country,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.profiles t
        ), '[]'::jsonb),

        'collection_items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'user_id', t.user_id,
            'sky_id', t.sky_id,
            'quantity', t.quantity,
            'note', t.note,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.collection_items t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Seller und Shop — 10 Bereiche, 20 Argumente ---- */
      jsonb_build_object(
        'sellers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'display_name', t.display_name,
            'legal_name', t.legal_name,
            'trading_name', t.trading_name,
            'legal_form', t.legal_form,
            'street', t.street,
            'postal_code', t.postal_code,
            'city', t.city,
            'country_code', t.country_code,
            'phone', t.phone,
            'direct_contact', t.direct_contact,
            'register_court', t.register_court,
            'register_number', t.register_number,
            'vat_id', t.vat_id,
            'w_id', t.w_id,
            'contact_email', t.contact_email,
            'transactional_reply_to', t.transactional_reply_to,
            'withdrawal_contact_email', t.withdrawal_contact_email,
            'complaints_contact_email', t.complaints_contact_email,
            'small_business_19', t.small_business_19,
            'dispute_participation', t.dispute_participation,
            'dispute_body', t.dispute_body,
            'return_postage_borne_by', t.return_postage_borne_by,
            'dispatch_statement', t.dispatch_statement,
            'free_shipping_threshold', t.free_shipping_threshold::text,
            'is_active', t.is_active,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.sellers t
        ), '[]'::jsonb),

        'seller_operators', coalesce((
          select jsonb_agg(jsonb_build_object(
            'seller_id', t.seller_id,
            'user_id', t.user_id,
            'is_enabled', t.is_enabled,
            'note', t.note,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.user_id)
            from public.seller_operators t
        ), '[]'::jsonb),

        'shop_admins', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'granted_at', t.granted_at,
            'note', t.note
          ) order by t.user_id)
            from public.shop_admins t
        ), '[]'::jsonb),

        'platform_admins', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'created_at', t.created_at,
            'note', t.note
          ) order by t.user_id)
            from public.platform_admins t
        ), '[]'::jsonb),

        'shop_settings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'price_percentage', t.price_percentage::text,
            'free_shipping_threshold', t.free_shipping_threshold::text,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.shop_settings t
        ), '[]'::jsonb),

        'platform_settings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'contact_email', t.contact_email,
            'support_email', t.support_email,
            'catalog_market_boost_percent', t.catalog_market_boost_percent::text,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.platform_settings t
        ), '[]'::jsonb),

        'commerce_settings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'mode', t.mode,
            'max_open_checkouts', t.max_open_checkouts,
            'max_reserved_units', t.max_reserved_units,
            'max_orders_per_hour', t.max_orders_per_hour,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.commerce_settings t
        ), '[]'::jsonb),

        'shipping_methods', coalesce((
          select jsonb_agg(jsonb_build_object(
            'code', t.code,
            'name', t.name,
            'base_price', t.base_price::text,
            'is_enabled', t.is_enabled,
            'sort_order', t.sort_order,
            'updated_at', t.updated_at
          ) order by t.code)
            from public.shipping_methods t
        ), '[]'::jsonb),

        'shipping_countries', coalesce((
          select jsonb_agg(jsonb_build_object(
            'country_code', t.country_code,
            'label', t.label,
            'is_enabled', t.is_enabled,
            'sort_order', t.sort_order,
            'updated_at', t.updated_at
          ) order by t.country_code)
            from public.shipping_countries t
        ), '[]'::jsonb),

        'legal_document_versions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'slug', t.slug,
            'version', t.version,
            'effective_from', t.effective_from,
            'updated_at', t.updated_at
          ) order by t.slug)
            from public.legal_document_versions t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Lager und Orderbuch — 12 Bereiche, 24 Argumente ---- */
      jsonb_build_object(
        'shop_inventory', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sky_id', t.sky_id,
            'condition', t.condition,
            'quantity', t.quantity,
            'reserved', t.reserved,
            'available_quantity', t.available_quantity,
            'sale_price', t.sale_price::text,
            'is_listed', t.is_listed,
            'note', t.note,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.shop_inventory t
        ), '[]'::jsonb),

        'inventory_movements', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'inventory_id', t.inventory_id,
            'delta', t.delta,
            'reason', t.reason,
            'unit_cost', t.unit_cost::text,
            'currency', t.currency,
            'note', t.note,
            'created_at', t.created_at,
            'sky_id', inv.sky_id,
            'condition', inv.condition
          ) order by t.id)
            from public.inventory_movements t
          left join public.shop_inventory inv on inv.id = t.inventory_id
        ), '[]'::jsonb),

        'purchases', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'purchased_at', t.purchased_at,
            'total_cost', t.total_cost::text,
            'currency', t.currency,
            'source', t.source,
            'external_ref', t.external_ref,
            'note', t.note,
            'is_test', t.is_test,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.purchases t
        ), '[]'::jsonb),

        'purchase_items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'purchase_id', t.purchase_id,
            'position', t.position,
            'sky_id', t.sky_id,
            'condition', t.condition,
            'raw_name', t.raw_name,
            'state', t.state,
            'market_price_snapshot', t.market_price_snapshot::text,
            'market_price_snapshot_at', t.market_price_snapshot_at,
            'market_price_source', t.market_price_source,
            'movement_id', t.movement_id,
            'note', t.note,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.purchase_items t
        ), '[]'::jsonb),

        'sales', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'channel', t.channel,
            'order_id', t.order_id,
            'sold_at', t.sold_at,
            'shipped_at', t.shipped_at,
            'destination_country_code', t.destination_country_code,
            'currency', t.currency,
            'items_subtotal', t.items_subtotal::text,
            'shipping_charged', t.shipping_charged::text,
            'discount_amount', t.discount_amount::text,
            'reported_payout_amount', t.reported_payout_amount::text,
            'reported_payout_ref', t.reported_payout_ref,
            'reported_payout_at', t.reported_payout_at,
            'buy_in_factor_snapshot', t.buy_in_factor_snapshot::text,
            'external_order_ref', t.external_order_ref,
            'buyer_ref', t.buyer_ref,
            'note', t.note,
            'source', t.source,
            'is_test', t.is_test,
            'cancelled_at', t.cancelled_at,
            'stock_released_at', t.stock_released_at,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.sales t
        ), '[]'::jsonb),

        'sale_items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sale_id', t.sale_id,
            'position', t.position,
            'sky_id', t.sky_id,
            'raw_name', t.raw_name,
            'condition', t.condition,
            'market_price_snapshot', t.market_price_snapshot::text,
            'market_price_snapshot_at', t.market_price_snapshot_at,
            'movement_id', t.movement_id,
            'returned_at', t.returned_at,
            'return_movement_id', t.return_movement_id,
            'settled_at', t.settled_at,
            'not_shipped_at', t.not_shipped_at,
            'return_announced_at', t.return_announced_at,
            'note', t.note,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.sale_items t
        ), '[]'::jsonb),

        'sale_fees', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sale_id', t.sale_id,
            'kind', t.kind,
            'label', t.label,
            'amount', t.amount::text,
            'settled_by', t.settled_by,
            'note', t.note,
            'created_at', t.created_at
          ) order by t.id)
            from public.sale_fees t
        ), '[]'::jsonb),

        'sale_refunds', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sale_id', t.sale_id,
            'amount', t.amount::text,
            'occurred_at', t.occurred_at,
            'reason', t.reason,
            'external_ref', t.external_ref,
            'note', t.note,
            'created_at', t.created_at
          ) order by t.id)
            from public.sale_refunds t
        ), '[]'::jsonb),

        'settlement_adjustments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sale_id', t.sale_id,
            'channel', t.channel,
            'amount', t.amount::text,
            'reason', t.reason,
            'external_ref', t.external_ref,
            'note', t.note,
            'occurred_at', t.occurred_at,
            'source', t.source,
            'created_at', t.created_at
          ) order by t.id)
            from public.settlement_adjustments t
        ), '[]'::jsonb),

        'orderbook_name_mappings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'normalised_name', t.normalised_name,
            'sky_id', t.sky_id,
            'not_a_figure', t.not_a_figure,
            'sample_raw_name', t.sample_raw_name,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.orderbook_name_mappings t
        ), '[]'::jsonb),

        'orderbook_audit', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sale_id', t.sale_id,
            'entity_type', t.entity_type,
            'entity_id', t.entity_id,
            'action', t.action,
            'field', t.field,
            'old_value', t.old_value,
            'new_value', t.new_value,
            'changed_at', t.changed_at
          ) order by t.id)
            from public.orderbook_audit t
        ), '[]'::jsonb),

        'seller_monthly_reports', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'period_year', t.period_year,
            'period_month', t.period_month,
            'commerce_mode', t.commerce_mode,
            'finalized_at', t.finalized_at,
            'order_count', t.order_count,
            'order_value', t.order_value::text,
            'merchandise_amount', t.merchandise_amount::text,
            'shipping_amount', t.shipping_amount::text,
            'discount_amount', t.discount_amount::text,
            'currency', t.currency,
            'paid_count', t.paid_count,
            'unpaid_count', t.unpaid_count,
            'tax_regime', t.tax_regime,
            'included_orders', t.included_orders
          ) order by t.id)
            from public.seller_monthly_reports t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Bestellungen — 18 Bereiche, 36 Argumente ---- */
      jsonb_build_object(
        'orders', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_number', t.order_number,
            'user_id', t.user_id,
            'customer_email', t.customer_email,
            'currency', t.currency,
            'items_subtotal', t.items_subtotal::text,
            'shipping_amount', t.shipping_amount::text,
            'discount_amount', t.discount_amount::text,
            'total_amount', t.total_amount::text,
            'payment_status', t.payment_status,
            'fulfillment_status', t.fulfillment_status,
            'needs_resolution', t.needs_resolution,
            'placed_at', t.placed_at,
            'paid_at', t.paid_at,
            'shipped_at', t.shipped_at,
            'completed_at', t.completed_at,
            'cancelled_at', t.cancelled_at,
            'updated_at', t.updated_at,
            'tax_regime', t.tax_regime,
            'shipping_method_code', t.shipping_method_code,
            'shipping_method_name', t.shipping_method_name,
            'tracking_number', t.tracking_number,
            'commerce_mode', t.commerce_mode
          ) order by t.id)
            from public.orders t
        ), '[]'::jsonb),

        'order_lines', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'sky_id', t.sky_id,
            'condition', t.condition,
            'quantity', t.quantity,
            'name_snapshot', t.name_snapshot,
            'image_snapshot', t.image_snapshot,
            'series_snapshot', t.series_snapshot,
            'unit_price', t.unit_price::text,
            'discount_amount', t.discount_amount::text,
            'line_total', t.line_total::text,
            'inventory_id', t.inventory_id,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_lines t
        ), '[]'::jsonb),

        'order_addresses', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'kind', t.kind,
            'first_name', t.first_name,
            'last_name', t.last_name,
            'company', t.company,
            'street', t.street,
            'house_number', t.house_number,
            'address_line_2', t.address_line_2,
            'postal_code', t.postal_code,
            'city', t.city,
            'country_code', t.country_code,
            'phone', t.phone,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_addresses t
        ), '[]'::jsonb),

        'order_events', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'event_type', t.event_type,
            'actor_kind', t.actor_kind,
            'payload', t.payload,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_events t
        ), '[]'::jsonb),

        'order_line_events', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'order_line_id', t.order_line_id,
            'kind', t.kind,
            'quantity', t.quantity,
            'stock_outcome', t.stock_outcome,
            'movement_id', t.movement_id,
            'correction_movement_id', t.correction_movement_id,
            'occurred_at', t.occurred_at,
            'reason', t.reason,
            'reason_code', t.reason_code,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_line_events t
        ), '[]'::jsonb),

        'order_reservations', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'inventory_id', t.inventory_id,
            'quantity', t.quantity,
            'state', t.state,
            'reserved_at', t.reserved_at,
            'expires_at', t.expires_at,
            'released_at', t.released_at,
            'converted_at', t.converted_at,
            'movement_id', t.movement_id,
            'reverted_movement_id', t.reverted_movement_id,
            'sky_id', inv.sky_id,
            'condition', inv.condition
          ) order by t.id)
            from public.order_reservations t
          left join public.shop_inventory inv on inv.id = t.inventory_id
        ), '[]'::jsonb),

        'order_refunds', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'amount', t.amount::text,
            'currency', t.currency,
            'occurred_at', t.occurred_at,
            'reason', t.reason,
            'withdrawal_request_id', t.withdrawal_request_id,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_refunds t
        ), '[]'::jsonb),

        'order_refund_allocations', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'refund_id', t.refund_id,
            'order_line_id', t.order_line_id,
            'quantity', t.quantity,
            'amount', t.amount::text,
            'allocation_type', t.allocation_type
          ) order by t.id)
            from public.order_refund_allocations t
        ), '[]'::jsonb),

        'order_legal_snapshots', coalesce((
          select jsonb_agg(jsonb_build_object(
            'order_id', t.order_id,
            'agb_version', t.agb_version,
            'widerruf_version', t.widerruf_version,
            'seller_name', t.seller_name,
            'seller_legal_name', t.seller_legal_name,
            'seller_street', t.seller_street,
            'seller_postal_code', t.seller_postal_code,
            'seller_city', t.seller_city,
            'seller_country_code', t.seller_country_code,
            'seller_email', t.seller_email,
            'seller_vat_id', t.seller_vat_id,
            'created_at', t.created_at
          ) order by t.order_id)
            from public.order_legal_snapshots t
        ), '[]'::jsonb),

        'order_messages', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'author_kind', t.author_kind,
            'body', t.body,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_messages t
        ), '[]'::jsonb),

        'order_conversation_reads', coalesce((
          select jsonb_agg(jsonb_build_object(
            'order_id', t.order_id,
            'reader', t.reader,
            'last_read_at', t.last_read_at
          ) order by t.order_id, t.reader)
            from public.order_conversation_reads t
        ), '[]'::jsonb),

        'order_attention_reads', coalesce((
          select jsonb_agg(jsonb_build_object(
            'order_id', t.order_id,
            'reader', t.reader,
            'last_read_at', t.last_read_at
          ) order by t.order_id, t.reader)
            from public.order_attention_reads t
        ), '[]'::jsonb),

        'order_mail', coalesce((
          select jsonb_agg(jsonb_build_object(
            'order_id', t.order_id,
            'kind', t.kind,
            'ref', t.ref,
            'state', t.state,
            'claimed_at', t.claimed_at,
            'sent_at', t.sent_at,
            'attempts', t.attempts,
            'last_error', t.last_error,
            'updated_at', t.updated_at
          ) order by t.order_id, t.kind, coalesce(t.ref, ''))
            from public.order_mail t
        ), '[]'::jsonb),

        'invoices', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'invoice_number', t.invoice_number,
            'issued_at', t.issued_at,
            'seller_legal_name', t.seller_legal_name,
            'seller_trade_name', t.seller_trade_name,
            'seller_street', t.seller_street,
            'seller_postal_code', t.seller_postal_code,
            'seller_city', t.seller_city,
            'seller_country', t.seller_country,
            'seller_email', t.seller_email,
            'seller_vat_id', t.seller_vat_id,
            'customer_name', t.customer_name,
            'customer_company', t.customer_company,
            'customer_street', t.customer_street,
            'customer_postal_code', t.customer_postal_code,
            'customer_city', t.customer_city,
            'customer_country', t.customer_country,
            'customer_email', t.customer_email,
            'items_subtotal', t.items_subtotal::text,
            'shipping_amount', t.shipping_amount::text,
            'discount_amount', t.discount_amount::text,
            'total_amount', t.total_amount::text,
            'currency', t.currency,
            'tax_regime', t.tax_regime,
            'lines', t.lines
          ) order by t.id)
            from public.invoices t
        ), '[]'::jsonb),

        'customer_contacts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'email', t.email,
            'first_name', t.first_name,
            'last_name', t.last_name,
            'company', t.company,
            'street', t.street,
            'house_number', t.house_number,
            'address_line_2', t.address_line_2,
            'postal_code', t.postal_code,
            'city', t.city,
            'country_code', t.country_code,
            'phone', t.phone,
            'updated_at', t.updated_at
          ) order by t.user_id)
            from public.customer_contacts t
        ), '[]'::jsonb),

        'payment_attempts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'provider', t.provider,
            'status', t.status,
            'amount', t.amount::text,
            'currency', t.currency,
            'created_at', t.created_at,
            'updated_at', t.updated_at,
            'paid_at', t.paid_at,
            'failed_at', t.failed_at
          ) order by t.id)
            from public.payment_attempts t
        ), '[]'::jsonb),

        'payment_events', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'provider', t.provider,
            'event_type', t.event_type,
            'payment_attempt_id', t.payment_attempt_id,
            'order_id', t.order_id,
            'received_at', t.received_at,
            'processed_at', t.processed_at,
            'outcome', t.outcome
          ) order by t.id)
            from public.payment_events t
        ), '[]'::jsonb),

        'withdrawal_requests', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'consumer_name', t.consumer_name,
            'contact_email', t.contact_email,
            'declaration', t.declaration,
            'received_at', t.received_at,
            'receipt_state', t.receipt_state,
            'receipt_sent_at', t.receipt_sent_at,
            'handled_at', t.handled_at,
            'receipt_attempt_at', t.receipt_attempt_at
          ) order by t.id)
            from public.withdrawal_requests t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Tester — 5 Bereiche, 10 Argumente ---- */
      jsonb_build_object(
        'testers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'note', t.note,
            'created_at', t.created_at
          ) order by t.user_id)
            from public.testers t
        ), '[]'::jsonb),

        'tester_permissions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'permission', t.permission,
            'granted_at', t.granted_at
          ) order by t.user_id, t.permission)
            from public.tester_permissions t
        ), '[]'::jsonb),

        'tester_features', coalesce((
          select jsonb_agg(jsonb_build_object(
            'key', t.key,
            'label', t.label,
            'description', t.description,
            'position', t.position
          ) order by t.key)
            from public.tester_features t
        ), '[]'::jsonb),

        'tester_permission_changes', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'user_id', t.user_id,
            'permission', t.permission,
            'action', t.action,
            'changed_at', t.changed_at
          ) order by t.id)
            from public.tester_permission_changes t
        ), '[]'::jsonb),

        'commerce_testers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'note', t.note,
            'granted_at', t.granted_at
          ) order by t.user_id)
            from public.commerce_testers t
        ), '[]'::jsonb)
      )
    )
  ) end;
$$;

comment on function public.system_platform_export() is
  'The database half of one complete platform backup as a single JSON document (0105) — the archive file database.json. 53 sections in one statement, so every one of them comes from the same MVCC snapshot; money is rendered as text so no reader turns 7.85 into a float. The data object is assembled from six jsonb_build_object calls joined with ||, because PostgreSQL takes at most 100 arguments per call and 53 sections are 106; that is one expression in one statement, not a second query. The selection lives in src/lib/backup/platform-manifest.ts and is enforced from both sides by platform-sql.test.ts. Export, never synchronisation: it writes nothing, reads no auth table, and carries none of the legacy Excel import tables. V1 supports no restore — format_version is the contract that keeps one possible.';

revoke all on function public.system_platform_export() from public, anon;
grant execute on function public.system_platform_export() to authenticated;
