/**
 * Was in eine vollständige Plattformsicherung gehört (V1).
 *
 * ZWEI FORMATE, ZWEI VERANTWORTUNGEN. `manifest.ts` beschreibt den
 * **Business-Export**: was ein Händler von seinen eigenen Geschäftsdaten
 * herunterlädt. Diese Datei beschreibt den **Platform-Export**: was SkyIsles
 * als Plattform braucht, um sich nach einem Totalverlust wieder aufbauen zu
 * können. Der eine gehört dem Händler, der andere dem Plattformbetreiber,
 * und sie werden nicht vermischt — deshalb eine eigene Datei und nicht ein
 * Feld im bestehenden Vertrag. `manifest.ts` bleibt unverändert, weil
 * `backup-sql.test.ts` es Feld für Feld gegen die eingefrorene `0104` hält.
 *
 * WARUM ES DEN PLATFORM-EXPORT ÜBERHAUPT GIBT. Production läuft auf Supabase
 * Free: **keine nativen Backups, kein PITR**. Auf Anwendungsebene ist dieser
 * Export damit die einzige Absicherung, die wir selbst in der Hand haben.
 *
 * ER IST TROTZDEM KEIN INFRASTRUKTUR-BACKUP, und das darf nirgends anders
 * dargestellt werden. Er kennt kein Schema, keine Funktionen, keine Policies,
 * keine Sequenzstände und **keine Passwörter**. Er ist eine vollständige,
 * lesbare Datenkopie — kein Wiederherstellungspunkt.
 *
 * DREI TEILE MIT DREI VERSCHIEDENEN GRADEN VON VOLLSTÄNDIGKEIT:
 *
 *   Datenbank         vollständige Zeilen. Wiederherstellbar.
 *   Auth-Inventar     WER existierte, nicht WIE er sich anmeldet. Siehe
 *                     AUTH_INVENTORY — ein Inventar, kein Auth-Backup.
 *   Storage           Metadaten UND die Dateien selbst. Vollständig.
 *
 * KEIN RESTORE. `restore_supported` ist `false`, und das bleibt so, bis es
 * einen eigenen, validierten Restore-Vertrag gibt.
 *
 * Rein beschreibend: keine Abhängigkeiten außer den geteilten Typen, kein
 * Datenbankzugriff, keine Seiteneffekte.
 */
import type { BackupSection } from "./manifest";

export const PLATFORM_FORMAT = "skyisles-platform-backup";

/**
 * Erhöht sich, wenn sich die **Bedeutung** bestehender Daten ändert oder ein
 * Bereich unverträglich verändert oder entfernt wird. Ein zusätzliches Feld
 * oder ein zusätzlicher Bereich erhöht sie **nicht** — dieselbe Regel wie
 * beim Business-Export.
 */
export const PLATFORM_FORMAT_VERSION = 1;

/* -------------------------------------------------------------------------
 * Auth — ein Inventar, ausdrücklich kein Backup
 * ---------------------------------------------------------------------- */

/**
 * Was vom Konto mitkommt.
 *
 * Genug, um nach einem Wiederaufbau zu erkennen, **wer** existierte, und um
 * die Fremdschlüssel in `collection_items`, `orders` und `profiles` über die
 * E-Mail-Adresse wieder von Hand zuzuordnen.
 */
export const AUTH_INVENTORY_FIELDS = [
  "id", "email", "created_at", "last_sign_in_at", "email_confirmed_at",
  "provider", "banned_until",
] as const;

/**
 * WAS AUSDRÜCKLICH NICHT MITKOMMT — und warum der Export kein Auth-Backup ist.
 *
 * Ohne Passwortnachweis kann sich niemand anmelden. Das ist **Absicht**: ein
 * Passworthash in einer Datei auf einem Schreibtisch ist ein Angriffsziel,
 * kein Sicherheitsgewinn. Die Folge muss man aber aussprechen, statt sie zu
 * verschweigen: **Benutzerkonten lassen sich aus diesem Export nicht
 * wiederherstellen.** Nutzer müssten sich neu registrieren und bekämen neue
 * IDs; die alte Zuordnung stellt man über die E-Mail-Adresse her. Nur ein
 * Infrastruktur-Backup von Supabase kann Konten zurückbringen — und das
 * haben wir unter Free nicht.
 */
