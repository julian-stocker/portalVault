/**
 * The core of `verify:sale-refusals:staging` — the refusal-only variant of
 * `verify:sale-locks` (F5 / B2, 2026-11-10).
 *
 * WHY A SECOND TOOL. `verify-sale-locks.mts` books a real `sale_external`
 * movement on the fixture (its sections 14–19), and its `finally` deletes the
 * test sale with the service role even after a failure in between — which can
 * leave exactly the orphaned movement the M-05C diagnosis looks for. That tool
 * stays as it is. This one keeps only what can be undone without a trace:
 *
 *   NO MOVEMENT. No booking, unbooking, return, restock or shipping function is
 *   reachable: every RPC goes through `callRpc`, which refuses any name outside
 *   `ALLOWED_RPCS`, and `FORBIDDEN_RPCS` is held against the source by a test.
 *
 *   NO HOLD. The catalog figure is one WITHOUT a stock row, so
 *   `seller_add_sale_item` → `hold_sale_item` answers `no_inventory` and
 *   reserves nothing. The run checks that no reservation exists for its items.
 *
 *   EVERY WRITE IS CHECKED. A direct update must report exactly one changed row,
 *   or the run stops.
 *
 *   CLEANUP ONLY WHAT IS PROVEN UNBOOKED. Before anything is deleted the run
 *   proves, from the database, that the sale is this run's test sale and that
 *   nothing references it: no movement on any position, no reservation, no
 *   movement naming the sale, and the global movement count and highest id
 *   exactly as before. Then it deletes through `seller_delete_sale` as the
 *   operator — the same gated path a person uses, which itself refuses a sale
 *   with booked positions and releases holds. If the proof fails, NOTHING is
 *   deleted: the run stops and names what is left.
 *
 *   NO HISTORICAL TOTALS. Success is measured on this run's own sale and on
 *   before/after equality, never on a fixed count of real rows.
 */

/** The only RPCs this run may call — all as the temporary operator. */
export const ALLOWED_RPCS = [
  "seller_create_sale", "seller_set_sale_test", "seller_add_sale_item",
  "seller_settle_sale_item", "seller_announce_sale_item_return",
  "seller_sales", "seller_delete_sale",
] as const;
export type AllowedRpc = (typeof ALLOWED_RPCS)[number];

/** Functions that move stock, book, return, restock or ship — never called here. */
export const FORBIDDEN_RPCS = [
  "seller_book_sale_item", "seller_unbook_sale_item", "seller_restock_sale_item",
  "seller_return_sale_item", "seller_set_sale_item_not_shipped", "seller_ship_sale",
  "seller_set_sale_shipped", "record_inventory_movement",
] as const;

export type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

export type Snapshot = {
  quantity: number; reserved: number; movements: number; maxMovementId: number; activeReservations: number;
};

export type SaleRow = {
  id: number; is_test: boolean; note: string | null; order_id: number | null;
  source: string; cancelled_at: string | null; stock_released_at: string | null;
};

export type ItemRow = {
  id: number; sale_id: number; movement_id: number | null; return_movement_id: number | null;
  returned_at: string | null; return_announced_at: string | null; settled_at: string | null;
};

/** Everything the run needs from Staging, as narrow operations. */
export interface RefusalPort {
  activeSellerId(): Promise<number>;
  /** A catalog figure with NO `shop_inventory` row — so nothing can be held. */
  figureWithoutStock(): Promise<string>;
  snapshot(): Promise<Snapshot>;
  sale(id: number): Promise<SaleRow | null>;
  items(saleId: number): Promise<ItemRow[]>;
  /** Reservations of any state that point at one of these positions. */
  reservationsFor(itemIds: number[]): Promise<number>;
  /** Movements whose note names this sale or one of its positions. */
  movementsNaming(saleId: number, itemIds: number[]): Promise<number>;
  leftovers(note: string): Promise<{ sales: number[]; operators: number; users: number }>;

  /** createUser + signIn + `seller_operators` row; returns the new user's id. */
  createOperator(sellerId: number, note: string): Promise<string>;
  /** Remove the membership and the auth user; returns false if either failed. */
  removeOperator(sellerId: number, userId: string): Promise<boolean>;
  /** Direct service-role updates — return the number of rows changed. */
  updateSale(id: number, patch: { cancelled_at?: string | null; source?: string }): Promise<number>;
  updateItem(id: number, patch: { legacy_stock_flag: "-" }): Promise<number>;

  /** As the temporary operator. Called only through `callRpc`. */
  rpc(fn: AllowedRpc, args: Record<string, unknown>): Promise<RpcResult>;
}

