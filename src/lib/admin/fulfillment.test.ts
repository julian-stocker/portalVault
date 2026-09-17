import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { snapshotImageSource } from "@/lib/catalog/image";

/**
 * Reversible shipping, and an order line that remembers itself (ADR-0074).
 *
 * Two things are worth holding here and they pull in opposite directions. The
 * fulfilment status must become easy to change, because it is a statement to
 * a customer and statements get corrected. Everything else about an order must
 * stay exactly as hard to change as it was — the money, the stock, the
 * payment, and what the order says it sold.
 */
const MIGRATION = "supabase/migrations/0039_shipping_is_reversible.sql";
const source = (path: string) => readFileSync(path, "utf8");
const code = (path: string) =>
  source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    .replace(/^\s*\/\/.*$/gm, "");

const sql = code(MIGRATION);
const detail = code("src/app/(admin)/admin/orders/[orderNumber]/page.tsx");
const table = code("src/components/admin/order-lines-table.tsx");
const actions = code("src/lib/admin/order-actions.ts");

/** The body of one SQL function, from its definition to its terminator. */
function fn(name: string): string {
  const at = sql.indexOf(`create or replace function public.${name}(`);
  expect(at, name).toBeGreaterThan(-1);
  return sql.slice(at, sql.indexOf("$$;", at));
}

describe("series is snapshotted forward, never backwards", () => {
  it("adds a nullable column", () => {
    const alter = sql.slice(sql.indexOf("alter table public.order_lines"));
    const statement = alter.slice(0, alter.indexOf(";") + 1);
    expect(statement).toContain("add column if not exists series_snapshot text");
    // Nullable is the whole point: historical rows have no answer to give.
    expect(statement).not.toContain("not null");
    expect(statement).not.toContain("default");
  });

  it("contains no backfill of any kind", () => {
    /*
     * The heart of the decision. Historical series cannot be recovered — the
     * only source is today's catalog — so writing it would be a claim about
     * the past dressed as a snapshot. An empty cell is true; a guess is not.
     */
    expect(sql).not.toMatch(/update\s+public\.order_lines/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.order_lines/i);
    expect(sql).not.toMatch(/set\s+series_snapshot\s*=/i);
  });

  it("captures it on INSERT only, which is what makes that structural", () => {
    // A trigger that fires on insert cannot visit a row written last year.
    expect(sql).toContain("before insert on public.order_lines");
    expect(sql).not.toContain("before insert or update on public.order_lines");
  });

  it("reads the catalog once, at the moment the line is written", () => {
    const capture = fn("order_lines_capture_series");
    expect(capture).toContain("from public.skylanders s");
    expect(capture).toContain("join public.series se on se.code = s.series_code");
    expect(capture).toContain("where s.sky_id = new.sky_id");
  });

  it("does not overwrite a value the caller supplied", () => {
    expect(fn("order_lines_capture_series")).toContain("if new.series_snapshot is null then");
  });

  it("never fails a checkout over a display column", () => {
    // An unresolvable figure leaves NULL rather than raising.
    expect(fn("order_lines_capture_series")).not.toContain("raise exception");
  });

  it("refuses a blank, which would read as 'no series' rather than 'not recorded'", () => {
    expect(sql).toContain("order_lines_series_snapshot_shape");
    expect(sql).toContain("series_snapshot is null or length(btrim(series_snapshot)) > 0");
  });

  it("leaves create_order alone", () => {
    // 263 lines, replaced six times, and the entire checkout. Transcribing it
    // to add one display field would risk the wrong thing entirely.
    expect(sql).not.toContain("function public.create_order(");
  });
});

