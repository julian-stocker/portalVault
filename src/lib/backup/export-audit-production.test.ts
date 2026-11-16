/**
 * Regression for F4a.1 (2026-11-14): `verify:backup` judged a Production
 * business backup against stock figures frozen on 2026-10-17 (6 152 records,
 * 88 purchases, 2 142 purchase items, 0 receipts). Production is live, so
 * every later, correct backup would have failed three count lines.
 *
 * What this file holds:
 *
 *   1. A Production-shaped file — 28 areas of the 0140 body, rows that
 *      reference each other the way the database enforces — passes with ANY
 *      plausible stock figures, small or large.
 *   2. A genuinely damaged file still fails, at the place it was damaged:
 *      a missing area, a foreign area, a missing field, a dangling reference,
 *      a duplicate key, a self-contradicting count, a wrong format.
 *   3. `BACKUP_REFERENCES` is not invented: every entry is a foreign key in
 *      the migrations, and every column is in the manifest.
 *   4. The tool itself, run as a subprocess on a synthetic file outside the
 *      repository, exits 0 for a good file and 1 for a damaged one.
 *
 * Every row here is invented. No name, no address, no real number.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  auditBackup, BACKUP_REFERENCES, buildFieldPlan, PRODUCTION_BASELINE, type Finding,
} from "./export-audit";
import { BACKUP_SECTIONS } from "./manifest";

const MIGRATIONS = "supabase/migrations";
const LATEST_BODY = (() => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort().reverse();
  for (const f of files) {
    const sql = readFileSync(`${MIGRATIONS}/${f}`, "utf8");
    if (sql.includes("create or replace function public.seller_business_backup()")) return sql;
  }
  throw new Error("no migration defines seller_business_backup()");
})();
/* The plan exactly as the tool builds it: manifest plus the latest body. */
const PLAN = buildFieldPlan(BACKUP_SECTIONS, LATEST_BODY).plan;
const BASELINE = { ...PRODUCTION_BASELINE, fieldPlan: PLAN };
const PROD_KEYS = PRODUCTION_BASELINE.areaKeys;

/** A row carrying every planned field (null), overridden where it matters. */
function row(key: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const plan = PLAN.find((p) => p.key === key)!;
  return { ...Object.fromEntries(plan.expected.map((f) => [f, null])), ...over };
}

/**
 * A Production-shaped business backup: the 28 areas, and `scale` purchases,
 * orders and sales whose references all close — the way the database makes
 * them close.
 */
function productionDocument(scale: number) {
  const data: Record<string, unknown[]> = Object.fromEntries(PROD_KEYS.map((k) => [k, []]));
  for (let i = 1; i <= scale; i++) {
    data.shop_inventory.push(row("shop_inventory", { id: i, sky_id: `SKY-${String(i).padStart(4, "0")}` }));
    data.inventory_movements.push(row("inventory_movements", { id: 2 * i - 1, inventory_id: i }));
    data.inventory_movements.push(row("inventory_movements", { id: 2 * i, inventory_id: i }));
    data.purchases.push(row("purchases", { id: 100 + i }));
    data.purchase_items.push(row("purchase_items", { id: 1000 + i, purchase_id: 100 + i, movement_id: 2 * i - 1 }));
    data.orders.push(row("orders", { id: 500 + i }));
    data.order_lines.push(row("order_lines", { id: 600 + i, order_id: 500 + i, inventory_id: i }));
    data.order_reservations.push(row("order_reservations", { id: 700 + i, order_id: 500 + i, inventory_id: i, movement_id: 2 * i }));
    data.order_line_events.push(row("order_line_events", { id: 800 + i, order_id: 500 + i, order_line_id: 600 + i }));
    data.order_legal_snapshots.push(row("order_legal_snapshots", { order_id: 500 + i }));
    data.invoices.push(row("invoices", { id: 900 + i, order_id: 500 + i }));
    data.sales.push(row("sales", { id: 300 + i, order_id: 500 + i }));
    data.sale_items.push(row("sale_items", { id: 400 + i, sale_id: 300 + i, movement_id: 2 * i }));
    data.sale_fees.push(row("sale_fees", { id: 450 + i, sale_id: 300 + i }));
  }
  data.seller = [row("seller", { id: 1 })];
  const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));
  return {
    format: "skyisles-business-backup", format_version: 1,
    created_at: "2026-11-14T12:00:00+00:00", source_project: "zmiwxswrpkmizvqsgype",
    commerce_mode: "live", snapshot_txid: "100:100:",
    contains_personal_data: true, restore_supported: false,
    counts, data,
  };
}

