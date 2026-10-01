/**
 * Was in eine Datensicherung des Betriebs gehört — und was nicht (V1).
 *
 * WARUM DAS EINE DATEI FÜR SICH IST. Die Auswahl ist die eigentliche
 * Entscheidung; die SQL-Funktion und die Route, die später folgen, sind nur
 * ihre Ausführung. Steht sie als Code da, kann ein Test sie prüfen, und
 * niemand muss beim Lesen einer 300-zeiligen `jsonb_build_object`-Anweisung
 * erraten, ob ein Feld absichtlich fehlt. Diese Datei hat **keine
 * Abhängigkeiten, keinen Datenbankzugriff und keine Seiteneffekte** — sie
 * beschreibt, sie tut nichts.
 *
 * DAS BACKUP IST EIN EXPORT, NIEMALS EINE SYNCHRONISATION. Es liest und
 * schreibt nie. Es ist kein zweiter Bestandsweg, kein Abgleich, kein
 * Cutover-Werkzeug. Die Datenbank bleibt die operative Wahrheit; die Datei
 * ist eine Kopie davon zu einem Zeitpunkt, mehr nicht. Die alten
 * Excel-Import- und Cutover-Tabellen sind deshalb **vollständig
 * ausgeschlossen** (`EXCLUDED_TABLES`): ein Backup, das sie enthielte, lüde
 * irgendwann jemanden ein, sie zurückzuspielen, und genau dieser Weg ist
 * dauerhaft verboten.
 *
 * `inventory_movements` IST EIN APPEND-ONLY LEDGER. Es wird mitgesichert,
 * weil ohne die Bewegungen kein Bestand nachvollziehbar ist — aber ein
 * späterer Restore darf niemals Bewegungen zurückschreiben oder Bestände
 * setzen. Er müsste einen leeren Mandanten neu aufbauen. Das steht hier,
 * damit es geschrieben steht, bevor jemand es versucht.
 *
 * V1 IST KEIN RESTORE. Diese Datei definiert das Format so, dass ein
 * späterer, getrennt zu entscheidender Restore möglich bleibt —
 * `BACKUP_FORMAT_VERSION` ist der Vertrag dafür. Eine Importfunktion gibt es
 * nicht und wird hier auch nicht vorbereitet.
 */

/** Der Formatname. Steht in jeder Datei und ist Teil des Vertrags. */
export const BACKUP_FORMAT = "skyisles-business-backup";

/**
 * Die Formatversion.
 *
 * Erhöht wird sie, sobald sich die BEDEUTUNG eines Feldes ändert oder ein
 * Bereich verschwindet — nicht, wenn ein Feld hinzukommt. Ein späterer
 * Restore liest sie als Erstes und verweigert, was er nicht kennt.
 */
export const BACKUP_FORMAT_VERSION = 1;

/* -------------------------------------------------------------------------
 * Felder, die in KEINEM Bereich vorkommen dürfen
 * ---------------------------------------------------------------------- */

/**
 * Die harte Sperrliste.
 *
 * Kein Bereich darf eines dieser Felder führen, heute nicht und später
 * nicht. Ein Test prüft das gegen jeden Bereich — das ist der eigentliche
 * Zweck dieser Datei: nicht zu beschreiben, was mitkommt, sondern zu
 * verhindern, dass beim nächsten Feld jemand aus Versehen ein Geheimnis
 * oder eine Kartennummer mit exportiert.
 */