describe("the order shows what it sold, not what the catalog says today", () => {
  it("reads every field from the line snapshot", () => {
    for (const key of ["l.name_snapshot", "l.image_snapshot", "l.series_snapshot"]) {
      expect(sql, key).toContain(key);
    }
  });

  it("never joins the live catalog in either reader", () => {
    const readers = fn("admin_order") + fn("my_order");
    expect(readers).not.toContain("public.skylanders");
    expect(readers).not.toContain("public.categories");
    expect(readers).not.toContain("public.series");
  });

  it("hands the table a line and never a sky_id to look up", () => {
    expect(table).not.toContain("imageOverridePath:");
    expect(table).not.toContain("fetch");
    expect(table).toContain("line.image");
    expect(table).toContain("line.series");
    expect(table).toContain("line.name");
  });

  it("keeps prices as the snapshot too", () => {
    expect(table).toContain("Number(line.unit_price)");
    expect(table).toContain("Number(line.line_total)");
    expect(table).not.toContain("shop_price");
  });

  it("renders a dash for an order placed before the column existed", () => {
    expect(table).toContain("de.admin.orders.lineSeriesUnknown");
    expect(source("src/lib/i18n/de.ts")).toContain('lineSeriesUnknown: "—"');
    // A blank string is treated the same way, not printed as an empty cell.
    expect(table).toContain('value === "" ? de.admin.orders.lineSeriesUnknown : value');
  });
});

describe("the thumbnail comes from the snapshot, through the one resolver", () => {
  it("tells the two reference shapes apart", () => {
    // `SKY-0007/<hash>.webp` is an admin upload; `<hash>.webp` an import.
    expect(snapshotImageSource("SKY-0007/abc123.webp")).toEqual({
      imageFile: null,
      imageOverridePath: "SKY-0007/abc123.webp",
    });
    expect(snapshotImageSource("abc123.webp")).toEqual({
      imageFile: "abc123.webp",
      imageOverridePath: null,
    });
  });

  it("treats a missing snapshot as no picture, not as a broken one", () => {
    for (const empty of [null, undefined, ""]) {
      expect(snapshotImageSource(empty)).toEqual({ imageFile: null, imageOverridePath: null });
    }
  });

  it("is an adapter, not a second resolver", () => {
    const image = code("src/lib/catalog/image.ts");
    // One place builds a storage URL, and it is the one that already did.
    expect((image.match(/storage\/v1\/object\/public/g) ?? []).length).toBe(1);
    expect(table).toContain("imageSrc(snapshotImageSource(line.image))");
  });

  it("is projected by admin_order, which never used to have it", () => {
    expect(fn("admin_order")).toContain("'image', l.image_snapshot");
  });

  it("reserves a fixed box so a row cannot shift", () => {
    expect(table).toContain("h-12 w-12 shrink-0");
    expect(table).toContain("object-contain");
    expect(table).toContain("width={48}");
    expect(table).toContain("height={48}");
  });

  it("falls back to a placeholder of the same size", () => {
    expect(table).toContain("if (src === null)");
    expect(table).toContain("${THUMB} flex items-center justify-center");
    expect(table).toContain("aria-label={copy.lineNoImage}");
  });
});