const failed = (findings: Finding[]) => findings.filter((f) => !f.ok);
const finding = (findings: Finding[], label: string) => findings.find((f) => f.label === label);

describe("a Production backup passes with changed, valid stock figures", () => {
  it.each([1, 7, 120])("%i purchases/orders/sales: no deviation", (scale) => {
    const r = auditBackup(productionDocument(scale), BASELINE);
    expect(failed(r.findings)).toEqual([]);
    expect(r.areaCounts.purchases).toBe(scale);
  });

  it("the numbers are reported, not judged — and the frozen 2026-10-17 figures are gone", () => {
    const r = auditBackup(productionDocument(7), BASELINE);
    expect(finding(r.findings, "Info: Summe aller Datensätze (keine feste Erwartung)")?.ok).toBe(true);
    expect(finding(r.findings, "Info: Anzahl Belege (keine feste Erwartung)")?.detail).toBe("0");
    expect(r.findings.some((f) => /erwartet (6152|88|2142)\b/.test(f.detail))).toBe(false);
    expect(finding(r.findings, "jeder Verweis zwischen Bereichen zeigt auf eine Zeile der Datei")?.detail)
      .toMatch(/^\d+ Verweise, alle geschlossen$/);
  });

  it("an empty but well-formed file passes too (a young shop is mostly empty)", () => {
    const doc = productionDocument(0);
    expect(failed(auditBackup(doc, BASELINE).findings)).toEqual([]);
  });
});

describe("a damaged backup still fails, at the place it was damaged", () => {
  const damaged = (mutate: (d: ReturnType<typeof productionDocument>) => void) => {
    const d = productionDocument(5);
    mutate(d);
    return failed(auditBackup(d, BASELINE).findings).map((f) => f.label);
  };
  const recount = (d: ReturnType<typeof productionDocument>) => {
    d.counts = Object.fromEntries(Object.entries(d.data).map(([k, v]) => [k, v.length]));
  };

  it("a missing area", () => {
    const labels = damaged((d) => { delete d.data.invoices; recount(d); });
    expect(labels).toContain("Anzahl Bereiche");
    expect(labels).toContain("kein Bereich des Manifests fehlt");
  });

  it("an area Production cannot have (sale_item_corrections from 0182)", () => {
    const labels = damaged((d) => { d.data.sale_item_corrections = []; recount(d); });
    expect(labels).toContain("kein unbekannter Bereich");
  });

  it("an area that is not a list", () => {
    const labels = damaged((d) => { (d.data as Record<string, unknown>).orders = {}; });
    expect(labels).toContain("jeder Bereich ist eine Liste");
  });

  it("a field missing from every row of an area", () => {
    const labels = damaged((d) => {
      for (const r of d.data.orders as Record<string, unknown>[]) delete r.order_number;
    });
    expect(labels).toContain("kein vorgesehenes Feld fehlt");
  });

  it("an invoice pointing at an order that is not in the file", () => {
    const d = productionDocument(5);
    (d.data.invoices[0] as Record<string, unknown>).order_id = 99999;
    const f = finding(auditBackup(d, BASELINE).findings,
                      "jeder Verweis zwischen Bereichen zeigt auf eine Zeile der Datei")!;
    expect(f.ok).toBe(false);
    expect(f.detail).toBe("invoices.order_id → orders: 1");
    expect(f.detail).not.toContain("99999");
  });

  it("a truncated area: movements cut off, items still pointing at them", () => {
    const labels = damaged((d) => { d.data.inventory_movements = d.data.inventory_movements.slice(0, 2); recount(d); });
    expect(labels).toContain("jeder Verweis zwischen Bereichen zeigt auf eine Zeile der Datei");
  });

  it("a duplicate key, and a second legal snapshot for one order", () => {
    const d = productionDocument(5);
    d.data.orders.push({ ...(d.data.orders[0] as object) });
    d.data.order_legal_snapshots.push({ ...(d.data.order_legal_snapshots[0] as object) });
    recount(d);
    const f = finding(auditBackup(d, BASELINE).findings, "kein Schlüssel kommt in einem Bereich doppelt vor")!;
    expect(f.ok).toBe(false);
    expect(f.detail).toContain("orders.id: 1");
    expect(f.detail).toContain("order_legal_snapshots.order_id: 1");
  });

  it("counts contradicting the lists", () => {
    const labels = damaged((d) => { d.counts.orders = 4711; });
    expect(labels).toContain("counts stimmt mit den Listen überein");
  });

  it("a wrong format name or version, and a claimed restore", () => {
    expect(damaged((d) => { d.format = "something-else"; })).toContain("Formatname");
    expect(damaged((d) => { d.format_version = 2; })).toContain("Formatversion");
    expect(damaged((d) => { d.restore_supported = true as false; })).toContain("restore_supported ist false");
  });
});

