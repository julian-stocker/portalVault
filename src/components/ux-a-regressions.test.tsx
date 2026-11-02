// @vitest-environment jsdom
/**
 * UX-A — sechs bestätigte Fehler aus dem UX-Audit (2026-11-02).
 *
 * Jeder Block hält einen Fehler fest, der tatsächlich auf dem Schirm stand,
 * und zwar dort, wo es geht, gerendert und nicht als Quelltextvergleich.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/account/actions", () => ({
  saveContact: async () => ({ ok: true }),
  deleteContact: async () => ({ ok: true }),
}));

import { de } from "@/lib/i18n/de";
import { conditionLabel } from "@/lib/shop/condition";
import { CHANGE_FIELD_LABELS, changeFieldLabel } from "@/lib/admin/change-field";
import { AVAILABILITY_BELL_RELEASED } from "@/components/catalog/availability-bell";
import { ContactForm } from "@/components/account/contact-form";

const read = (path: string) => readFileSync(path, "utf8");

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/* ===================================================================== */
describe("UX-A1 — Kunden-Bestelldetail spricht dieselbe Sprache wie der Shop", () => {
  const PAGE = read("src/app/(app)/account/orders/[orderNumber]/page.tsx");

  it("die Zeile benutzt conditionLabel() und keine eigenen Wörter", () => {
    expect(PAGE).toContain("conditionLabel(isOfferCondition(line.condition)");
    expect(PAGE).not.toContain('"Lose"');
    expect(PAGE).not.toContain('? "OVP"');
  });

  it("gebraucht heißt „Gebraucht“, OVP bleibt „OVP“ — wie in Warenkorb und Checkout", () => {
    expect(conditionLabel("loose")).toBe(de.shop.conditionLoose);
    expect(conditionLabel("loose")).toBe("Gebraucht");
    expect(conditionLabel("boxed")).toBe("OVP");
  });
});

/* ===================================================================== */
describe("UX-A2 — Platztausch: kein Platz gewählt ist „—“", () => {
  const DETAILS = read("src/components/business/purchase-details.tsx");

  it("die leere Wahl im Tauschfeld ist „—“ wie im Verkaufsfenster", () => {
    const tausch = DETAILS.slice(DETAILS.indexOf("swapPlace(place)"),
      DETAILS.indexOf("dayOrder.filter((row) => row.id !== purchase.id)"));
    expect(tausch).toContain('<option value="">—</option>');
    expect(tausch).not.toContain("platformUnknown");
    const verkauf = read("src/components/business/sale-details.tsx");
    expect(verkauf).toContain('<option value="">—</option>');
  });

  it("„Unbekannt“ bleibt die Bezeichnung einer fehlenden Plattform im Ledger", () => {
    expect(read("src/components/business/orderbook-ledger.tsx"))
      .toContain("copy.detailsModal.platformUnknown");
  });
});

/* ===================================================================== */
describe("UX-A3 — keine tote Glocke auf der Kachel", () => {
  it("ist nicht freigegeben, solange UX-02 nicht gebaut ist", () => {
    expect(AVAILABILITY_BELL_RELEASED).toBe(false);
  });

  it("die Kachel fragt den Schalter, bevor sie eine Glocke baut", () => {
    const card = read("src/components/catalog/catalog-card.tsx");
    expect(card).toContain(
      'const bell = AVAILABILITY_BELL_RELEASED && accountType === "user" ? <AvailabilityBell /> : null;');
  });

  it("die Komponente selbst bleibt — für den Tag, an dem sie funktioniert", () => {
    expect(read("src/components/catalog/availability-bell.tsx"))
      .toContain("export function AvailabilityBell()");
    expect(read("src/components/catalog/figure-row.tsx")).toContain("{!offered && bellSlot ?");
  });
});

/* ===================================================================== */
describe("UX-A4 — die Warnung im Löschdialog hat eine Farbe", () => {
  const CSS = read("src/app/globals.css");

  it("benutzt den vorhandenen Hinweiston, und den gibt es als Tailwind-Farbe", () => {
    expect(read("src/components/admin/card-actions.tsx"))
      .toContain('className="mt-2 text-xs text-attention">{de.admin.deleteConfirmPublic}');
    expect(CSS).toContain("--attention: #f5b544;");
    expect(CSS).toContain("--color-attention: var(--attention);");
  });

  it("nirgends steht mehr eine Warnfarbe, die das Designsystem nicht kennt", () => {
    /* `text-warning` war still farblos: es gibt kein `--color-warning`. */
    expect(CSS).not.toMatch(/--color-warning\b/);
    const offen: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)
          && /\b(text|bg|ring|border)-warning\b/.test(read(path))) offen.push(path);
      }
    };
    walk("src");
    expect(offen).toEqual([]);
  });
});