export const AUTH_FORBIDDEN_FIELDS: Readonly<Record<string, string>> = {
  encrypted_password: "Passwortnachweis — gehört in keine Datei",
  confirmation_token: "Einmaltoken",
  recovery_token: "Einmaltoken für die Passwortzurücksetzung",
  email_change_token_new: "Einmaltoken",
  email_change_token_current: "Einmaltoken",
  phone_change_token: "Einmaltoken",
  reauthentication_token: "Einmaltoken",
  raw_app_meta_data: "kann Anbietergeheimnisse tragen",
  raw_user_meta_data: "ungeprüfter Inhalt aus der Registrierung",
  identities: "Anbieteridentitäten samt Tokens",
  factors: "Zweiter Faktor",
  encrypted_secret: "TOTP-Geheimnis",
};

/** Die eine Aussage, die im Manifest der Datei stehen muss. */
export const AUTH_INVENTORY_DISCLAIMER =
  "Inventar, kein Auth-Backup: Benutzerkonten können hieraus nicht " +
  "wiederhergestellt werden. Passwörter und Tokens werden bewusst nicht " +
  "exportiert; eine Zuordnung nach einem Wiederaufbau erfolgt über die " +
  "E-Mail-Adresse.";

/* -------------------------------------------------------------------------
 * Storage — Metadaten UND Dateien
 * ---------------------------------------------------------------------- */

/** Je Objekt, aus `storage.objects` — im selben SQL-Schnappschuss. */
export const STORAGE_MANIFEST_FIELDS = [
  "bucket_id", "name", "size", "mimetype", "etag", "created_at", "updated_at",
] as const;

/**
 * Die Dateien selbst kommen mit.
 *
 * Eine Objektliste ist kein Backup: sie sagt, welches Bild fehlt, nicht
 * welches Bild es war. Die Bytes liegen im Archiv unter `storage/<bucket>/…`.
 *
 * Der Bucket `catalog` ist seit `0007` **öffentlich**. Die Dateien in ein
 * Admin-Archiv zu legen offenbart also nichts, was nicht ohnehin abrufbar
 * wäre — und es braucht dafür weder Service-Role-Schlüssel noch signierte
 * URL. Fehlt eine Datei beim Abruf, wird sie im Manifest als `missing`
 * vermerkt und der Export läuft weiter: ein fehlendes Bild darf eine
 * Sicherung nicht verhindern, aber es muss sichtbar sein.
 */
export const STORAGE_BUCKETS_INCLUDED = ["catalog"] as const;

/* -------------------------------------------------------------------------
 * Die Bereiche der Datenbank
 * ---------------------------------------------------------------------- */

/**
 * Klasse A: alles, was für einen Wiederaufbau gebraucht wird.
 *
 * Reihenfolge nach Sachgebiet, nicht alphabetisch — wer das liest, soll die
 * Plattform darin wiedererkennen.
 */