export const FORBIDDEN_FIELDS: Readonly<Record<string, string>> = {
  /* Geheimnisse */
  client_salt: "Geheimnis aus commerce_settings — gehört nie in eine Datei",
  payment_token_hash: "Fähigkeitsnachweis einer Bestellung",
  client_hash: "gesalzener Besucherfingerabdruck",
  request_id: "Idempotenzschlüssel des Checkouts, technisch",

  /* Zahlungsdienstleister-Interna */
  provider_payment_id: "Stripe-Session — technisch, für den Betrieb wertlos",
  provider_checkout_url: "Stripe-Zahlungslink",
  provider_intent_id: "Stripe PaymentIntent",
  provider_refund_id: "Stripe-Erstattung",
  provider_message_id: "Resend-Nachrichten-Id",
  provider_event_id: "Stripe-Ereignis-Id",

  /* Kartendaten — nie in eine Datei auf einer Festplatte */
  payment_method_type: "Zahlungsartschnappschuss, für die Buchhaltung ohne Wert",
  card_brand: "Kartendaten",
  card_last4: "Kartendaten",
  wallet_type: "Kartendaten",
  method_recorded_at: "gehört zum Kartenschnappschuss",

  /* Kontoidentitäten — ein Einzelunternehmen, ohne Aussagewert, aber PII */
  user_id: "Kontoidentität",
  actor_user_id: "Kontoidentität",
  author_user_id: "Kontoidentität",
  created_by: "Kontoidentität",
  updated_by: "Kontoidentität",
  finalized_by: "Kontoidentität",
  handled_by: "Kontoidentität",
  sandbox_archived_by: "Kontoidentität",
  avatar_url: "Profildatum der Plattform",

  /* Altlast-Provenienz: die Spuren des Excel-Imports */
  import_fingerprint: "Wiedereinspiel-Schutz des Legacy-Imports (siehe EXCLUDED_TABLES)",
  source_row: "Zeilennummer in der alten Arbeitsmappe",
  legacy_condition_flag: "Altlast-Merker des Excel-Imports",
  legacy_booked_flag: "Altlast-Merker des Excel-Imports",
  legacy_stock_flag: "Altlast-Merker des Excel-Imports",
  legacy_shipped_flag: "Altlast-Merker des Excel-Imports",
};

/**
 * Personenbezogene Felder und der einzige Bereich, in dem sie stehen dürfen.
 *
 * Rechnungen sind der Grund, aus dem ein Backup überhaupt aufbewahrt wird —
 * § 147 AO verlangt zehn Jahre —, und eine Rechnung ohne Empfänger ist
 * keine. Deshalb sind sie enthalten, aber **nur dort**: derselbe Name auf
 * `orders` oder in `customer_contacts` wäre eine zweite Kopie ohne Anlass.
 */
export const PERSONAL_DATA_FIELDS: Readonly<Record<string, string>> = {
  customer_name: "invoices",
  customer_company: "invoices",
  customer_street: "invoices",
  customer_postal_code: "invoices",
  customer_city: "invoices",
  customer_country: "invoices",
  customer_email: "invoices",
  buyer_ref: "sales",
};

/* -------------------------------------------------------------------------
 * Ganze Tabellen, die draußen bleiben
 * ---------------------------------------------------------------------- */

export const EXCLUDED_TABLES: Readonly<Record<string, string>> = {
  /* Die Excel- und Cutover-Maschinerie. Der wichtigste Ausschluss. */
  legacy_stock_events:
    "Legacy-Lagerhistorie aus der Arbeitsmappe. Nicht wiederherstellbar und nie wieder " +
    "als Bestandsquelle zu verwenden — dauerhaft verboten.",
  inventory_imports: "Excel-Importläufe. Werkzeugspur, kein Geschäftsvorfall.",
  inventory_import_rows: "Zeilen eines Excel-Importlaufs.",
  inventory_import_mappings: "Zuordnungen eines Excel-Importlaufs.",

  /* Konten und lebende Stammdaten */
  profiles: "Plattformkonten, keine Geschäftsdaten.",
  customer_contacts:
    "Gespeicherte Kundenadressen. Lebende Stammdaten, kein Geschäftsvorfall — " +
    "die Anschrift eines Kaufs steht auf der Rechnung.",
  seller_operators: "Wer den Betrieb bedienen darf. Berechtigung, kein Geschäftsdatum.",
  shop_admins: "Wer die Plattform verwaltet. Berechtigung, kein Geschäftsdatum.",
  platform_admins: "Wer SkyIsles betreibt. Berechtigung, kein Geschäftsdatum.",

  /* Kommunikation und Zustellung */
  order_messages: "Inhalt privater Kundenkommunikation.",
  order_mail: "Zustellbuchhaltung der Transaktionsmails.",
  order_conversation_reads: "Lesestände des Nachrichtenkanals. Zustand der Oberfläche.",
  order_attention_reads: "Lesestände der Bestellmeldungen. Zustand der Oberfläche.",
  order_events: "Systembuchhaltung der Bestellung; was zählt, steht in order_line_events.",

  /* Zahlungstechnik */
  payment_attempts: "Stripe-Interna und Kartenschnappschuss.",
  payment_events: "Webhook-Buchhaltung des Zahlungsdienstleisters.",
  withdrawal_attempts: "Gehashte Besucherkennung einer Widerrufsanfrage.",

  /* Plattformeigenes */
  catalog_editorial: "Redaktionelle Notizen der Plattform, nicht des Verkäufers.",
  characters: "Charaktermetadaten der Plattform. Für den Bestand ohne Bedeutung.",
  commerce_settings:
    "Kein Bereich des Backups: die Tabelle enthält `client_salt`, ein Geheimnis. " +
    "Gelesen wird aus ihr einzig `mode` für das Metadatum `commerce_mode` — damit " +
    "ein Staging-Backup nie mit einem Production-Backup verwechselt wird. Das Salz " +
    "verlässt die Datenbank nicht.",
  platform_settings: "Plattformkonfiguration.",

  /* Bewusst offen gelassen */
  order_addresses:
    "Lieferanschrift. Die Rechnung trägt sie bereits; eine zweite Kopie personenbezogener " +
    "Daten ohne zusätzlichen Zweck bleibt draußen.",
  orderbook_audit:
    "Feldänderungen an Verkäufen. Nützlich zur Fehlersuche, für die Rekonstruktion " +
    "des Bestands ohne Belang. Kann in einer späteren Version dazukommen.",
  withdrawal_requests:
    "Widerrufserklärungen mit Name und Kontaktadresse. Eigener Aufbewahrungszweck, " +
    "eigene Entscheidung — nicht Teil des Bestands-Backups von V1.",
};