describe("BACKUP_REFERENCES is grounded in the schema", () => {
  /* Every foreign key between exported tables, read from the migrations. */
  const declared = (() => {
    const out = new Set<string>();
    for (const f of readdirSync(MIGRATIONS).filter((x) => /^\d{4}_.*\.sql$/.test(x))) {
      const s = readFileSync(`${MIGRATIONS}/${f}`, "utf8");
      const re = /foreign key \((\w+)\)\s*references public\.(\w+) \((\w+)\)|\n\s+(\w+)\s+(?:bigint|uuid|integer|int)\b[^,\n]*references public\.(\w+)\s*\((\w+)\)/g;
      for (const m of s.matchAll(re)) {
        const head = s.slice(0, m.index);
        const tables = [...head.matchAll(/(?:create table (?:if not exists )?|alter table (?:only )?(?:if exists )?)public\.(\w+)/g)];
        if (tables.length === 0) continue;
        const table = tables[tables.length - 1][1];
        const [col, parent] = m[1] ? [m[1], m[2]] : [m[4], m[5]];
        out.add(`${table}.${col}->${parent}`);
      }
    }
    return out;
  })();
  const sourceOf = (key: string) => BACKUP_SECTIONS.find((s) => s.key === key)!.source;

  it.each(BACKUP_REFERENCES.map((r) => [`${r.from}.${r.column} → ${r.to}`, r] as const))(
    "%s is a foreign key in the migrations and a manifest field", (_, r) => {
      expect(declared.has(`${sourceOf(r.from)}.${r.column}->${sourceOf(r.to)}`)).toBe(true);
      expect(BACKUP_SECTIONS.find((s) => s.key === r.from)!.fields).toContain(r.column);
      expect(PROD_KEYS).toContain(r.from);
      expect(PROD_KEYS).toContain(r.to);
    });

  it("no area is filtered in the export body, except figures (not referenced here)", () => {
    expect(BACKUP_REFERENCES.some((r) => r.to === "figures" || r.from === "figures")).toBe(false);
  });
});

/* ---------------------------------------------------------------- the tool */

const DIR = mkdtempSync(join(tmpdir(), "f4a1-business-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const runTool = (file: string) => {
  const r = spawnSync(process.execPath, ["tools/verify-backup-export.mts", "--file", file], {
    encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

describe("verify:backup end to end, on synthetic Production files", () => {
  it("a good file with today's kind of numbers exits 0 against the Production baseline", () => {
    const f = join(DIR, "skyisles-business-backup-good.json");
    writeFileSync(f, JSON.stringify(productionDocument(12)));
    const r = runTool(f);
    expect(r.out).toContain("zugeordnet über source_project der Datei");
    expect(r.out).toContain("keine festen Bestandszahlen");
    expect(r.out).toContain("ERGEBNIS: 0 Abweichungen.");
    expect(r.status).toBe(0);
  });

  it("a damaged file (dangling reference) exits 1", () => {
    const d = productionDocument(12);
    (d.data.order_lines[3] as Record<string, unknown>).order_id = 424242;
    const f = join(DIR, "skyisles-business-backup-bad.json");
    writeFileSync(f, JSON.stringify(d));
    const r = runTool(f);
    expect(r.out).toMatch(/FEHL\s+jeder Verweis zwischen Bereichen/);
    expect(r.out).not.toContain("424242");
    expect(r.status).toBe(1);
  });
});