export const PLATFORM_SECTIONS: readonly BackupSection[] = [
  /* ---------------------------------------------------------- Katalog */
  {
    key: "skylanders",
    source: "skylanders",
    purpose:
      "Der VOLLSTÄNDIGE Katalog, nicht nur die gehandelten Figuren. Der " +
      "Business-Export führt eine Teilmenge; hier fehlt keine Zeile.",
    fields: ["sky_id", "name", "slug", "series_code", "category_id", "market_price",
             "price_updated_at", "image_file", "image_override_path", "is_active",
             "catalog_visible", "display_name_override", "card_type", "source",
             "character_id", "created_at", "updated_at"],
    restoreRelevant: true,
  },
  {
    key: "series",
    source: "series",
    purpose: "Die sechs Spiele als Ordnung des Katalogs.",
    fields: ["code", "label", "release_year", "position", "created_at"],
    restoreRelevant: true,
  },
  {
    key: "categories",
    source: "categories",
    purpose: "Die Kategorien je Serie.",
    fields: ["id", "series_code", "position", "name", "catalog_group", "created_at"],
    restoreRelevant: true,
  },
  {
    key: "characters",
    source: "characters",
    purpose:
      "Kuratierte Charaktermetadaten. ADR-0034: niemals aus Namen geraten — " +
      "einmal verloren, ist das Handarbeit.",
    fields: ["id", "canonical_name", "element", "species", "role_type",
             "short_description", "source_url", "source_label", "verified_at",
             "created_at", "updated_at"],
    restoreRelevant: true,
  },
  {
    key: "catalog_editorial",
    source: "catalog_editorial",
    purpose:
      "Interne Notizen zu Figuren. Bewusst getrennt von `skylanders`, weil " +
      "die Tabelle weltlesbar ist und ein Grant keine Spalten kennt.",
    fields: ["sky_id", "admin_note", "updated_at"],
    restoreRelevant: true,
  },
  {
    key: "catalog_admin_changes",
    source: "catalog_admin_changes",
    purpose: "Wer wann welche redaktionelle Spalte geändert hat.",
    fields: ["id", "entity", "entity_id", "field", "old_value", "new_value", "changed_at"],
    excluded: { changed_by: "Kontoidentität" },
    restoreRelevant: false,
  },

  /* ------------------------------------------------- Nutzer und Sammlung */
  {
    key: "profiles",
    source: "profiles",
    purpose: "Benutzername und Anzeigename. 1:1 zu auth.users.",
    fields: ["id", "username", "display_name", "country", "created_at", "updated_at"],
    excluded: { avatar_url: "Verweis auf eine Datei, die nicht Teil dieses Exports ist" },
    personalData: true,
    restoreRelevant: true,
  },
  {
    key: "collection_items",
    source: "collection_items",
    purpose:
      "DIE SAMMLUNGEN DER NUTZER. Rein nutzergeneriert, aus nichts " +
      "ableitbar — der schwerwiegendste Verlust, den ein Ausfall anrichten " +
      "könnte, und im Business-Export gar nicht enthalten.",
    fields: ["id", "user_id", "sky_id", "quantity", "note", "created_at", "updated_at"],
    personalData: true,
    restoreRelevant: true,
  },

  /* --------------------------------------------------- Seller und Shop */
  {
    key: "sellers",
    source: "sellers",
    purpose: "Die rechtliche Identität des Verkäufers, vollständig.",
    fields: ["id", "display_name", "legal_name", "trading_name", "legal_form", "street",
             "postal_code", "city", "country_code", "phone", "direct_contact",
             "register_court", "register_number", "vat_id", "w_id", "contact_email",
             "transactional_reply_to", "withdrawal_contact_email",
             "complaints_contact_email", "small_business_19", "dispute_participation",
             "dispute_body", "return_postage_borne_by", "dispatch_statement",
             "free_shipping_threshold", "is_active", "created_at", "updated_at"],
    excluded: { updated_by: "Kontoidentität" },
    restoreRelevant: true,
  },
  {
    key: "seller_operators",
    source: "seller_operators",
    purpose: "Wer den Betrieb bedienen darf — für einen Wiederaufbau nötig.",
    fields: ["seller_id", "user_id", "is_enabled", "note", "created_at", "updated_at"],
    excluded: { created_by: "Kontoidentität", updated_by: "Kontoidentität" },
    restoreRelevant: true,
  },
  {
    key: "shop_admins",
    source: "shop_admins",
    purpose: "Shop-Administratoren.",
    fields: ["user_id", "granted_at", "note"],
    restoreRelevant: true,
  },
  {
    key: "platform_admins",
    source: "platform_admins",
    purpose: "Plattformadministratoren.",
    fields: ["user_id", "created_at", "note"],
    excluded: { created_by: "Kontoidentität" },
    restoreRelevant: true,
  },
  {
    key: "shop_settings",
    source: "shop_settings",
    purpose: "Die Preisregel des Shops.",
    fields: ["id", "price_percentage", "free_shipping_threshold", "updated_at"],
    excluded: { updated_by: "Kontoidentität" },
    restoreRelevant: true,
  },
  {
    key: "platform_settings",
    source: "platform_settings",
    purpose: "Konfiguration der Plattform, inkl. Katalog-Aufschlag aus 0094.",
    fields: ["id", "contact_email", "support_email", "catalog_market_boost_percent",
             "updated_at"],
    excluded: { updated_by: "Kontoidentität" },
    restoreRelevant: true,
  },
  {
    key: "commerce_settings",
    source: "commerce_settings",
    purpose:
      "Betriebsmodus und Kassengrenzen. OHNE `client_salt` — das ist ein " +
      "Geheimnis und wird nach einem Wiederaufbau neu gesetzt.",
    fields: ["id", "mode", "max_open_checkouts", "max_reserved_units",
             "max_orders_per_hour", "updated_at"],
    excluded: { client_salt: "Geheimnis" },
    restoreRelevant: true,
  },
  {
    key: "shipping_methods",
    source: "shipping_methods",
    purpose: "Versandarten und Preise.",
    fields: ["code", "name", "base_price", "is_enabled", "sort_order", "updated_at"],
    excluded: { updated_by: "Kontoidentität" },
    restoreRelevant: true,
  },
  {
    key: "shipping_countries",
    source: "shipping_countries",
    purpose: "Wohin geliefert wird.",
    fields: ["country_code", "label", "is_enabled", "sort_order", "updated_at"],
    excluded: { updated_by: "Kontoidentität" },
    restoreRelevant: true,
  },
  {
    key: "legal_document_versions",
    source: "legal_document_versions",
    purpose: "Welche Fassung von AGB und Widerrufsbelehrung gilt.",
    fields: ["slug", "version", "effective_from", "updated_at"],
    restoreRelevant: true,
  },

  /* ------------------------------------------------- Lager und Orderbuch */
  {
    key: "shop_inventory",
    source: "shop_inventory",
    purpose: "Der Bestand je Figur und Zustand.",
    fields: ["id", "sky_id", "condition", "quantity", "reserved", "available_quantity",
             "sale_price", "is_listed", "note", "created_at", "updated_at"],
    restoreRelevant: true,
  },
  {
    key: "inventory_movements",
    source: "inventory_movements",
    purpose:
      "Das append-only Ledger. Ein Restore darf es niemals zurückschreiben — " +
      "er bespielt einen leeren Mandanten, korrigiert nie einen laufenden.",
    fields: ["id", "inventory_id", "delta", "reason", "unit_cost", "currency", "note",
             "created_at"],
    excluded: { created_by: "Kontoidentität" },
    denormalised: [
      { field: "sky_id", from: "shop_inventory.sky_id über inventory_id",
        why: "Eine Bewegung, die nur eine Zeilennummer nennt, ist außerhalb der Datenbank wertlos." },
      { field: "condition", from: "shop_inventory.condition über inventory_id",
        why: "Dieselbe Figur in zwei Zuständen sind zwei Bestände." },
    ],
    restoreRelevant: true,
  },
  {
    key: "purchases",
    source: "purchases",
    purpose: "Externe Einkäufe — die Kostenseite des historischen Ankaufsfaktors.",
    fields: ["id", "purchased_at", "total_cost", "currency", "source", "external_ref",
             "note", "is_test", "created_at", "updated_at"],
    excluded: { created_by: "Kontoidentität", updated_by: "Kontoidentität",
                import_fingerprint: "Wiedereinspiel-Schutz des Legacy-Imports" },
    restoreRelevant: true,
  },
  {
    key: "purchase_items",
    source: "purchase_items",
    purpose: "Positionen mit eingefrorenem Marktwert.",
    fields: ["id", "purchase_id", "position", "sky_id", "condition", "raw_name", "state",
             "market_price_snapshot", "market_price_snapshot_at", "market_price_source",
             "movement_id", "note", "created_at", "updated_at"],
    excluded: { source_row: "Zeilennummer der alten Arbeitsmappe",
                legacy_condition_flag: "Altlast-Merker", legacy_booked_flag: "Altlast-Merker" },
    restoreRelevant: true,
  },
  {
    key: "sales",
    source: "sales",
    purpose: "Verkäufe über alle Kanäle.",
    fields: ["id", "channel", "order_id", "sold_at", "shipped_at",
             "destination_country_code", "currency", "items_subtotal", "shipping_charged",
             "discount_amount", "reported_payout_amount", "reported_payout_ref",
             "reported_payout_at", "buy_in_factor_snapshot", "external_order_ref",
             "buyer_ref", "note", "source", "is_test", "cancelled_at",
             "stock_released_at", "created_at", "updated_at"],
    excluded: { created_by: "Kontoidentität", updated_by: "Kontoidentität",
                import_fingerprint: "Wiedereinspiel-Schutz des Legacy-Imports" },
    personalData: true,
    restoreRelevant: true,
  },
  {
    key: "sale_items",
    source: "sale_items",
    purpose: "Die verkauften Stücke.",
    fields: ["id", "sale_id", "position", "sky_id", "raw_name", "condition",
             "market_price_snapshot", "market_price_snapshot_at", "movement_id",
             "returned_at", "return_movement_id", "settled_at", "not_shipped_at",
             "return_announced_at", "note", "created_at", "updated_at"],
    excluded: { source_row: "Zeilennummer der alten Arbeitsmappe",
                legacy_stock_flag: "Altlast-Merker", legacy_shipped_flag: "Altlast-Merker" },
    restoreRelevant: true,
  },
  {
    key: "sale_fees",
    source: "sale_fees",
    purpose: "Was ein Verkauf gekostet hat.",
    fields: ["id", "sale_id", "kind", "label", "amount", "settled_by", "note", "created_at"],
    excluded: { created_by: "Kontoidentität" },
    restoreRelevant: true,
  },
  {
    key: "sale_refunds",
    source: "sale_refunds",
    purpose: "Erstattungen externer Kanäle.",
    fields: ["id", "sale_id", "amount", "occurred_at", "reason", "external_ref", "note",
             "created_at"],
    excluded: { created_by: "Kontoidentität" },
    restoreRelevant: true,
  },
  {
    key: "settlement_adjustments",
    source: "settlement_adjustments",
    purpose: "Vorzeichenbehaftete Korrekturen einer Kanalabrechnung.",
    fields: ["id", "sale_id", "channel", "amount", "reason", "external_ref", "note",
             "occurred_at", "source", "created_at"],
    excluded: { created_by: "Kontoidentität",
                import_fingerprint: "Wiedereinspiel-Schutz des Legacy-Imports" },
    restoreRelevant: true,
  },
  {
    key: "orderbook_name_mappings",
    source: "orderbook_name_mappings",
    purpose: "Rohname → SKY-ID. Kuratiertes Wissen, nicht ableitbar.",
    fields: ["id", "normalised_name", "sky_id", "not_a_figure", "sample_raw_name",
             "created_at", "updated_at"],
    excluded: { created_by: "Kontoidentität" },
    restoreRelevant: true,
  },
  {
    key: "orderbook_audit",
    source: "orderbook_audit",
    purpose: "Feldänderungen an Verkäufen.",
    fields: ["id", "sale_id", "entity_type", "entity_id", "action", "field", "old_value",
             "new_value", "changed_at"],
    excluded: { changed_by: "Kontoidentität" },
    restoreRelevant: false,
  },
  {
    key: "seller_monthly_reports",
    source: "seller_monthly_reports",
    purpose: "Finalisierte Monatswerte.",
    fields: ["id", "period_year", "period_month", "commerce_mode", "finalized_at",
             "order_count", "order_value", "merchandise_amount", "shipping_amount",
             "discount_amount", "currency", "paid_count", "unpaid_count", "tax_regime",
             "included_orders"],
    excluded: { finalized_by: "Kontoidentität" },
    restoreRelevant: true,
  },

  /* ------------------------------------------------------ Bestellungen */
  {
    key: "orders",
    source: "orders",
    purpose:
      "Bestellungen vollständig — anders als im Business-Export mit " +
      "Käuferbezug, weil ein Wiederaufbau die Zuordnung braucht.",
    fields: ["id", "order_number", "user_id", "customer_email", "currency",
             "items_subtotal", "shipping_amount", "discount_amount", "total_amount",
             "payment_status", "fulfillment_status", "needs_resolution", "placed_at",
             "paid_at", "shipped_at", "completed_at", "cancelled_at", "updated_at",
             "tax_regime", "shipping_method_code", "shipping_method_name",
             "tracking_number", "commerce_mode"],
    excluded: { client_hash: "gesalzener Besucherfingerabdruck",
                payment_token_hash: "Fähigkeitsnachweis", request_id: "Idempotenzschlüssel",
                sandbox_archived_at: "Testdatenverwaltung",
                sandbox_archived_by: "Kontoidentität" },
    personalData: true,
    restoreRelevant: true,
  },
  {
    key: "order_lines",
    source: "order_lines",
    purpose: "Was bestellt wurde, mit den Schnappschüssen des Bestellzeitpunkts.",
    fields: ["id", "order_id", "sky_id", "condition", "quantity", "name_snapshot",
             "image_snapshot", "series_snapshot", "unit_price", "discount_amount",
             "line_total", "inventory_id", "created_at"],
    restoreRelevant: true,
  },
  {
    key: "order_addresses",
    source: "order_addresses",
    purpose: "Die Lieferanschrift, wie sie vereinbart wurde.",
    fields: ["id", "order_id", "kind", "first_name", "last_name", "company", "street",
             "house_number", "address_line_2", "postal_code", "city", "country_code",
             "phone", "created_at"],
    personalData: true,
    restoreRelevant: true,
  },
  {
    key: "order_events",
    source: "order_events",
    purpose: "Die vollständige Zeitleiste einer Bestellung.",
    fields: ["id", "order_id", "event_type", "actor_kind", "payload", "created_at"],
    excluded: { actor_user_id: "Kontoidentität" },
    restoreRelevant: true,
  },
  {
    key: "order_line_events",
    source: "order_line_events",
    purpose: "Storno und Retoure je Position.",
    fields: ["id", "order_id", "order_line_id", "kind", "quantity", "stock_outcome",
             "movement_id", "correction_movement_id", "occurred_at", "reason",
             "reason_code", "created_at"],
    excluded: { created_by: "Kontoidentität" },
    restoreRelevant: true,
  },
  {
    key: "order_reservations",
    source: "order_reservations",
    purpose: "Die Brücke zwischen Bestellung und Lagerbewegung.",
    fields: ["id", "order_id", "inventory_id", "quantity", "state", "reserved_at",
             "expires_at", "released_at", "converted_at", "movement_id",
             "reverted_movement_id"],
    denormalised: [
      { field: "sky_id", from: "shop_inventory.sky_id über inventory_id",
        why: "Wie bei den Bewegungen: eine Zeilennummer allein trägt nichts." },
      { field: "condition", from: "shop_inventory.condition über inventory_id",
        why: "Zustand gehört zur Bestandsidentität." },
    ],
    restoreRelevant: true,
  },
  {
    key: "order_refunds",
    source: "order_refunds",
    purpose: "Erstattungen an Shop-Kunden.",
    fields: ["id", "order_id", "amount", "currency", "occurred_at", "reason",
             "withdrawal_request_id", "created_at"],
    excluded: { provider_refund_id: "Stripe-Interna", created_by: "Kontoidentität" },
    restoreRelevant: true,
  },
  {
    key: "order_refund_allocations",
    source: "order_refund_allocations",
    purpose: "Welcher Teil einer Erstattung zu welcher Position gehört.",
    fields: ["id", "refund_id", "order_line_id", "quantity", "amount", "allocation_type"],
    restoreRelevant: true,
  },
  {
    key: "order_legal_snapshots",
    source: "order_legal_snapshots",
    purpose: "Wer bei dieser Bestellung Vertragspartner war.",
    fields: ["order_id", "agb_version", "widerruf_version", "seller_name",
             "seller_legal_name", "seller_street", "seller_postal_code", "seller_city",
             "seller_country_code", "seller_email", "seller_vat_id", "created_at"],
    restoreRelevant: true,
  },
  {
    key: "order_messages",
    source: "order_messages",
    purpose: "Die Unterhaltung zur Bestellung.",
    fields: ["id", "order_id", "author_kind", "body", "created_at"],
    excluded: { author_user_id: "Kontoidentität" },
    personalData: true,
    restoreRelevant: true,
  },
  {
    key: "order_conversation_reads",
    source: "order_conversation_reads",
    purpose: "Lesestände des Nachrichtenkanals.",
    fields: ["order_id", "reader", "last_read_at"],
    excluded: { updated_by: "Kontoidentität" },
    restoreRelevant: false,
  },
  {
    key: "order_attention_reads",
    source: "order_attention_reads",
    purpose: "Lesestände der Bestellmeldungen.",
    fields: ["order_id", "reader", "last_read_at"],
    excluded: { updated_by: "Kontoidentität" },
    restoreRelevant: false,
  },
  {
    key: "order_mail",
    source: "order_mail",
    purpose: "Welche Mail zu welcher Bestellung hinausging — der Zustellnachweis.",
    fields: ["order_id", "kind", "ref", "state", "claimed_at", "sent_at", "attempts",
             "last_error", "updated_at"],
    excluded: { provider_message_id: "Resend-Interna" },
    restoreRelevant: false,
  },
  {
    key: "invoices",
    source: "invoices",
    purpose: "Die aufbewahrungspflichtigen Dokumente (§ 147 AO).",
    fields: ["id", "order_id", "invoice_number", "issued_at", "seller_legal_name",
             "seller_trade_name", "seller_street", "seller_postal_code", "seller_city",
             "seller_country", "seller_email", "seller_vat_id", "customer_name",
             "customer_company", "customer_street", "customer_postal_code",
             "customer_city", "customer_country", "customer_email", "items_subtotal",
             "shipping_amount", "discount_amount", "total_amount", "currency",
             "tax_regime", "lines"],
    personalData: true,
    restoreRelevant: true,
  },
  {
    key: "customer_contacts",
    source: "customer_contacts",
    purpose: "Gespeicherte Lieferadressen der Kundschaft.",
    fields: ["user_id", "email", "first_name", "last_name", "company", "street",
             "house_number", "address_line_2", "postal_code", "city", "country_code",
             "phone", "updated_at"],
    personalData: true,
    restoreRelevant: true,
  },
  {
    key: "payment_attempts",
    source: "payment_attempts",
    purpose:
      "Dass und wann bezahlt wurde. OHNE Stripe-Kennungen und ohne " +
      "Kartendaten — die gehören in keine Datei auf einem Schreibtisch.",
    fields: ["id", "order_id", "provider", "status", "amount", "currency", "created_at",
             "updated_at", "paid_at", "failed_at"],
    excluded: {
      provider_payment_id: "Stripe-Session", provider_checkout_url: "Stripe-Zahlungslink",
      provider_intent_id: "Stripe PaymentIntent", payment_method_type: "Kartenschnappschuss",
      card_brand: "Kartendaten", card_last4: "Kartendaten", wallet_type: "Kartendaten",
      method_recorded_at: "gehört zum Kartenschnappschuss",
    },
    restoreRelevant: true,
  },
  {
    key: "payment_events",
    source: "payment_events",
    purpose: "Welche Zustellung welchen Zahlungsvorgang bestätigt hat.",
    fields: ["id", "provider", "event_type", "payment_attempt_id", "order_id",
             "received_at", "processed_at", "outcome"],
    excluded: { provider_event_id: "Stripe-Ereigniskennung" },
    restoreRelevant: false,
  },
  {
    key: "withdrawal_requests",
    source: "withdrawal_requests",
    purpose: "Widerrufserklärungen — eigener Aufbewahrungszweck.",
    fields: ["id", "order_id", "consumer_name", "contact_email", "declaration",
             "received_at", "receipt_state", "receipt_sent_at", "handled_at",
             "receipt_attempt_at"],
    excluded: { handled_by: "Kontoidentität" },
    personalData: true,
    restoreRelevant: true,
  },

  /* ------------------------------------------------------------- Tester */
  {
    key: "testers",
    source: "testers",
    purpose: "Wer die Anwendung testen darf.",
    fields: ["user_id", "note", "created_at"],
    excluded: { created_by: "Kontoidentität" },
    restoreRelevant: true,
  },
  {
    key: "tester_permissions",
    source: "tester_permissions",
    purpose: "Welche Testrechte vergeben sind.",
    fields: ["user_id", "permission", "granted_at"],
    excluded: { granted_by: "Kontoidentität" },
    restoreRelevant: true,
  },
  {
    key: "tester_features",
    source: "tester_features",
    purpose: "Die Liste der vergebbaren Testrechte.",
    fields: ["key", "label", "description", "position"],
    restoreRelevant: true,
  },
  {
    key: "tester_permission_changes",
    source: "tester_permission_changes",
    purpose: "Wann ein Testrecht vergeben oder entzogen wurde.",
    fields: ["id", "user_id", "permission", "action", "changed_at"],
    excluded: { changed_by: "Kontoidentität" },
    restoreRelevant: false,
  },
  {
    key: "commerce_testers",
    source: "commerce_testers",
    purpose: "Wer in der Stripe-Sandbox zahlt statt echt (ADR-0100).",
    fields: ["user_id", "note", "granted_at"],
    excluded: { granted_by: "Kontoidentität" },
    restoreRelevant: true,
  },
] as const;