/* -------------------------------------------------------------------------
 * Die Bereiche
 * ---------------------------------------------------------------------- */

/** Ein Feld, das es in der Quelltabelle nicht gibt und das der Export bildet. */
export type DenormalisedField = {
  field: string;
  /** Woher der Wert kommt, als lesbarer Pfad. */
  from: string;
  why: string;
};

export type BackupSection = {
  /** Der Schlüssel unter `data` in der Datei. */
  key: string;
  /** Die Quelltabelle. */
  source: string;
  /** Wozu dieser Bereich im Backup steht. */
  purpose: string;
  /** Die übernommenen Spalten, in Ausgabereihenfolge. */
  fields: readonly string[];
  /** Spalten der Quelle, die absichtlich fehlen, mit Grund. */
  excluded?: Readonly<Record<string, string>>;
  /** Felder, die der Export bildet, weil die rohe Zeile ohne sie unlesbar ist. */
  denormalised?: readonly DenormalisedField[];
  /** Enthält personenbezogene Daten und wird in der Datei so gekennzeichnet. */
  personalData?: true;
  /**
   * Ob ein späterer Restore diesen Bereich bräuchte. `false` heißt: reine
   * Lesbarkeit, ein Wiederaufbau käme ohne ihn aus.
   */
  restoreRelevant: boolean;
};