/* ===================================================================== */
describe("UX-A5 — die Änderungshistorie nennt Felder, keine Spalten", () => {
  /* Alle Feldnamen, die die Prüfregel des Journals je zugelassen hat — aus
     den Migrationen gelesen, damit eine neue Spalte hier auffällt. */
  const journalFields = (): string[] => {
    const found = new Set<string>();
    for (const file of readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"))) {
      const sql = read(`supabase/migrations/${file}`);
      if (!sql.includes("catalog_admin_changes_field_known")) continue;
      for (const block of sql.matchAll(/check \(field in \(([\s\S]*?)\)\)/g)) {
        for (const m of block[1].matchAll(/'([a-z_]+)'/g)) found.add(m[1]);
      }
      for (const m of sql.matchAll(/(?:v_liste|v_werte) := (?:v_liste|v_werte) \|\| array\[([^\]]*)\]/g)) {
        for (const w of m[1].matchAll(/'([a-z_]+)'/g)) found.add(w[1]);
      }
    }
    /* `character` ist im Journal der OBJEKTTYP einer Familie, kein Feld. */
    found.delete("character");
    return [...found].sort();
  };

  it("jedes Feld, das das Journal kennt, hat eine Bezeichnung", () => {
    const fields = journalFields();
    expect(fields.length).toBeGreaterThanOrEqual(17);
    for (const field of fields) {
      expect(CHANGE_FIELD_LABELS[field], field).toBeDefined();
      expect(changeFieldLabel(field), field).not.toContain("_");
    }
  });

  it("dieselben Wörter wie im Editor", () => {
    expect(changeFieldLabel("display_name_override")).toBe("Anzeigename");
    expect(changeFieldLabel("catalog_visible")).toBe(de.admin.visible);
    expect(changeFieldLabel("admin_note")).toBe(de.admin.note);
    expect(changeFieldLabel("base_sky_id")).toBe(de.admin.baseAssign);
    expect(changeFieldLabel("character_id")).toBe(de.admin.familyAssign);
    expect(changeFieldLabel("card_type")).toBe(de.admin.cardType);
  });

  it("ein unbekanntes Feld erscheint, statt zu verschwinden", () => {
    expect(changeFieldLabel("some_future_column")).toBe("some_future_column");
  });

  it("beide Historien übersetzen nur den Namen — die Werte bleiben roh", () => {
    for (const path of ["src/app/(admin)/admin/catalog/[skyId]/page.tsx",
      "src/components/admin/figure-modal.tsx"]) {
      const code = read(path);
      expect(code, path).toContain("{changeFieldLabel(change.field)}");
      expect(code, path).not.toContain('<span className="text-foreground">{change.field}</span>');
      expect(code, path).toContain('{change.oldValue ?? "—"} → {change.newValue ?? "—"}');
      /* Der Schlüssel der Zeile bleibt der echte Spaltenname. */
      expect(code, path).toContain("key={`${change.field}-${change.changedAt}`}");
    }
  });
});

/* ===================================================================== */
describe("UX-A6 — Autofill im Kontaktformular", () => {
  const autoOf = (key: string) =>
    container.querySelector<HTMLInputElement>(`#contact-${key}`)!.getAttribute("autocomplete");

  it("die Hausnummer leiht sich kein Token mehr, der Adresszusatz ist address-line2", () => {
    act(() => { root.render(createElement(ContactForm, { contact: null })); });
    expect(autoOf("street")).toBe("address-line1");
    expect(autoOf("houseNumber")).toBeNull();
    expect(autoOf("addressLine2")).toBe("address-line2");
    expect(autoOf("postalCode")).toBe("postal-code");
    expect(autoOf("city")).toBe("address-level2");
  });

  it("und damit genau wie im Checkout", () => {
    const checkout = read("src/components/checkout/checkout-view.tsx");
    expect(checkout).toMatch(/id="houseNumber"(?:(?!autoComplete)[^\n])*\/>/);
    expect(checkout).toMatch(/id="addressLine2"[^\n]*autoComplete="address-line2"/);
    expect(read("src/components/account/contact-form.tsx")).not.toContain("address-line3");
  });

  it("gespeichert wird unverändert unter denselben Schlüsseln", () => {
    act(() => {
      root.render(createElement(ContactForm, { contact: {
        email: "a@b.de", firstName: "A", lastName: "B", company: null, street: "Weg",
        houseNumber: "7a", addressLine2: "Hinterhaus", postalCode: "10115", city: "Berlin",
      } as never }));
    });
    expect(container.querySelector<HTMLInputElement>("#contact-houseNumber")!.value).toBe("7a");
    expect(container.querySelector<HTMLInputElement>("#contact-addressLine2")!.value).toBe("Hinterhaus");
  });
});