/* -------------------------------------------------------------------------
 * Was draußen bleibt
 * ---------------------------------------------------------------------- */

export const PLATFORM_EXCLUDED_TABLES: Readonly<Record<string, string>> = {
  legacy_stock_events:
    "Legacy-Lagerhistorie aus der Arbeitsmappe. Ein Backup, das sie enthält, lädt zur " +
    "verbotenen Rückspielung ein — dauerhaft untersagt.",
  inventory_imports: "Excel-Importläufe. Werkzeugspur, kein Geschäftsvorfall.",
  inventory_import_rows: "Zeilen eines Excel-Importlaufs.",
  inventory_import_mappings: "Zuordnungen eines Excel-Importlaufs.",
  perf_navigations: "Telemetrie (ADR-0072). Ohne Geschäftswert, jederzeit neu messbar.",
  perf_interactions: "Telemetrie der Interaktionen (ADR-0072). Ohne Geschäftswert, jederzeit neu messbar.",
  cart_items:
    "Der Warenkorb ist flüchtig und gehört keinem abgeschlossenen Vorgang an; " +
    "ein wiederhergestellter fremder Warenkorb wäre eher verwirrend als nützlich.",
  withdrawal_attempts:
    "Enthält nur eine gehashte Besucherkennung und einen Zeitpunkt — ohne den Hash " +
    "bedeutungslos, mit ihm ein Personenbezug ohne Zweck.",
  platform_export_runs:
    "Die Historie der Exporte selbst. Ein Backup, das seine eigene Vorgeschichte " +
    "mitschleppt, wächst ohne Erkenntnisgewinn.",
};

