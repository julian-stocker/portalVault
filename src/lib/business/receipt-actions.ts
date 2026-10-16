/**
 * Eigenbelege: ausstellen, lesen, und eine Auslieferung bestätigen (0122).
 *
 * ---------------------------------------------------------------------------
 * WARUM DIE BESTÄTIGUNG EIN EIGENER SCHRITT IST.
 *
 * HTTP kennt keine Empfangsbestätigung. Ein Route Handler, der beim BEGINN
 * des Schreibens „geliefert" vermerkt, behauptet einen Erfolg, den er nicht
 * kennt — die Verbindung kann danach noch abbrechen.
 *
 * Also beweist der Browser den Empfang: er lädt das PDF, bildet den SHA-256
 * über die empfangenen Bytes und schickt ihn zurück. Der Server rendert das
 * Dokument aus demselben Snapshot NEU, hasht und vergleicht. Nur bei
 * Übereinstimmung entsteht eine Zeile im Lieferprotokoll.
 *
 * WAS DAS BEWEIST: die vollständigen Bytes waren im Browser. Hätte er sie
 * nicht, könnte er den Hash nicht bilden.
 *
 * WAS ES NICHT BEWEIST: dass das Betriebssystem die Datei geschrieben und
 * behalten hat. Das weiss keine Webanwendung, und der Haken in der
 * Oberfläche behauptet es auch nicht.
 *
 * Dass hier NEU gerendert statt ein gespeicherter Hash verglichen wird, hat
 * einen zweiten Nutzen: ein Nichtdeterminismus im Renderer fällt dabei auf,
 * statt still durchzugehen.
 */
"use server";

import { createHash } from "node:crypto";

import { canOperateSeller } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";
import { de } from "@/lib/i18n/de";
import {
  renderPurchaseReceiptPdf, type ReceiptDocument,
} from "@/lib/business/purchase-receipt";

const copy = de.business.orderbook.receipt;

/** Was die Oberfläche über einen ausgestellten Beleg wissen muss. */
export type ReceiptState = {
  id: number;
  receiptNumber: string;
  issuedAt: string;
  revision: number;
  /** Wie oft ein vollständiger Abruf bestätigt wurde. 0 heisst: noch nie. */
  downloadCount: number;
  /** Der erste bestätigte Abruf, oder `null`. Daran hängt der grüne Haken. */
  firstDeliveredAt: string | null;
  /**
   * Haben sich belegrelevante Daten seit der Ausstellung geändert?
   *
   * Verglichen wird ein Fingerabdruck über GENAU die Felder, die der Beleg
   * zeigt — nicht `purchases.updated_at`, das sich auch bewegt, wenn jemand
   * die interne Notiz anfasst oder den Tagesplatz tauscht.
   */
  stale: boolean;
};

export type ReceiptResult =
  | { ok: true; receipt: ReceiptState | null }
  | { ok: false; message: string };

/**
 * Eine Fassung der Belegkette (0128).
 *
 * `isCurrent` wird NICHT aus `revision` geraten: die Server-Funktion bestimmt
 * sie danach, ob jemand diesen Beleg ersetzt — dieselbe Bedingung, mit der
 * `0122` bis `0124` die Spitze suchen. `stale` gilt nur für die aktuelle
 * Fassung; eine ersetzte ist nicht „veraltet", sondern ersetzt.
 */
export type ReceiptVersion = {
  id: number;
  receiptNumber: string;
  issuedAt: string;
  revision: number;
  formatVersion: number;
  supersedesId: number | null;
  supersedesNumber: string | null;
  supersedesIssuedAt: string | null;
  lineCount: number;
  totalCost: string;
  downloadCount: number;
  firstDeliveredAt: string | null;
  isCurrent: boolean;
  stale: boolean;
};

export type ReceiptHistoryResult =
  | { ok: true; versions: ReceiptVersion[]; correctable: boolean }
  | { ok: false; message: string };