describe("the items presentation, on both screens", () => {
  it("carries all seven required facts", () => {
    for (const key of [
      "copy.lineImage",
      "copy.lineFigure",
      "copy.lineSeries",
      "copy.lineCondition",
      "copy.lineQuantity",
      "copy.unitPrice",
      "copy.lineTotal",
    ]) {
      expect(table, key).toContain(key);
    }
  });

  it("is one table rendering one set of data, not two layouts to keep in step", () => {
    expect(table).toContain("<table");
    expect((table.match(/lines\.map\(/g) ?? []).length).toBe(1);
  });

  it("does not let seven columns push the page sideways on a phone", () => {
    // Below `md:` the row becomes a block; the header has nothing to head and
    // is hidden rather than scrolled past.
    expect(table).toContain("hidden md:table-header-group");
    expect(table).toContain("md:table-row");
    expect(table).toContain("grid grid-cols-[3rem_1fr_auto]");
    expect(table).not.toContain("overflow-x");
    expect(detail).not.toContain("overflow-x");
  });

  it("keeps the numbers scannable", () => {
    expect((table.match(/tabular-nums/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(table).toContain("md:text-right");
  });

  it("replaced the prose rows entirely", () => {
    expect(detail).toContain("<OrderLinesTable lines={lines} />");
    expect(detail).not.toContain("{lines.map(");
  });
});

describe("the page follows the order of the work", () => {
  it("puts Sendungsnummer before Versandstatus", () => {
    const tracking = detail.indexOf("<TrackingForm");
    const status = detail.indexOf("copy.statusHeading");
    expect(tracking).toBeGreaterThan(-1);
    expect(status).toBeGreaterThan(-1);
    expect(tracking).toBeLessThan(status);
  });

  it("no longer heads the section with the old shipping title", () => {
    expect(detail).toContain("copy.statusHeading");
  });
});

describe("tracking is independent of the status, in both directions", () => {
  it("is editable whether or not the order has gone", () => {
    expect(detail).toContain('shipped={order.fulfillment_status === "shipped"}');
    const trackingForm = code("src/components/admin/tracking-form.tsx");
    // The control is rendered for both states; `shipped` only picks the copy.
    expect(trackingForm).not.toContain("if (shipped) return null");
  });

  it("is not frozen by the fulfilment trigger", () => {
    expect(fn("orders_protect_fulfillment")).not.toContain("tracking_number");
  });

  it("survives the status going back", () => {
    const unship = fn("admin_unmark_order_shipped");
    expect(unship).toContain("set fulfillment_status = 'unfulfilled'");
    expect(unship).not.toContain("tracking_number =");
  });

  it("is only ever cleared by the operator's own edit", () => {
    expect(actions).toContain('supabase.rpc("admin_set_tracking_number"');
    expect(fn("admin_unmark_order_shipped")).not.toContain("admin_set_tracking_number");
  });
});

describe("the two transitions, and the ones still refused", () => {
  const guard = fn("orders_protect_fulfillment");

  it("allows shipping", () => {
    expect(guard).toContain(
      "(old.fulfillment_status = 'unfulfilled' and new.fulfillment_status = 'shipped')",
    );
  });

  it("allows the way back", () => {
    expect(guard).toContain(
      "(old.fulfillment_status = 'shipped' and new.fulfillment_status = 'unfulfilled')",
    );
  });

  it("supports shipping again after a correction", () => {
    // Nothing is one-shot: the pair is symmetric, so unfulfilled → shipped →
    // unfulfilled → shipped is four legal moves.
    const allowed = guard.slice(guard.indexOf("if not ("), guard.indexOf("then", guard.indexOf("if not (")));
    expect(allowed).toContain("'unfulfilled' and new.fulfillment_status = 'shipped'");
    expect(allowed).toContain("'shipped' and new.fulfillment_status = 'unfulfilled'");
  });

  it("still refuses the states with no workflow", () => {
    for (const status of ["preparing", "completed", "cancelled"]) {
      expect(guard, status).not.toContain(`new.fulfillment_status = '${status}'`);
    }
    expect(guard).toContain("raise exception 'fulfillment cannot go from % to %'");
  });

  it("still refuses to let fulfilment touch the resolution flag", () => {
    expect(guard).toContain("fulfillment must not change needs_resolution");
  });
});

describe("shipped_at means the shipment it belongs to", () => {
  const guard = fn("orders_protect_fulfillment");

  it("is the server clock on the way out", () => {
    expect(guard).toContain("new.shipped_at := now();");
  });

  it("is cleared on the way back", () => {
    // A date on an order that is not shipped would be a lie that survives.
    expect(guard).toContain("new.shipped_at := null;");
  });

  it("gets a new reading if the order ships again", () => {
    // Set inside the transition branch, so every transition to `shipped`
    // reads the clock afresh.
    expect(guard).toContain("if new.fulfillment_status = 'shipped' then");
  });

  it("cannot drift without a transition", () => {
    expect(guard).toContain("new.shipped_at := old.shipped_at;");
  });

  it("is never named by a caller", () => {
    expect(fn("admin_unmark_order_shipped")).not.toContain("shipped_at =");
  });

  it("disappears from the page with the status", () => {
    expect(detail).toContain('order.fulfillment_status === "shipped" && order.shipped_at');
  });
});

describe("un-shipping changes the status and nothing else", () => {
  const unship = fn("admin_unmark_order_shipped");

  it("writes exactly one column", () => {
    const update = unship.slice(unship.indexOf("update public.orders"), unship.indexOf("where id"));
    expect(update).toContain("set fulfillment_status = 'unfulfilled'");
    expect(update.split("=")).toHaveLength(2);
  });

  it("touches no inventory and no reservation", () => {
    for (const forbidden of [
      "inventory_movements",
      "shop_inventory",
      "order_reservations",
      "convert_order_reservations",
      "release_order_reservations",
    ]) {
      expect(unship, forbidden).not.toContain(forbidden);
    }
  });

  it("touches no payment and no Stripe record", () => {
    for (const forbidden of ["payment_status", "paid_at", "payment_", "stripe"]) {
      expect(unship.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("touches no order line, price or amount", () => {
    for (const forbidden of ["order_lines", "total_amount", "items_subtotal", "unit_price"]) {
      expect(unship, forbidden).not.toContain(forbidden);
    }
  });

  it("touches no test-order state", () => {
    expect(unship).not.toContain("commerce_mode");
    expect(unship).not.toContain("sandbox");
  });

  it("appends one journal entry and deletes none", () => {
    expect(unship).toContain("insert into public.order_events");
    expect(unship).toContain("'order_unshipped'");
    expect(unship).not.toContain("delete from public.order_events");
  });

  it("refuses an order that is not shipped", () => {
    expect(unship).toContain("if v_order.fulfillment_status <> 'shipped' then");
  });

  it("locks the row while it decides", () => {
    expect(unship).toContain("for update");
  });
});

describe("the mail, and the absence of one", () => {
  it("sends nothing when the status goes back", () => {
    const unshipAction = actions.slice(
      actions.indexOf("export async function unmarkOrderShipped"),
      actions.indexOf("export async function setTrackingNumber"),
    );
    expect(unshipAction).not.toContain("sendOrderMail");
    expect(fn("admin_unmark_order_shipped")).not.toContain("order_mail");
  });

  it("still sends the shipping confirmation when an order ships", () => {
    expect(actions).toContain('await sendOrderMail(orderNumber, "shipping_confirmation")');
  });

  it("cannot send it twice when an order ships again", () => {
    /*
     * No new guard was added and none is needed: `order_mail` is keyed on
     * (order, kind) and `claim_order_mail()` treats `sent` as terminal, so a
     * second attempt is answered `already_sent` in the database.
     */
    const mail = source("supabase/migrations/0019_transactional_mail.sql");
    expect(mail).toContain("constraint order_mail_pk primary key (order_id, kind)");
    expect(mail).toContain("return 'already_sent';");
    // 0039 adds no guard of its own and rewrites no mail function. (It does
    // read `order_mail` — `admin_order()` has always projected the delivery
    // state — so the assertion is about what it WRITES.)
    expect(sql).not.toMatch(/insert\s+into\s+public\.order_mail/i);
    expect(sql).not.toMatch(/update\s+public\.order_mail/i);
    expect(sql).not.toContain("function public.claim_order_mail(");
  });
});

describe("the customer sees the current status", () => {
  const page = code("src/app/(app)/account/orders/[orderNumber]/page.tsx");

  it("states it from the order rather than inferring it", () => {
    expect(page).toContain("copy.shipmentStatus");
    expect(page).toContain("copy.fulfillmentStatus[String(order.fulfillment_status");
  });

  it("uses the customer's own labels", () => {
    const copy = source("src/lib/i18n/de.ts");
    expect(copy).toContain('shipmentStatus: "Versandstatus"');
    expect(page).not.toContain("de.admin.orders.fulfillmentStatus");
  });

  it("shows the tracking number independently of the status", () => {
    // "Nicht versendet" beside a recorded number is a legitimate state after a
    // correction, not a contradiction.
    expect(page).toContain("{order.tracking_number ? (");
    const status = page.indexOf("copy.shipmentStatus");
    const tracking = page.indexOf("{order.tracking_number ? (");
    expect(status).toBeLessThan(tracking);
  });

  it("is not otherwise redesigned", () => {
    for (const kept of ["copy.placedAt", "copy.shippingMethod", "copy.total", "copy.snapshotNote"]) {
      expect(page, kept).toContain(kept);
    }
  });
});

describe("authorization", () => {
  it("gates the new function on the shop administrator", () => {
    const unship = fn("admin_unmark_order_shipped");
    expect(unship).toContain("if not public.is_shop_admin() then");
    expect(unship).toContain("security definer");
    expect(unship).toContain("set search_path = ''");
  });

  it("grants it the way every other admin RPC is granted", () => {
    expect(sql).toContain(
      "revoke all on function public.admin_unmark_order_shipped(text) from public, anon",
    );
    expect(sql).toContain(
      "grant execute on function public.admin_unmark_order_shipped(text) to authenticated",
    );
  });

  it("asks the role before the database in the server action", () => {
    const unshipAction = actions.slice(
      actions.indexOf("export async function unmarkOrderShipped"),
      actions.indexOf("export async function setTrackingNumber"),
    );
    expect(unshipAction).toContain("if (!(await isAdmin())) return { ok: false");
  });

  it("gives a tester nothing", () => {
    // A tester permission grants exactly what it names (ADR-0071), and none of
    // them names fulfilment.
    expect(sql).not.toContain("has_tester_permission");
    expect(sql).not.toContain("is_commerce_tester");
  });

  it("weakens no policy and no table grant", () => {
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/grant [a-z, ]+ on public\.orders/i);
    expect(sql).not.toMatch(/grant [a-z, ]+ on public\.order_lines/i);
    expect(sql).not.toMatch(/disable row level security/i);
    expect(sql).not.toContain("drop trigger if exists orders_fulfillment_guard");
  });

  it("leaves the amount and identity freeze in place", () => {
    expect(sql).not.toContain("orders_protect_immutable");
    expect(source("supabase/migrations/0010_commerce_core.sql")).toContain(
      "create trigger orders_immutable",
    );
  });
});

describe("test orders are ordinary orders", () => {
  it("get the same control", () => {
    expect(code("src/components/admin/ship-order-form.tsx")).not.toContain("sandbox");
    // `shipBlocker` decides who may ship, and it looks at three fields; the
    // order's commerce mode is not one of them.
    const blocker = code("src/lib/admin/orders.ts");
    const body = blocker.slice(
      blocker.indexOf("export function shipBlocker"),
      blocker.indexOf("return null;", blocker.indexOf("export function shipBlocker")),
    );
    expect(body).not.toContain("commerce_mode");
    expect(body).not.toContain("sandbox");
  });

  it("are not special-cased anywhere 0039 writes", () => {
    // `admin_order()` still PROJECTS commerce_mode, as it always did — the
    // page shows a test badge. Nothing branches on it.
    expect(fn("admin_unmark_order_shipped")).not.toContain("commerce_mode");
    expect(fn("orders_protect_fulfillment")).not.toContain("commerce_mode");
    expect(fn("order_lines_capture_series")).not.toContain("commerce_mode");
  });
});

describe("what 0039 leaves alone", () => {
  it("edits no earlier migration", () => {
    for (const earlier of ["0018", "0023", "0035", "0036", "0037", "0038"]) {
      const file = `supabase/migrations/`;
      expect(sql.includes(`${file}${earlier}`), earlier).toBe(false);
    }
    expect(sql).not.toContain("drop table");
    expect(sql).not.toContain("drop column");
  });

  it("does not depend on 0035", () => {
    expect(sql).not.toContain("system_set_image_override");
  });

  it("does not touch performance telemetry", () => {
    for (const forbidden of ["perf_navigations", "perf_interactions", "record_navigation"]) {
      expect(sql, forbidden).not.toContain(forbidden);
    }
  });

  it("does not redefine the shipping or tracking writers", () => {
    expect(sql).not.toContain("function public.admin_mark_order_shipped(");
    expect(sql).not.toContain("function public.admin_set_tracking_number(");
  });
});