/* -------------------------------------------------------------------------
 * Die Sperrliste — eigen, weil der Zweck ein anderer ist
 * ---------------------------------------------------------------------- */

/**
 * Felder, die in KEINEM Bereich des Platform-Exports vorkommen dürfen.
 *
 * WARUM NICHT DIE LISTE DES BUSINESS-EXPORTS. Sie sperrt `user_id` und
 * `customer_email`, weil ein Händler sie nicht braucht. Eine
 * Katastrophensicherung braucht sie: ohne `user_id` weiß niemand mehr, wem
 * eine Sammlung gehörte, und ohne die Adresse lässt sich ein Konto nach
 * einem Wiederaufbau nicht zuordnen. Personenbezug ist hier also nicht
 * verboten, sondern gekennzeichnet (`personalData`).
 *
 * WAS IN BEIDEN LISTEN GLEICH BLEIBT, ist der harte Kern: Geheimnisse,
 * Tokens, Zahlungsdienstleister-Interna, Kartendaten und die Spuren des
 * Excel-Imports. Ein Test hält fest, dass dieser Kern in beiden Formaten
 * gesperrt ist — wer ihn hier lockerte, hätte ihn überall gelockert.
 */
export const PLATFORM_FORBIDDEN_FIELDS: Readonly<Record<string, string>> = {
  /* Geheimnisse */
  client_salt: "Geheimnis aus commerce_settings",
  payment_token_hash: "Fähigkeitsnachweis einer Bestellung",
  client_hash: "gesalzener Besucherfingerabdruck",
  request_id: "Idempotenzschlüssel des Checkouts",

  /* Zahlungsdienstleister */
  provider_payment_id: "Stripe-Session",
  provider_checkout_url: "Stripe-Zahlungslink",
  provider_intent_id: "Stripe PaymentIntent",
  provider_refund_id: "Stripe-Erstattung",
  provider_event_id: "Stripe-Ereignis-Id",
  provider_message_id: "Resend-Nachrichten-Id",

  /* Kartendaten */
  payment_method_type: "Kartenschnappschuss",
  card_brand: "Kartendaten",
  card_last4: "Kartendaten",
  wallet_type: "Kartendaten",
  method_recorded_at: "gehört zum Kartenschnappschuss",

  /* Altlast-Provenienz */
  import_fingerprint: "Wiedereinspiel-Schutz des Legacy-Imports",
  source_row: "Zeilennummer in der alten Arbeitsmappe",
  legacy_condition_flag: "Altlast-Merker",
  legacy_booked_flag: "Altlast-Merker",
  legacy_stock_flag: "Altlast-Merker",
  legacy_shipped_flag: "Altlast-Merker",

  /* Auth: niemals, in keiner Form */
  ...AUTH_FORBIDDEN_FIELDS,
};