export type Report = {
  results: { name: string; passed: boolean; detail: string }[];
  saleId: number | null;
  deleted: boolean;
  leftOver: string[];
};

class Halt extends Error {}

export async function runSaleRefusals(port: RefusalPort, runId: string,
  log: (line: string) => void = () => {}): Promise<Report> {
  const NOTE = `verify:sale-refusals ${runId}`;
  const report: Report = { results: [], saleId: null, deleted: false, leftOver: [] };
  const check = (name: string, passed: boolean, detail = "") => {
    report.results.push({ name, passed, detail });
    log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  };
  const must = (name: string, passed: boolean, detail = "") => {
    check(name, passed, detail);
    if (!passed) throw new Halt(name);
  };
  const callRpc = (fn: AllowedRpc, args: Record<string, unknown>): Promise<RpcResult> => {
    if (!(ALLOWED_RPCS as readonly string[]).includes(fn)) throw new Error(`RPC ${fn} is not allowed in this run`);
    return port.rpc(fn, args);
  };
  const refused = (r: RpcResult, fragment: string) => r.error !== null && r.error.message.includes(fragment);
  /** A direct update must change exactly one row. */
  const updated = async (what: string, n: Promise<number>) => {
    const rows = await n;
    must(`${what} (genau eine Zeile)`, rows === 1, `${rows} Zeilen`);
  };

  let sellerId: number | null = null;
  let userId: string | null = null;
  let itemIds: number[] = [];
  const before = await port.snapshot();
  log(`  Vorher: ${JSON.stringify(before)}`);

  try {
    /* ------------------------------------------------------------ setup */
    sellerId = await port.activeSellerId();
    userId = await port.createOperator(sellerId, NOTE);
    const figure = await port.figureWithoutStock();

    const made = await callRpc("seller_create_sale", {
      p_channel: "manual", p_sold_at: null, p_country: null,
      p_external_ref: null, p_buyer_ref: null, p_note: NOTE,
    });
    must("Testverkauf angelegt", made.error === null, made.error?.message ?? "");
    report.saleId = Number(made.data);
    const saleId = report.saleId;
    const flagged = await callRpc("seller_set_sale_test", { p_id: saleId, p_is_test: true });
    must("als Testvorgang markiert", flagged.error === null, flagged.error?.message ?? "");
    const sale0 = await port.sale(saleId);
    must("der Verkauf ist dieser Testverkauf", sale0 !== null && sale0.is_test && sale0.note === NOTE && sale0.order_id === null);

    for (const [sky, raw] of [[figure, null], [null, `Verify-Refusal-Portal ${runId}`], [figure, null]] as const) {
      const r = await callRpc("seller_add_sale_item", { p_sale_id: saleId, p_sky_id: sky, p_raw_name: raw, p_condition: "loose" });
      must("Position angelegt", r.error === null, r.error?.message ?? "");
    }
    const rows = await port.items(saleId);
    must("drei eigene Positionen", rows.length === 3 && rows.every((r) => r.sale_id === saleId), `${rows.length}`);
    itemIds = rows.map((r) => r.id);
    const [figureItem, portalItem, dashItem] = rows;
    must("keine Reservierung entstanden (Figur ohne Lagerposten)", (await port.reservationsFor(itemIds)) === 0);
    must("keine Position trägt eine Bewegung", rows.every((r) => r.movement_id === null && r.return_movement_id === null));
    await updated("eine Position als nicht-aus-dem-Lager markiert", port.updateItem(dashItem.id, { legacy_stock_flag: "-" }));

    const ledger = async () => {
      const r = await callRpc("seller_sales", { p_year: null, p_month: null, p_search: NOTE, p_undated: true,
        p_scope: "external", p_status: "any" });
      must("seller_sales antwortet", r.error === null, r.error?.message ?? "");
      const row = ((r.data as { sales?: Record<string, unknown>[] }).sales ?? []).find((s) => Number(s.id) === saleId);
      must("der Testverkauf ist im Ledger", row !== undefined);
      return row!;
    };

    /* ---------------------------------------- 1. the ledger counts (0072) */
    const l1 = await ledger();
    check("1  outbooked_count 0", Number(l1.outbooked_count) === 0, `${l1.outbooked_count}`);
    check("1  settled_count 0", Number(l1.settled_count) === 0, `${l1.settled_count}`);
    check("1  open_count 3", Number(l1.open_count) === 3, `${l1.open_count}`);

    /* ------------------- 2. settling an ordinary catalog figure is refused */
    const lock = await callRpc("seller_settle_sale_item", { p_item_id: figureItem.id, p_settled: true });
    check("2  Erledigt für eine gewöhnliche Katalogfigur wird verweigert", refused(lock, "never by being closed"),
      lock.error?.message.slice(0, 60) ?? "ANGENOMMEN");
    if (lock.error === null) {
      /* Unexpectedly accepted: it set settled_at, nothing else. Take it back — freely allowed. */
      const back = await callRpc("seller_settle_sale_item", { p_item_id: figureItem.id, p_settled: false });
      must("2  unerwartete Annahme zurückgenommen", back.error === null, back.error?.message ?? "");
      throw new Halt("2");
    }

    /* ------------------- 3. accepted where there is no shelf (no movement) */
    for (const [label, item] of [["Nicht-Katalog-Position", portalItem], ["als nicht-aus-dem-Lager markierte Figur", dashItem]] as const) {
      const r = await callRpc("seller_settle_sale_item", { p_item_id: item.id, p_settled: true });
      must(`3  Erledigt angenommen: ${label}`, r.error === null, r.error?.message ?? "");
    }
    const r3 = await port.items(saleId);
    must("3  settled_at gesetzt und keine Bewegung",
      r3.filter((r) => r.id !== figureItem.id).every((r) => r.settled_at !== null && r.movement_id === null));

    /* ------------------- 4. settled is not outbooked, and no longer open */
    const l4 = await ledger();
    check("4  settled_count 2", Number(l4.settled_count) === 2, `${l4.settled_count}`);
    check("4  outbooked_count 0", Number(l4.outbooked_count) === 0, `${l4.outbooked_count}`);
    check("4  open_count 1", Number(l4.open_count) === 1, `${l4.open_count}`);

    /* ------------------- 5. announcing a return of an unbooked position is refused */
    const ann = await callRpc("seller_announce_sale_item_return", { p_item_id: figureItem.id, p_announced: true });
    check("5  Retoure ankündigen ohne Ausbuchung wird verweigert", refused(ann, "nothing was booked out of stock"),
      ann.error?.message.slice(0, 60) ?? "ANGENOMMEN");
    if (ann.error === null) {
      const back = await callRpc("seller_announce_sale_item_return", { p_item_id: figureItem.id, p_announced: false });
      must("5  unerwartete Ankündigung zurückgenommen", back.error === null, back.error?.message ?? "");
      throw new Halt("5");
    }

    /* ------------------- 6. a cancelled test sale is not open */
    await updated("6  Testverkauf storniert", port.updateSale(saleId, { cancelled_at: new Date().toISOString() }));
    const l6 = await ledger();
    check("6  ein stornierter Verkauf ist nicht offen", l6.is_open === false, `is_open=${l6.is_open}`);
    await updated("6  Storno zurückgesetzt", port.updateSale(saleId, { cancelled_at: null }));

    /* ------------------- 7. a workbook sale nobody released stays locked */
    await updated("7  Testverkauf als Werkbuch-Verkauf markiert", port.updateSale(saleId, { source: "excel_order_2026" }));
    const undo = await callRpc("seller_settle_sale_item", { p_item_id: portalItem.id, p_settled: false });
    check("7  Erledigt zurücknehmen bleibt möglich", undo.error === null, undo.error?.message ?? "bewusst ungesperrt");
    const frozen = await callRpc("seller_settle_sale_item", { p_item_id: portalItem.id, p_settled: true });
    check("7  Erledigt SETZEN ist dort gesperrt", refused(frozen, "has not been released"),
      frozen.error?.message.slice(0, 60) ?? "ANGENOMMEN");
    await updated("7  Quelle zurückgesetzt", port.updateSale(saleId, { source: "manual" }));
    const again = await callRpc("seller_settle_sale_item", { p_item_id: portalItem.id, p_settled: true });
    must("7  Nicht-Katalog-Position wieder erledigt", again.error === null, again.error?.message ?? "");

    /* ------------------- 8. the counts stay separate, and the status follows */
    const l8 = await ledger();
    check("8  settled_count 2, outbooked_count 0, open_count 1",
      Number(l8.settled_count) === 2 && Number(l8.outbooked_count) === 0 && Number(l8.open_count) === 1,
      `${l8.settled_count}/${l8.outbooked_count}/${l8.open_count}`);
    check("8  noch offen — die Katalogfigur ist es", l8.is_open === true);
  } catch (error) {
    if (!(error instanceof Halt)) {
      check("Durchlauf ohne Ausnahme", false, error instanceof Error ? error.message : String(error));
    } else {
      log("  ABBRUCH nach einer fehlgeschlagenen Prüfung — nichts weiter getestet.");
    }
  } finally {
    await cleanup();
  }

  /* ------------------------------------------------------- after */
  const after = await port.snapshot();
  log(`  Nachher: ${JSON.stringify(after)}`);
  check("Bestand unverändert", after.quantity === before.quantity, `${before.quantity} → ${after.quantity}`);
  check("reserviert unverändert", after.reserved === before.reserved, `${before.reserved} → ${after.reserved}`);
  check("aktive Reservierungen unverändert", after.activeReservations === before.activeReservations,
    `${before.activeReservations} → ${after.activeReservations}`);
  check("keine neue Lagerbewegung (Anzahl)", after.movements === before.movements, `${before.movements} → ${after.movements}`);
  check("keine neue Lagerbewegung (höchste id)", after.maxMovementId === before.maxMovementId,
    `${before.maxMovementId} → ${after.maxMovementId}`);
  const rest = await port.leftovers(NOTE);
  check("kein Testverkauf zurückgeblieben", rest.sales.length === 0, rest.sales.join(", ") || "keiner");
  check("keine Operator-Zuordnung zurückgeblieben", rest.operators === 0, `${rest.operators}`);
  check("kein temporärer Auth-Nutzer zurückgeblieben", rest.users === 0, `${rest.users}`);
  return report;

  /** Delete only what is proven to be this run's unbooked test data. */
  async function cleanup(): Promise<void> {
    const saleId = report.saleId;
    if (saleId !== null) {
      const reasons = await unsafeToDelete(saleId);
      if (reasons.length === 0) {
        const gone = await callRpc("seller_delete_sale", { p_id: saleId });
        const still = await port.sale(saleId);
        report.deleted = gone.error === null && still === null;
        check("Testverkauf über seller_delete_sale entfernt", report.deleted, gone.error?.message ?? "");
        if (!report.deleted) report.leftOver.push(`Testverkauf #${saleId}: Löschen abgelehnt (${gone.error?.message ?? "noch vorhanden"})`);
      } else {
        check("Testverkauf NICHT gelöscht — sichere Rücksetzung nicht nachgewiesen", false, reasons.join("; "));
        report.leftOver.push(`Testverkauf #${saleId} mit Positionen ${itemIds.join(", ") || "?"}: ${reasons.join("; ")}`);
      }
    }
    if (sellerId !== null && userId !== null) {
      const removed = await port.removeOperator(sellerId, userId);
      check("temporärer Operator entfernt", removed);
      if (!removed) report.leftOver.push(`temporärer Operator ${userId.slice(0, 4)}…`);
    }
  }

  /** Every reason the sale must NOT be deleted; empty = proven safe. */
  async function unsafeToDelete(saleId: number): Promise<string[]> {
    const why: string[] = [];
    let sale = await port.sale(saleId);
    if (sale === null) return ["der Verkauf ist nicht mehr lesbar"];
    /* Undo this run's own direct changes first — each checked. */
    if (sale.source !== "manual" && (await port.updateSale(saleId, { source: "manual" })) !== 1) why.push("Quelle nicht zurückgesetzt");
    if (sale.cancelled_at !== null && (await port.updateSale(saleId, { cancelled_at: null })) !== 1) why.push("Storno nicht zurückgesetzt");
    sale = await port.sale(saleId);
    if (sale === null) return ["der Verkauf ist nicht mehr lesbar"];
    if (!sale.is_test) why.push("nicht als Test markiert");
    if (sale.note !== NOTE) why.push("nicht die Notiz dieses Laufs");
    if (sale.order_id !== null) why.push("an einer Bestellung");
    if (sale.stock_released_at !== null) why.push("zur Lagerarbeit freigegeben");
    if (sale.source !== "manual" || sale.cancelled_at !== null) why.push("Quelle/Storno nicht im Ausgangszustand");
    const items = await port.items(saleId);
    if (items.some((i) => i.sale_id !== saleId)) why.push("fremde Position");
    if (items.some((i) => i.movement_id !== null || i.return_movement_id !== null)) why.push("eine Position trägt eine Bewegung");
    if (items.some((i) => i.returned_at !== null || i.return_announced_at !== null)) why.push("eine Position trägt eine Retoure");
    const ids = items.map((i) => i.id);
    if ((await port.reservationsFor(ids)) !== 0) why.push("eine Reservierung zeigt auf eine Position");
    if ((await port.movementsNaming(saleId, ids)) !== 0) why.push("eine Lagerbewegung nennt den Verkauf oder eine Position");
    const now = await port.snapshot();
    if (now.movements !== before.movements || now.maxMovementId !== before.maxMovementId) {
      why.push(`Lagerjournal bewegt (${before.movements}/${before.maxMovementId} → ${now.movements}/${now.maxMovementId})`);
    }
    return why;
  }
}
