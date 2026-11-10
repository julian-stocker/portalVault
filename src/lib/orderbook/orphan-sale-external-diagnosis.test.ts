/**
 * M-05C — the read-only diagnosis for orphaned `sale_external` movements
 * (`supabase/checks/m05c_orphan_sale_external_readonly.sql`), run on real
 * PostgreSQL (PGlite) inside a READ ONLY transaction.
 *
 * The world carries exactly the columns the file reads, named as in the
 * Staging schema of 2026-11-09, and every table with a foreign key onto
 * `inventory_movements`. One case per class, plus the edges the file names
 * as approximations (a correction BEFORE the movement does not compensate;
 * two orphans on one stock row and one correction → one each).
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const FILE = "supabase/checks/m05c_orphan_sale_external_readonly.sql";
const SQL = readFileSync(FILE, "utf8");

const WORLD = `
create table public.shop_inventory (id bigint primary key, sky_id text not null);
create table public.inventory_movements (id bigint primary key, inventory_id bigint not null references public.shop_inventory (id),
  delta integer not null, reason text not null, note text, created_at timestamptz not null);
create table public.sales (id bigint primary key, cancelled_at timestamptz, is_test boolean not null default false);
create table public.sale_items (id bigint primary key, sale_id bigint not null references public.sales (id) on delete cascade,
  movement_id bigint references public.inventory_movements (id), return_movement_id bigint references public.inventory_movements (id));
create table public.order_reservations (id bigint primary key, movement_id bigint references public.inventory_movements (id),
  reverted_movement_id bigint references public.inventory_movements (id));
create table public.order_line_events (id bigint primary key, movement_id bigint references public.inventory_movements (id),
  correction_movement_id bigint references public.inventory_movements (id));
create table public.purchase_items (id bigint primary key, movement_id bigint references public.inventory_movements (id));
create table public.inventory_import_rows (id bigint primary key, movement_id bigint references public.inventory_movements (id));

insert into public.shop_inventory values (1, 'SKY-0001'), (2, 'SKY-0002'), (3, 'SKY-0003'), (4, 'SKY-0004'),
  (5, 'SKY-0005'), (6, 'SKY-0006'), (7, 'SKY-0007'), (8, 'SKY-0008'), (9, 'SKY-0009');
insert into public.sales (id, is_test) values (1, false), (2, false), (3, true), (4, false);

-- t0 … t9: one hour apart
create function t(h int) returns timestamptz language sql as $$ select '2026-10-01 10:00+00'::timestamptz + make_interval(hours => h) $$;

insert into public.inventory_movements values
  -- Z: booked, the position points at it
  (101, 1, -1, 'sale_external', 'Orderbuch: externer Verkauf #1', t(0)),
  -- A1: the R1 shape — sale gone, nothing points at it, no correction
  (102, 2, -1, 'sale_external', 'Orderbuch: externer Verkauf #99', t(1)),
  -- B1: booked, unbooked, then deleted — sale and position gone, the correction stays
  (103, 3, -1, 'sale_external', 'Orderbuch: externer Verkauf #98', t(1)),
  (203, 3,  1, 'correction',    'Orderbuch: Ausbuchen zurückgenommen, Position 555', t(2)),
  -- A1: a correction BEFORE the movement compensates nothing
  (204, 4,  1, 'correction',    'Orderbuch: Ausbuchen zurückgenommen, Position 556', t(0)),
  (104, 4, -1, 'sale_external', 'Orderbuch: externer Verkauf #97', t(1)),
  -- B2: sale present, its position 20 unbooked
  (105, 5, -1, 'sale_external', 'Orderbuch: externer Verkauf #2', t(1)),
  (205, 5,  1, 'correction',    'Orderbuch: Ausbuchen zurückgenommen, Position 20', t(2)),
  -- A2: sale present (a test sale), no position, no correction
  (106, 6, -1, 'sale_external', 'Orderbuch: externer Verkauf #3', t(1)),
  -- B3: only a converted hold points at it
  (107, 7, -1, 'sale_external', 'Orderbuch: externer Verkauf #4', t(1)),
  -- C: a hand booking with free text — the text must never appear in the output
  (108, 8, -1, 'sale_external', 'eBay an Max Mustermann, Hauptstrasse 1', t(1)),
  (109, 8, -1, 'sale_external', null, t(2)),
  -- two orphans on one stock row, one later correction → the first B1, the second A1
  (110, 9, -1, 'sale_external', 'Orderbuch: externer Verkauf #95', t(1)),
  (111, 9, -1, 'sale_external', 'Orderbuch: externer Verkauf #96', t(2)),
  (211, 9,  1, 'correction',    'Orderbuch: Ausbuchen zurückgenommen, Position 557', t(3)),
  -- other reasons are not looked at
  (301, 1,  5, 'purchase', null, t(0)),
  (302, 1, -1, 'writeoff', 'Orderbuch: externer Verkauf #99', t(0));
insert into public.sale_items (id, sale_id, movement_id) values (10, 1, 101), (20, 2, null);
insert into public.order_reservations (id, movement_id) values (1, 107);
`;

type Row = Record<string, unknown> & { klasse: string; movement_id: number | null; anzahl: number | null; zeile: number };
let db: PGlite;
let rows: Row[] = [];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(WORLD);
  await db.exec("begin read only");
  try { rows = (await db.query<Row>(SQL)).rows.map((r) => ({ ...r, movement_id: r.movement_id === null ? null : Number(r.movement_id), anzahl: r.anzahl === null ? null : Number(r.anzahl) })); }
  finally { await db.exec("rollback"); }
});
afterAll(async () => { await db.close(); });

const klasseOf = (id: number) => rows.find((r) => r.movement_id === id)?.klasse;

describe("m05c_orphan_sale_external_readonly.sql", () => {
  it("classifies every unbooked sale_external movement as documented", () => {
    expect(klasseOf(102)).toBe("A1");
    expect(klasseOf(104)).toBe("A1");
    expect(klasseOf(106)).toBe("A2");
    expect(klasseOf(103)).toBe("B1");
    expect(klasseOf(105)).toBe("B2");
    expect(klasseOf(107)).toBe("B3");
    expect(klasseOf(108)).toBe("C");
    expect(klasseOf(109)).toBe("C");
    expect([klasseOf(110), klasseOf(111)]).toEqual(["B1", "A1"]);
  });
  it("lists no booked movement and no other reason in the detail rows", () => {
    const listed = rows.filter((r) => r.zeile === 1).map((r) => r.movement_id);
    for (const id of [101, 203, 204, 205, 211, 301, 302]) expect(listed, String(id)).not.toContain(id);
    expect(listed).toHaveLength(10);
  });
  it("the overview counts each class, Z included", () => {
    const sum = Object.fromEntries(rows.filter((r) => r.zeile === 0).map((r) => [r.klasse, r.anzahl]));
    expect(sum).toEqual({ A1: 3, A2: 1, B1: 2, B2: 1, B3: 1, C: 2, Z: 1 });
    expect(rows[0].klasse).toBe("A1");   // the overview comes first, suspicion first
  });
  it("shows the test flag for an existing sale, and never the note text", () => {
    expect(rows.find((r) => r.movement_id === 106)?.verkauf_test).toBe(true);
    const text = JSON.stringify(rows);
    for (const leak of ["Mustermann", "Hauptstrasse", "Orderbuch:"]) expect(text).not.toContain(leak);
  });
  it("is a single SELECT: no write, no DDL, no function call that writes — and runs read only", () => {
    const code = SQL.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    expect(code.trim().startsWith("with ")).toBe(true);
    expect(code.split(";").filter((s) => s.trim())).toHaveLength(1);
    expect(code).not.toMatch(/\b(insert|update|delete|truncate|create|alter|drop|grant|revoke|call|perform|copy)\b/i);
    expect(code).not.toMatch(/\bpublic\.[a-z_]+\s*\(/);   // no function of the project is called
    expect(rows.length).toBeGreaterThan(0);              // and it did run inside `begin read only`
  });
  it("stays out of the automatic Staging suite (runs only after its own approval)", () => {
    expect(readFileSync("supabase/checks/staging-suite.json", "utf8")).not.toContain("m05c_orphan_sale_external_readonly.sql");
  });
});