function read(raw: unknown): ReceiptState | null {
  const root = raw as Record<string, unknown> | null;
  const r = root?.receipt as Record<string, unknown> | null | undefined;
  if (!r) return null;
  return {
    id: Number(r.id),
    receiptNumber: String(r.receipt_number),
    issuedAt: String(r.issued_at),
    revision: Number(r.revision),
    downloadCount: Number(r.download_count ?? 0),
    firstDeliveredAt: r.first_delivered_at === null || r.first_delivered_at === undefined
      ? null : String(r.first_delivered_at),
    stale: r.stale === true,
  };
}

/** Der Zustand für den Abschnitt im (i)-Fenster. Liest nur. */
export async function loadPurchaseReceipt(purchaseId: number): Promise<ReceiptResult> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_purchase_receipt", {
    p_purchase_id: purchaseId,
  });
  if (error) return { ok: false, message: receiptMessage(error) };
  return { ok: true, receipt: read(data) };
}

/**
 * Ausstellen — oder den vorhandenen Beleg zurückgeben.
 *
 * Die Server-Funktion ist idempotent: ein zweiter Aufruf legt keinen zweiten
 * Beleg an, sondern antwortet mit dem, der schon da ist. Ein Doppelklick
 * kostet damit höchstens eine Runde, nie eine zweite Belegnummer.
 */
export async function issuePurchaseReceipt(purchaseId: number): Promise<ReceiptResult> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_issue_purchase_receipt", {
    p_purchase_id: purchaseId,
  });
  if (error) return { ok: false, message: receiptMessage(error) };
  return { ok: true, receipt: read(data) };
}

function readVersion(raw: unknown): ReceiptVersion {
  const r = raw as Record<string, unknown>;
  return {
    id: Number(r.id),
    receiptNumber: String(r.receipt_number),
    issuedAt: String(r.issued_at),
    revision: Number(r.revision),
    formatVersion: Number(r.format_version ?? 1),
    supersedesId: r.supersedes_id === null || r.supersedes_id === undefined
      ? null : Number(r.supersedes_id),
    supersedesNumber: r.supersedes_number === null || r.supersedes_number === undefined
      ? null : String(r.supersedes_number),
    supersedesIssuedAt: r.supersedes_issued_at === null
      || r.supersedes_issued_at === undefined ? null : String(r.supersedes_issued_at),
    lineCount: Number(r.line_count ?? 0),
    totalCost: String(r.total_cost ?? "0"),
    downloadCount: Number(r.download_count ?? 0),
    firstDeliveredAt: r.first_delivered_at === null || r.first_delivered_at === undefined
      ? null : String(r.first_delivered_at),
    isCurrent: r.is_current === true,
    stale: r.stale === true,
  };
}

/**
 * Die ganze Belegkette eines Einkaufs (0128). Liest nur.
 *
 * `correctable` kommt aus derselben Bedingung wie das Tor in der
 * Ausstellungsfunktion — die Oberfläche soll nichts anbieten, was der Server
 * ablehnen würde, und nichts verschweigen, was er annähme.
 */
export async function loadPurchaseReceiptHistory(
  purchaseId: number,
): Promise<ReceiptHistoryResult> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_purchase_receipt_history", {
    p_purchase_id: purchaseId,
  });
  if (error) return { ok: false, message: receiptMessage(error) };
  const root = (data ?? {}) as { receipts?: unknown; correctable?: unknown };
  const liste = Array.isArray(root.receipts) ? root.receipts : [];
  return {
    ok: true,
    versions: liste.map(readVersion),
    correctable: root.correctable === true,
  };
}

/**
 * Einen KORREKTURBELEG ausstellen (0128).
 *
 * Sie ist mit Absicht NICHT idempotent: der Server verlangt eine tatsächliche
 * Abweichung vom letzten Beleg und lehnt sonst ab. Ein zweiter Klick legt
 * damit keinen zweiten Beleg über denselben Inhalt an — und das ist die
 * verbindliche Zusicherung, nicht die ausgegraute Schaltfläche.
 *
 * Der ersetzte Beleg wird nicht angefasst: sein Snapshot, seine Nummer und
 * seine Abrufnachweise bleiben, wo sie sind.
 */
