/**
 * SYNTHETIC eBay Orders Reports for tests — never a real one.
 *
 * The real reports carry buyer data and live outside the repository
 * (`~/SkyIsles-Daten/ebay/`). This builder writes files of the same SHAPE —
 * the junk first line, the header, the empty record, summary and position
 * rows, the footer — from values that are invented here.
 *
 * It deliberately includes buyer COLUMNS, filled with obviously fake values,
 * so that tests can prove the parser drops them. Their header names are
 * assembled from pieces: `repository-data-hygiene.test.ts` flags any tracked
 * file that carries the eBay report header verbatim, and this file must not
 * look like a report to it.
 */

import type { IsoDay } from "../types.ts";

const K = "Käufers";
/** Buyer columns as eBay names them (assembled, see above). */
export const BUYER_COLUMNS = [
  `Nutzername des ${K}`, `Name des ${K}`, `E-Mail des ${K}`, `Hinweis des ${K}`,
  `Adresse 1 des ${K}`, `Wohnort des ${K}`, `PLZ des ${K}`,
  "Name des Empfängers", "Telefonnummer des Empfängers", "Sendungsnummer",
] as const;

/** Invented values for every buyer column. Tests search the parsed model for each of them. */
export const FAKE_BUYER: Readonly<Record<(typeof BUYER_COLUMNS)[number], string>> = {
  [BUYER_COLUMNS[0]]: "testkaeufer_zz01",
  [BUYER_COLUMNS[1]]: "Testa Käuferin",
  [BUYER_COLUMNS[2]]: "kaeuferin@example.invalid",
  [BUYER_COLUMNS[3]]: "Bitte gut verpacken, Testnotiz",
  [BUYER_COLUMNS[4]]: "Musterweg 99",
  [BUYER_COLUMNS[5]]: "Beispielstadt",
  [BUYER_COLUMNS[6]]: "99999",
  [BUYER_COLUMNS[7]]: "Testa Empfängerin",
  [BUYER_COLUMNS[8]]: "+49 000 0000000",
  [BUYER_COLUMNS[9]]: "TRACK-FAKE-0000",
};

const BUSINESS_COLUMNS = [
  "Verkaufsprotokollnummer", "Bestellnummer", "Artikelnummer", "Angebotstitel", "Anzahl", "Verkauft für",
  "Verpackung und Versand", "Gesamtbetrag", "Verkauft am", "Zahlungsdatum", "Verschickt am - Datum",
  "Versandservice", "Transaktionsnummer", "Variantendetails", "Versand nach - Land", "Bewertung abgegeben",
] as const;

type Column = (typeof BUSINESS_COLUMNS)[number] | (typeof BUYER_COLUMNS)[number];

export type FixtureLine = {
  unit: number;
  qty?: number;
  character?: string | null;
  title?: string;
  listing?: string;
  /** Transaction number; `null` writes an empty cell. */
  tx?: string | null;
};

export type FixtureOrder = {
  ref: string;
  record: number;
  sold: IsoDay;
  paid?: IsoDay | null;
  shipped?: IsoDay | null;
  shipping?: number;
  /** Defaults to goods + shipping. Set it to model a refund (lower) or a cancellation (0). */
  total?: number;
  country?: string;
  service?: string;
  lines: FixtureLine[];
};

export type FixtureOptions = {
  /** `undefined` writes the true order count, `null` omits the footer. */
  footer?: number | null;
  /** Header columns in reverse order, to prove columns are found by name. */
  reversed?: boolean;
  /** Business columns to leave out entirely. */
  omit?: readonly string[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const ebayDate = (day: IsoDay | null | undefined): string => {
  if (!day) return "";
  const [y, m, d] = day.split("-");
  return `${d}-${MONTHS[Number(m) - 1]}-${y.slice(2)}`;
};

export const ebayMoney = (amount: number | null | undefined): string => {
  if (amount === null || amount === undefined) return "";
  const [whole, cents] = Math.abs(amount).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${amount < 0 ? "-" : ""}${grouped},${cents} €`;
};

const quote = (value: string): string => `"${value.replace(/"/g, '""')}"`;

export function ebayReport(orders: readonly FixtureOrder[], options: FixtureOptions = {}): string {
  const omit = new Set(options.omit ?? []);
  let columns: Column[] = [...BUSINESS_COLUMNS.slice(0, 2), ...BUYER_COLUMNS, ...BUSINESS_COLUMNS.slice(2)]
    .filter((c) => !omit.has(c));
  if (options.reversed) columns = [...columns].reverse();

  const row = (values: Partial<Record<Column, string>>): string =>
    columns.map((c) => quote(values[c] ?? "")).join(";");

  const lines: string[] = [";".repeat(40), columns.map(quote).join(";"), ";".repeat(columns.length - 1)];

  for (const order of orders) {
    const goods = order.lines.reduce((sum, l) => sum + (l.qty ?? 1) * l.unit, 0);
    const shipping = order.shipping ?? 5.49;
    const total = order.total ?? Math.round((goods + shipping) * 100) / 100;
    const head: Partial<Record<Column, string>> = {
      Verkaufsprotokollnummer: String(order.record), Bestellnummer: order.ref,
      "Verpackung und Versand": ebayMoney(shipping), Gesamtbetrag: ebayMoney(total),
      "Verkauft am": ebayDate(order.sold), Zahlungsdatum: ebayDate(order.paid === undefined ? order.sold : order.paid),
      "Verschickt am - Datum": ebayDate(order.shipped === undefined ? order.sold : order.shipped),
      Versandservice: order.service ?? "Hermes Päckchen", "Versand nach - Land": order.country ?? "Germany",
      ...FAKE_BUYER,
    };
    const position = (l: FixtureLine, index: number): Partial<Record<Column, string>> => ({
      Verkaufsprotokollnummer: String(order.record), Bestellnummer: order.ref,
      [BUYER_COLUMNS[0]]: FAKE_BUYER[BUYER_COLUMNS[0]],
      Artikelnummer: l.listing ?? "100000000001",
      Angebotstitel: l.title ?? "Skylanders Spyros Adventure Figuren - Große Auswahl",
      Anzahl: String(l.qty ?? 1), "Verkauft für": ebayMoney(l.unit),
      "Verkauft am": ebayDate(order.sold),
      "Verschickt am - Datum": ebayDate(order.shipped === undefined ? order.sold : order.shipped),
      // Deterministic, so two builds of the same orders are the same file.
      Transaktionsnummer: l.tx === null ? "" : (l.tx ?? `9${order.ref.replace(/\D/g, "").slice(-6)}${index}`),
      Variantendetails: l.character === null || l.character === undefined ? "" : `[Charakter:${l.character}]`,
      "Bewertung abgegeben": "Ja",
    });

    if (order.lines.length === 1) {
      lines.push(row({ ...head, ...position(order.lines[0], 0), ...FAKE_BUYER }));
    } else {
      lines.push(row({ ...head, Anzahl: String(order.lines.reduce((n, l) => n + (l.qty ?? 1), 0)), "Verkauft für": ebayMoney(goods) }));
      order.lines.forEach((l, i) => lines.push(row(position(l, i))));
    }
  }

  lines.push("");
  const footer = options.footer === undefined ? orders.length : options.footer;
  if (footer !== null) lines.push(`${footer};Verkaufsprotokoll(e) heruntergeladen;`);
  lines.push("Verkäufername : testshop");
  return `﻿${lines.join("\n")}\n`;
}