export const BACKUP_SECTIONS: readonly BackupSection[] = [
  /* ---------------------------------------------------------- Lager */
  {
    key: "shop_inventory",
    source: "shop_inventory",
    purpose: "Der aktuelle Bestand je Figur und Zustand.",
    fields: ["id", "sky_id", "condition", "quantity", "reserved", "available_quantity",
             "sale_price", "is_listed", "note", "created_at", "updated_at"],
    restoreRelevant: true,
  },
  {
    key: "inventory_movements",
    source: "inventory_movements",
    purpose:
      "Das append-only Ledger. Ohne die Bewegungen ist kein Bestand nachvollziehbar. " +
      "Ein Restore darf sie niemals zurückschreiben.",
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

  /* ------------------------------------------------------- Einkauf */
  {
    key: "purchases",
    source: "purchases",
    purpose: "Externe Einkäufe — die Kostenseite des Buy-in-Faktors.",
    fields: ["id", "purchased_at", "total_cost", "currency", "source", "external_ref",
             "note", "is_test", "created_at", "updated_at"],
    excluded: {
      created_by: "Kontoidentität", updated_by: "Kontoidentität",
      import_fingerprint: "Wiedereinspiel-Schutz des Legacy-Imports",
    },
    restoreRelevant: true,
  },
  {
    key: "purchase_items",
    source: "purchase_items",
    purpose:
      "Die Positionen eines Einkaufs mit ihrem eingefrorenen Marktwert — die " +
      "Wertseite des Buy-in-Faktors.",
    fields: ["id", "purchase_id", "position", "sky_id", "condition", "raw_name", "state",
             "market_price_snapshot", "market_price_snapshot_at", "market_price_source",
             "movement_id", "note", "created_at", "updated_at"],
    excluded: {
      source_row: "Zeilennummer in der alten Arbeitsmappe",
      legacy_condition_flag: "Altlast-Merker", legacy_booked_flag: "Altlast-Merker",
    },
    restoreRelevant: true,
  },

  /* ------------------------------------------------------- Verkauf */
  {
    key: "sales",
    source: "sales",
    purpose: "Verkäufe über alle Kanäle, extern wie über SkyIsles.",
    fields: ["id", "channel", "order_id", "sold_at", "shipped_at", "destination_country_code",
             "currency", "items_subtotal", "shipping_charged", "discount_amount",
             "reported_payout_amount", "reported_payout_ref", "reported_payout_at",
             "buy_in_factor_snapshot", "external_order_ref", "buyer_ref", "note", "source",
             "is_test", "cancelled_at", "stock_released_at", "created_at", "updated_at"],
    excluded: {
      created_by: "Kontoidentität", updated_by: "Kontoidentität",
      import_fingerprint: "Wiedereinspiel-Schutz des Legacy-Imports",
    },
    personalData: true,
    restoreRelevant: true,
  },
  {
    key: "sale_items",
    source: "sale_items",
    purpose: "Die verkauften Stücke mit eingefrorenem Marktwert und Retourenstand.",
    fields: ["id", "sale_id", "position", "sky_id", "raw_name", "condition",
             "market_price_snapshot", "market_price_snapshot_at", "movement_id",
             "returned_at", "return_movement_id", "settled_at", "not_shipped_at",
             "return_announced_at", "note", "created_at", "updated_at"],
    excluded: {
      source_row: "Zeilennummer in der alten Arbeitsmappe",
      legacy_stock_flag: "Altlast-Merker", legacy_shipped_flag: "Altlast-Merker",
    },
    restoreRelevant: true,
  },
  {
    key: "sale_fees",
    source: "sale_fees",
    purpose: "Was ein Verkauf gekostet hat, nach Art getrennt.",
    fields: ["id", "sale_id", "kind", "label", "amount", "settled_by", "note", "created_at"],
    excluded: { created_by: "Kontoidentität" },
    restoreRelevant: true,
  },
  {
    key: "sale_refunds",
    source: "sale_refunds",
    purpose: "Erstattungen an Käufer externer Kanäle.",
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
    excluded: {
      created_by: "Kontoidentität",
      import_fingerprint: "Wiedereinspiel-Schutz des Legacy-Imports",
    },
    restoreRelevant: true,
  },
  {
    key: "name_mappings",
    source: "orderbook_name_mappings",
    purpose:
      "Rohname → SKY-ID. Kuratiertes Wissen, das sich nicht ableiten lässt und dessen " +
      "Verlust echte Handarbeit kostet.",
    fields: ["id", "normalised_name", "sky_id", "not_a_figure", "sample_raw_name",
             "created_at", "updated_at"],
    excluded: { created_by: "Kontoidentität" },
    restoreRelevant: true,
  },

  /* ------------------------------------------- SkyIsles-Bestellungen */
  {
    key: "orders",
    source: "orders",
    purpose:
      "Die kaufmännische Seite einer Shop-Bestellung. Bewusst ohne Käuferbezug — " +
      "wer gekauft hat, steht auf der Rechnung.",
    fields: ["id", "order_number", "currency", "items_subtotal", "shipping_amount",
             "discount_amount", "total_amount", "payment_status", "fulfillment_status",
             "needs_resolution", "placed_at", "paid_at", "shipped_at", "completed_at",
             "cancelled_at", "updated_at", "tax_regime", "shipping_method_code",
             "shipping_method_name", "tracking_number", "commerce_mode"],
    excluded: {
      user_id: "Kontoidentität",
      customer_email: "steht auf der Rechnung; zweite Kopie ohne Zweck",
      client_hash: "gesalzener Besucherfingerabdruck",
      payment_token_hash: "Fähigkeitsnachweis",
      request_id: "Idempotenzschlüssel des Checkouts",
      sandbox_archived_at: "Testdatenverwaltung", sandbox_archived_by: "Kontoidentität",
    },
    restoreRelevant: true,
  },
  {
    key: "order_lines",
    source: "order_lines",
    purpose: "Was bestellt wurde, mit den Schnappschüssen des Bestellzeitpunkts.",
    fields: ["id", "order_id", "sky_id", "condition", "quantity", "name_snapshot",
             "series_snapshot", "unit_price", "discount_amount", "line_total",
             "inventory_id", "created_at"],
    excluded: { image_snapshot: "Dateiname eines Bildes; außerhalb der Anwendung ohne Nutzen" },
    restoreRelevant: true,
  },
  {
    key: "order_line_events",
    source: "order_line_events",
    purpose: "Storno und Retoure je Position — erklärt, warum Bestand zurückkam.",
    fields: ["id", "order_id", "order_line_id", "kind", "quantity", "stock_outcome",
             "movement_id", "correction_movement_id", "occurred_at", "reason",
             "reason_code", "created_at"],
    excluded: { created_by: "Kontoidentität" },
    restoreRelevant: true,
  },
  {
    key: "order_reservations",
    source: "order_reservations",
    purpose: "Die Brücke zwischen einer Bestellung und den Lagerbewegungen.",
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
    excluded: {
      provider_refund_id: "Stripe-Interna", created_by: "Kontoidentität",
    },
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
    purpose:
      "Wer bei dieser Bestellung Vertragspartner war und welche Fassungen galten. " +
      "Verkäuferseite, kein Käuferbezug.",
    fields: ["order_id", "agb_version", "widerruf_version", "seller_name",
             "seller_legal_name", "seller_street", "seller_postal_code", "seller_city",
             "seller_country_code", "seller_email", "seller_vat_id", "created_at"],
    restoreRelevant: false,
  },

  /* ----------------------------------------------------- Rechnungen */
  {
    key: "invoices",
    source: "invoices",
    purpose:
      "Die aufbewahrungspflichtigen Dokumente (§ 147 AO, zehn Jahre). Der eigentliche " +
      "Grund, ein Backup aufzuheben — und der einzige Bereich mit Käuferdaten.",
    fields: ["id", "order_id", "invoice_number", "issued_at",
             "seller_legal_name", "seller_trade_name", "seller_street",
             "seller_postal_code", "seller_city", "seller_country", "seller_email",
             "seller_vat_id",
             "customer_name", "customer_company", "customer_street",
             "customer_postal_code", "customer_city", "customer_country", "customer_email",
             "items_subtotal", "shipping_amount", "discount_amount", "total_amount",
             "currency", "tax_regime", "lines"],
    personalData: true,
    restoreRelevant: false,
  },

  /* ------------------------------------------- Berichte und Stammdaten */
  {
    key: "monthly_reports",
    source: "seller_monthly_reports",
    purpose: "Finalisierte Monatswerte, wie sie zum Abschluss festgehalten wurden.",
    fields: ["id", "period_year", "period_month", "commerce_mode", "finalized_at",
             "order_count", "order_value", "merchandise_amount", "shipping_amount",
             "discount_amount", "currency", "paid_count", "unpaid_count", "tax_regime",
             "included_orders"],
    excluded: { finalized_by: "Kontoidentität" },
    restoreRelevant: false,
  },
  {
    key: "figures",
    source: "skylanders",
    purpose:
      "Stammdatenschnappschuss aller im Backup vorkommenden SKY-IDs, damit die Datei " +
      "lesbar bleibt, wenn der Katalog sich ändert. Die historisch richtigen Werte " +
      "stecken ohnehin in den *_snapshot-Spalten.",
    fields: ["sky_id", "name", "slug", "series_code", "card_type", "market_price"],
    excluded: {
      catalog_visible: "redaktionelle Spalte der Plattform",
      display_name_override: "redaktionelle Spalte der Plattform",
      image_file: "Dateiname; außerhalb der Anwendung ohne Nutzen",
      image_override_path: "Dateiname",
      character_id: "Charakterzuordnung der Plattform",
    },
    restoreRelevant: false,
  },
  {
    key: "series",
    source: "series",
    purpose: "Die Serienbezeichner, damit `series_code` lesbar bleibt.",
    fields: ["code", "label", "release_year"],
    restoreRelevant: false,
  },
  {
    key: "categories",
    source: "categories",
    purpose: "Die Kategoriebezeichner des Katalogs.",
    fields: ["id", "series_code", "name", "catalog_group"],
    restoreRelevant: false,
  },
  {
    key: "seller",
    source: "sellers",
    purpose: "Die rechtliche Identität des Betriebs zum Exportzeitpunkt.",
    fields: ["id", "display_name", "legal_name", "trading_name", "legal_form", "street",
             "postal_code", "city", "country_code", "vat_id", "small_business_19",
             "contact_email", "free_shipping_threshold"],
    excluded: { updated_by: "Kontoidentität" },
    restoreRelevant: false,
  },
  {
    key: "shop_settings",
    source: "shop_settings",
    purpose: "Die Preisregel des Shops zum Exportzeitpunkt.",
    fields: ["price_percentage", "free_shipping_threshold", "updated_at"],
    excluded: { updated_by: "Kontoidentität" },
    restoreRelevant: false,
  },
  {
    key: "shipping_methods",
    source: "shipping_methods",
    purpose: "Versandarten und Preise, damit Bestellbeträge nachvollziehbar sind.",
    fields: ["code", "name", "base_price", "is_enabled", "sort_order"],
    excluded: { updated_by: "Kontoidentität" },
    restoreRelevant: false,
  },
] as const;

/* -------------------------------------------------------------------------
 * Metadaten
 * ---------------------------------------------------------------------- */

/**
 * Was über dem Datenteil steht.
 *
 * Eine Sicherung, der man nicht ansieht, woher und wann sie stammt, ist im
 * Ernstfall wertlos — dann liegen drei Dateien auf der Platte und niemand
 * weiß, welche die jüngste ist oder ob eine davon aus Staging kommt.
 */
export const BACKUP_METADATA_FIELDS = [
  "format",            // immer BACKUP_FORMAT
  "format_version",    // immer BACKUP_FORMAT_VERSION
  "created_at",        // ISO-8601 mit Zone
  "source_project",    // Supabase-Projektreferenz
  "commerce_mode",     // live | sandbox | closed — damit Staging nie mit Production verwechselt wird
  "seller_legal_name",  // kein `seller_id`: siehe ADR-0021/0064, der Wächter bleibt stumpf
  "snapshot_txid",     // aus txid_current_snapshot(): belegt, dass alles aus einem Moment stammt
  "counts",            // Zeilenzahl je Bereich, als Plausibilitätsprüfung
  "inventory_units",   // Σ shop_inventory.quantity
  "buy_in_factor",     // seller_buy_in_factor() zum Exportzeitpunkt, als Prüfgröße
  "contains_personal_data", // true, solange Rechnungen enthalten sind
  "restore_supported", // in V1 immer false
] as const;

/**
 * Woher jedes Metadatum kommt.
 *
 * Nicht alles weiß die Datenbank. Ein Postgres kennt seine
 * Supabase-Projektreferenz nicht — ein `current_setting('app.settings.…')`
 * dafür gäbe es nicht und lieferte stillschweigend `null`. Lieber ein Feld,
 * das nachweislich von außen kommt, als eines, das so aussieht, als wüsste
 * es die Datenbank.
 */
export const BACKUP_METADATA_SOURCE: Readonly<Record<string, "database" | "route">> = {
  format: "database",
  format_version: "database",
  created_at: "database",
  source_project: "route",
  commerce_mode: "database",
  seller_legal_name: "database",
  snapshot_txid: "database",
  counts: "route",
  inventory_units: "database",
  buy_in_factor: "database",
  contains_personal_data: "database",
  restore_supported: "database",
};

/**
 * Regeln für die Werte in der Datei, damit ein späterer Leser sie nicht
 * raten muss. Beträge als **String** — dieselbe Regel wie im Webhook: ein
 * `numeric(10,2)` darf nicht durch einen Gleitkommawert.
 */
export const BACKUP_VALUE_RULES = {
  money: "String in der Dezimalschreibweise der Datenbank, niemals Number",
  timestamps: "ISO-8601 mit Zeitzone",
  nulls: "explizit null, nie weggelassen — ein fehlendes Feld ist keine Aussage",
  ordering: "je Bereich nach id aufsteigend, damit zwei Backups vergleichbar sind",
} as const;

/** Alle Quelltabellen, die das Backup liest. Für Tests und für die spätere SQL-Funktion. */
export function backupSourceTables(): string[] {
  return BACKUP_SECTIONS.map((s) => s.source);
}

/** Jedes Feld, das irgendwo im Backup landet — inklusive der gebildeten. */
export function allBackupFields(): string[] {
  return BACKUP_SECTIONS.flatMap((s) => [
    ...s.fields,
    ...(s.denormalised ?? []).map((d) => d.field),
  ]);
}