export async function issuePurchaseReceiptCorrection(
  purchaseId: number,
): Promise<ReceiptResult> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_issue_purchase_receipt_correction", {
    p_purchase_id: purchaseId,
  });
  if (error) return { ok: false, message: receiptMessage(error) };
  return { ok: true, receipt: read(data) };
}

/**
 * Eine bestätigte Auslieferung festhalten.
 *
 * `sha256` ist der Hash, den der Browser über die empfangenen Bytes gebildet
 * hat. Stimmt er nicht mit dem neu gerenderten Dokument überein, wird NICHTS
 * festgehalten und der Aufrufer bekommt einen Satz — ein falscher Haken wäre
 * schlimmer als gar keiner.
 */
export async function confirmPurchaseReceiptDownload(
  receiptId: number, sha256: string, bytes: number,
): Promise<ReceiptResult> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };

  const document = await loadReceiptDocument(receiptId);
  if (document === null) return { ok: false, message: copy.errors.unknown };

  const rendered = renderPurchaseReceiptPdf(document);
  const expected = createHash("sha256").update(rendered).digest("hex");

  if (expected !== sha256.toLowerCase() || rendered.byteLength !== bytes) {
    return { ok: false, message: copy.errors.mismatch };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_record_purchase_receipt_download", {
    p_receipt_id: receiptId,
    p_bytes: bytes,
  });
  if (error) return { ok: false, message: receiptMessage(error) };
  return { ok: true, receipt: read(data) };
}

/**
 * Den eingefrorenen Beleg laden.
 *
 * Kein `"use server"`-Export mit Rohdaten: die Route und die Bestätigung
 * brauchen ihn, der Browser nicht. `null` heisst „gibt es nicht" — die Route
 * antwortet darauf mit 404 und nicht mit 403, wie alles unter `/business`.
 */
export async function loadReceiptDocument(receiptId: number): Promise<ReceiptDocument | null> {
  if (!(await canOperateSeller())) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_purchase_receipt_document", {
    p_receipt_id: receiptId,
  });
  if (error || data === null || typeof data !== "object") return null;
  return data as ReceiptDocument;
}

/**
 * Die Ablehnungen dieser Funktionen als Sätze.
 *
 * EIGENE ABBILDUNG, UND ZWAR NOTGEDRUNGEN. `orderbookMessage` in
 * `@/lib/orderbook/actions` täte dasselbe, lässt sich aber nicht teilen: die
 * Datei trägt `"use server"`, und aus einer solchen Datei darf nur
 * exportiert werden, was eine asynchrone Funktion ist. Eine synchrone
 * Hilfsfunktion zu exportieren wäre ein Build-Fehler.
 *
 * Die Sätze sind deshalb hier, die Regeln dieselben: jede Ablehnung der
 * Server-Funktion bekommt einen Satz, der sagt, was zu tun ist.
 */
function receiptMessage(error: { code?: string; message?: string } | null): string {
  const text = error?.message ?? "";
  if (error?.code === "42501") return de.admin.notAllowed;
  if (text.includes("seller operator role required")) return de.admin.notAllowed;
  if (text.includes("a test purchase gets no receipt")) return copy.errors.testPurchase;
  if (text.includes("a receipt needs the purchase date")) return copy.errors.noDate;
  if (text.includes("has no item to put on a receipt")) return copy.errors.noItems;
  /* Die zwei Ablehnungen der Korrektur (0128). */
  if (text.includes("nothing changed since the last receipt")) return copy.errors.noChange;
  if (text.includes("there is no receipt to correct")) return copy.errors.noOriginal;
  if (text.includes("no complete business address")) return copy.errors.noBusinessData;
  if (text.includes("cannot be changed or removed")) return copy.errors.immutable;
  if (text.includes("this purchase does not exist")
      || text.includes("this receipt does not exist")) return copy.errors.unknown;
  return de.admin.writeFailed;
}