/**
 * Der Kern, der in BEIDEN Formaten gesperrt sein muss.
 *
 * Eine Zeile, an der ein Test hängt: wer eines dieser Felder in einem der
 * beiden Manifeste freigäbe, hätte es faktisch überall freigegeben.
 */
export const SHARED_FORBIDDEN_CORE = [
  "client_salt", "payment_token_hash", "client_hash", "request_id",
  "provider_payment_id", "provider_checkout_url", "provider_intent_id",
  "provider_refund_id", "card_brand", "card_last4", "wallet_type",
  "import_fingerprint", "source_row",
] as const;

/* -------------------------------------------------------------------------
 * Das Archiv
 * ---------------------------------------------------------------------- */

/** Der Aufbau der ZIP-Datei. Eine Datei je Teil, plus die Bytes darunter. */
export const PLATFORM_ARCHIVE_LAYOUT = {
  manifest: "manifest.json",
  database: "database.json",
  authUsers: "auth-users.json",
  storageManifest: "storage-manifest.json",
  storagePrefix: "storage/",
} as const;

export const PLATFORM_METADATA_FIELDS = [
  "format", "format_version", "created_at", "source_project", "commerce_mode",
  "counts", "auth_user_count", "storage_object_count", "storage_missing_count",
  "files",              // je Archivdatei Größe und SHA256
  "contains_personal_data",
  "auth_inventory_only", // immer true — siehe AUTH_INVENTORY_DISCLAIMER
  "restore_supported",   // immer false
] as const;

export const PLATFORM_METADATA_SOURCE: Readonly<Record<string, "database" | "route">> = {
  format: "route",
  format_version: "route",
  created_at: "database",
  source_project: "route",
  commerce_mode: "database",
  counts: "route",
  auth_user_count: "route",
  storage_object_count: "route",
  storage_missing_count: "route",
  files: "route",
  contains_personal_data: "route",
  auth_inventory_only: "route",
  restore_supported: "route",
};

/** Alle Quelltabellen des Platform-Exports. */
export function platformSourceTables(): string[] {
  return PLATFORM_SECTIONS.map((s) => s.source);
}

/** Jedes Feld, das irgendwo im Platform-Export landet. */
export function allPlatformFields(): string[] {
  return PLATFORM_SECTIONS.flatMap((s) => [
    ...s.fields,
    ...(s.denormalised ?? []).map((d) => d.field),
  ]);
}
