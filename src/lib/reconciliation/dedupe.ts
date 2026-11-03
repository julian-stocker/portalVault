/**
 * Several report files → one set of orders.
 *
 * Three things can repeat, and they are told apart:
 *
 *   the same FILE        uploaded twice — identical content, ignored once;
 *   the same ORDER       in two files with identical content — expected when
 *                        two exports overlap, kept once;
 *   a CONFLICT           the same order number with different content — never
 *                        resolved silently; both versions are reported and
 *                        the order is left out of the merged set.
 *
 * The content fingerprint needs SHA-256, which the browser offers only
 * asynchronously (`crypto.subtle`) and Node synchronously. So the hash is a
 * parameter rather than an import, and this module stays pure.
 */

import type { ExternalOrder, ExternalReport } from "./types";

export type Sha256 = (text: string) => string | Promise<string>;

/**
 * The fingerprint of a file's CONTENT: BOM dropped, line endings unified.
 * The same export saved by two editors is the same file.
 */
export async function fileFingerprint(text: string, sha256: Sha256): Promise<string> {
  const body = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n?/g, "\n");
  return sha256(body);
}

export type FingerprintedReport = { report: ExternalReport; fingerprint: string };

export type OrderConflict = {
  orderRef: string;
  files: string[];
  /** The fields whose values differ between the versions. */
  fields: string[];
};

export type MergedReports = {
  orders: ExternalOrder[];
  /** Files skipped because an identical one was already read. */
  duplicateFiles: { fileName: string; sameAs: string }[];
  /** Orders found in more than one file with identical content. */
  repeatedOrders: { orderRef: string; files: string[] }[];
  conflicts: OrderConflict[];
};

/** The order without where it was read from — what "the same order" compares. */
const comparable = (order: ExternalOrder): Partial<ExternalOrder> => {
  const rest: Partial<ExternalOrder> = { ...order };
  delete rest.sourceFile;
  return rest;
};

function differingFields(a: ExternalOrder, b: ExternalOrder): string[] {
  const left = comparable(a) as Record<string, unknown>;
  const right = comparable(b) as Record<string, unknown>;
  return Object.keys(left).filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]));
}

export function mergeReports(inputs: readonly FingerprintedReport[]): MergedReports {
  const seenFiles = new Map<string, string>();
  const duplicateFiles: MergedReports["duplicateFiles"] = [];
  const versions = new Map<string, ExternalOrder[]>();

  for (const { report, fingerprint } of inputs) {
    const first = seenFiles.get(fingerprint);
    if (first !== undefined) {
      duplicateFiles.push({ fileName: report.fileName, sameAs: first });
      continue;
    }
    seenFiles.set(fingerprint, report.fileName);
    for (const order of report.orders) {
      const list = versions.get(order.orderRef);
      if (list) list.push(order);
      else versions.set(order.orderRef, [order]);
    }
  }

  const orders: ExternalOrder[] = [];
  const repeatedOrders: MergedReports["repeatedOrders"] = [];
  const conflicts: OrderConflict[] = [];
  for (const [orderRef, list] of versions) {
    if (list.length === 1) {
      orders.push(list[0]);
      continue;
    }
    const fields = new Set<string>();
    for (const other of list.slice(1)) for (const f of differingFields(list[0], other)) fields.add(f);
    const files = list.map((o) => o.sourceFile);
    if (fields.size === 0) {
      orders.push(list[0]);
      repeatedOrders.push({ orderRef, files });
    } else {
      conflicts.push({ orderRef, files, fields: [...fields].sort() });
    }
  }

  return { orders, duplicateFiles, repeatedOrders, conflicts };
}
