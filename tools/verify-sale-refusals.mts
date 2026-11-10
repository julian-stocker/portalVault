/**
 * Refusals of the Verkauf side, WITHOUT any stock movement (F5 / B2).
 *
 *   npm run verify:sale-refusals:staging
 *
 * STAGING ONLY, AND IT WRITES — but only test data of its own, and never the
 * inventory ledger. The safe variant of `verify:sale-locks`, which books a real
 * movement on the fixture; that tool is left unchanged. What this run does and
 * refuses to do is in `tools/lib/sale-refusals.mts`; this file only binds it to
 * Staging:
 *
 *   - `requireStaging()` compares origin AND service-role key against the
 *     pinned Staging id and `.env.staging` BEFORE any client exists;
 *   - the service role is used for reads, for the temporary operator and for
 *     two checked updates on this run's own rows; every business call goes
 *     through the operator's own session (RLS and `can_operate_active_seller`);
 *   - HTTPS with Node's normal certificate verification (no override).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requireStaging } from "./lib/staging-guard.mts";
import {
  ALLOWED_RPCS, runSaleRefusals, type AllowedRpc, type ItemRow, type RefusalPort, type SaleRow,
} from "./lib/sale-refusals.mts";

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} fehlt — mit --env-file=.env.staging starten.`);
  return value;
};

function stagingPort(admin: SupabaseClient, anon: () => SupabaseClient, runId: string): RefusalPort {
  let operator: SupabaseClient | null = null;
  const fail = (what: string, e: { message: string } | null) => { if (e) throw new Error(`${what}: ${e.message}`); };
  const ITEM_COLUMNS = "id, sale_id, movement_id, return_movement_id, returned_at, return_announced_at, settled_at";

  return {
    async activeSellerId() {
      const r = await admin.from("sellers").select("id").eq("is_active", true).single();
      fail("active seller", r.error);
      return Number(r.data!.id);
    },
    async figureWithoutStock() {
      const stocked = await admin.from("shop_inventory").select("sky_id");
      fail("shop_inventory", stocked.error);
      const held = new Set((stocked.data ?? []).map((r) => String(r.sky_id)));
      const figures = await admin.from("skylanders").select("sky_id").order("sky_id").limit(200);
      fail("skylanders", figures.error);
      const free = (figures.data ?? []).map((r) => String(r.sky_id)).find((s) => !held.has(s));
      if (!free) throw new Error("keine Katalogfigur ohne Lagerposten unter den ersten 200 gefunden");
      return free;
    },
    async snapshot() {
      const inv = await admin.from("shop_inventory").select("quantity, reserved");
      fail("shop_inventory", inv.error);
      const count = await admin.from("inventory_movements").select("id", { count: "exact", head: true });
      fail("inventory_movements", count.error);
      const top = await admin.from("inventory_movements").select("id").order("id", { ascending: false }).limit(1);
      fail("inventory_movements max", top.error);
      const res = await admin.from("order_reservations").select("id", { count: "exact", head: true }).eq("state", "active");
      fail("order_reservations", res.error);
      return {
        quantity: (inv.data ?? []).reduce((s, r) => s + Number(r.quantity), 0),
        reserved: (inv.data ?? []).reduce((s, r) => s + Number(r.reserved), 0),
        movements: count.count ?? -1,
        maxMovementId: Number(top.data?.[0]?.id ?? 0),
        activeReservations: res.count ?? -1,
      };
    },
    async sale(id) {
      const r = await admin.from("sales")
        .select("id, is_test, note, order_id, source, cancelled_at, stock_released_at").eq("id", id).maybeSingle();
      fail("sale", r.error);
      return (r.data as SaleRow | null) ?? null;
    },
    async items(saleId) {
      const r = await admin.from("sale_items").select(ITEM_COLUMNS).eq("sale_id", saleId).order("id");
      fail("sale_items", r.error);
      return (r.data ?? []) as ItemRow[];
    },
    async reservationsFor(itemIds) {
      if (itemIds.length === 0) return 0;
      const r = await admin.from("order_reservations").select("id", { count: "exact", head: true }).in("sale_item_id", itemIds);
      fail("order_reservations", r.error);
      return r.count ?? -1;
    },
    async movementsNaming(saleId, itemIds) {
      const sale = await admin.from("inventory_movements").select("id", { count: "exact", head: true })
        .eq("note", `Orderbuch: externer Verkauf #${saleId}`);
      fail("inventory_movements", sale.error);
      let n = sale.count ?? -1;
      for (const id of itemIds) {
        const pos = await admin.from("inventory_movements").select("id", { count: "exact", head: true })
          .like("note", `%Position ${id}`);
        fail("inventory_movements", pos.error);
        n += pos.count ?? 1;
      }
      return n;
    },
    async leftovers(note) {
      const sales = await admin.from("sales").select("id").eq("note", note);
      fail("sales", sales.error);
      const ops = await admin.from("seller_operators").select("user_id", { count: "exact", head: true }).eq("note", note);
      fail("seller_operators", ops.error);
      const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      fail("listUsers", users.error);
      const mine = (users.data?.users ?? []).filter((u) => (u.email ?? "").startsWith(`sale-refusals-${runId}@`));
      return { sales: (sales.data ?? []).map((r) => Number(r.id)), operators: ops.count ?? -1, users: mine.length };
    },

    async createOperator(sellerId, note) {
      const credentials = {
        email: `sale-refusals-${runId}@skyisles.invalid`,
        password: `refusals-${runId}-${Math.random().toString(36).slice(2)}`,
      };
      const created = await admin.auth.admin.createUser({ ...credentials, email_confirm: true });
      fail("createUser", created.error);
      const userId = created.data.user!.id;
      try {
        const client = anon();
        const signIn = await client.auth.signInWithPassword(credentials);
        fail("signIn", signIn.error);
        const member = await admin.from("seller_operators").insert({ seller_id: sellerId, user_id: userId, note }).select("user_id");
        fail("seller_operators", member.error);
        if ((member.data ?? []).length !== 1) throw new Error("seller_operators: keine Zeile angelegt");
        operator = client;
        return userId;
      } catch (error) {
        /* Half made: take back what exists, then stop. */
        await admin.from("seller_operators").delete().eq("seller_id", sellerId).eq("user_id", userId);
        await admin.auth.admin.deleteUser(userId);
        throw error;
      }
    },
    async removeOperator(sellerId, userId) {
      const m = await admin.from("seller_operators").delete().eq("seller_id", sellerId).eq("user_id", userId).select("user_id");
      const u = await admin.auth.admin.deleteUser(userId);
      return m.error === null && (m.data ?? []).length === 1 && u.error === null;
    },
    async updateSale(id, patch) {
      const r = await admin.from("sales").update(patch).eq("id", id).eq("is_test", true).select("id");
      return r.error ? -1 : (r.data ?? []).length;
    },
    async updateItem(id, patch) {
      const r = await admin.from("sale_items").update(patch).eq("id", id).is("movement_id", null).select("id");
      return r.error ? -1 : (r.data ?? []).length;
    },

    async rpc(fn: AllowedRpc, args) {
      if (!(ALLOWED_RPCS as readonly string[]).includes(fn)) throw new Error(`RPC ${fn} is not allowed`);
      if (operator === null) throw new Error("kein Operator angemeldet");
      const r = await operator.rpc(fn, args);
      return { data: r.data, error: r.error ? { message: r.error.message, code: r.error.code } : null };
    },
  };
}

async function main(): Promise<void> {
  requireStaging("verify:sale-refusals");
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const admin = createClient(url, requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = () => createClient(url, requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), { auth: { persistSession: false } });
  const runId = Date.now().toString(36);

  console.log("\n  VERKAUF: ABLEHNUNGEN OHNE BUCHUNG (Staging)\n");
  const report = await runSaleRefusals(stagingPort(admin, anon, runId), runId, (l) => console.log(l));
  const failed = report.results.filter((r) => !r.passed);
  if (report.leftOver.length > 0) {
    console.log("\n  ZURUECKGEBLIEBEN (nicht automatisch entfernt):");
    for (const l of report.leftOver) console.log(`    ${l}`);
  }
  console.log(`\n${report.results.length - failed.length}/${report.results.length} passed`);
  process.exit(failed.length === 0 && report.leftOver.length === 0 ? 0 : 1);
}

void main();
