import { describe, expect, it } from "vitest";
import { globSync, readFileSync } from "node:fs";

import { de } from "@/lib/i18n/de";

/**
 * Sofortiges Feedback bei langsamen Aktionen (UX-Loading).
 *
 * Dieses Produkt rendert in Tests nichts — `vitest.config.mts` sammelt
 * `*.test.ts`, und es gibt kein DOM. Was ein Klick tut, wird im Browser
 * geprüft; was die Quelle zusichert, hier. Dieselbe Teilung wie in
 * `quick-view-ux.test.ts` und `navigation.test.ts`.
 *
 * Geprüft wird das, was leise kaputtgehen kann: dass es EINE Komponente gibt
 * und nicht zwanzig eigene Räder, dass ein arbeitender Knopf wirklich
 * gesperrt ist, dass der Zustand vorgelesen wird, und dass das Overlay
 * ausschließlich an der einen Stelle steht, an der die Seite tatsächlich
 * verschwindet.
 */
function source(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * Die Quelle ohne Kommentare.
 *
 * Jede dieser Dateien erklärt sich ausführlich, und die Erklärungen nennen
 * genau die Wörter, nach denen hier gesucht wird — „Spinner", „Overlay",
 * „animate-spin". Roher Text ließe einen Kommentar den Test bestehen.
 */
function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const PENDING = "src/components/ui/pending.tsx";
const CART = "src/components/cart/cart-view.tsx";
const CHECKOUT = "src/components/checkout/checkout-view.tsx";
const AUTH_FIELD = "src/components/auth/form-field.tsx";

describe("there is one shared pending component", () => {
  const pending = code(PENDING);

  it("offers the four pieces every surface needs", () => {
    for (const piece of ["export function Spinner", "export function PendingButton",
                         "export function PendingLink", "export function BusyOverlay"]) {
      expect(pending).toContain(piece);
    }
  });

  it("is a client component, because two of the four hold browser state", () => {
    expect(pending).toContain('"use client"');
  });

  it("keeps the only spinner in the product in this one file", () => {
    // Der Punkt der Übung: vorher gab es gar keinen, und der Weg dahin, dass
    // jede Seite ihren eigenen baut, ist genau ein Copy-and-paste weit.
    const others = globSync("src/components/**/*.tsx")
      .filter((file) => file !== PENDING)
      .filter((file) => code(file).includes("animate-spin"));
    expect(others).toEqual([]);
  });
});

describe("the spinner says nothing and takes nothing over", () => {
  const pending = code(PENDING);

  it("is hidden from screen readers — the text next to it carries the meaning", () => {
    expect(pending).toMatch(/aria-hidden="true"[\s\S]{0,200}animate-spin/);
  });

  it("stands still when motion is unwelcome", () => {
    // `motion-safe:` statt `animate-spin` pur: bei `prefers-reduced-motion`
    // bleibt das Rad sichtbar, dreht sich aber nicht. Die Aussage steckt im
    // Text und im gesperrten Knopf.
    expect(pending).toContain("motion-safe:animate-spin");
    expect(pending).not.toMatch(/[^:]\banimate-spin\b/);
  });

  it("inherits its colour instead of choosing one", () => {
    // Derselbe Baustein sitzt in einem Amber-Knopf und in einem neutralen.
    expect(pending).toContain("border-current");
  });
});

describe("a button that is working cannot be pressed again", () => {
  const pending = code(PENDING);

  it("disables itself, rather than trusting each caller to remember", () => {
    expect(pending).toContain("disabled={disabled || pending}");
  });

  it("says why it does not react", () => {
    expect(pending).toContain("aria-busy={pending || undefined}");
  });
});

describe("the state is announced, not only drawn", () => {
  const pending = code(PENDING);

  it("keeps a live region in the document at all times", () => {
    /*
     * Der sichtbare Text eines gesperrten Knopfes wird beim Wechsel nicht
     * vorgelesen, und eine Live-Region, die erst mit ihrem Text entsteht,
     * meldet sich unzuverlässig. Deshalb steht sie immer da und ist im
     * Ruhezustand leer.
     */
    expect(pending).toContain('role="status"');
    expect(pending).toContain('aria-live="polite"');
    expect(pending).toContain("{label ?? \"\"}");
  });

  it("falls back to a sentence when the caller names no vorgang", () => {
    expect(pending).toContain("de.pending.working");
    expect(pending).toContain("de.pending.loading");
    expect(de.pending.working).not.toBe("");
    expect(de.pending.loading).not.toBe("");
  });
});

describe("the overlay is a state of the page, not a dialog", () => {
  const pending = code(PENDING);

  it("claims no dialog role and traps no focus", () => {
    // Es gibt nichts zu bedienen, und die Seite verschwindet gleich. Ein
    // Fokusfang wäre ein Versprechen auf Interaktion, die es nicht gibt.
    expect(pending).not.toContain('role="dialog"');
    expect(pending).not.toContain("aria-modal");
    expect(pending).not.toContain(".focus()");
  });

  it("dims and blurs the page the way the modal does, so it reads as SkyIsles", () => {
    expect(pending).toContain("backdrop-blur-[3px]");
    expect(pending).toContain("fixed inset-0");
  });

  it("renders nothing at all when it is not needed", () => {
    expect(pending).toContain("if (!show) return null;");
  });
});

describe("the cart's step into the checkout waits visibly", () => {
  const cart = code(CART);

  it("uses the shared link, not a bare one", () => {
    expect(cart).toContain("<PendingLink");
    expect(cart).toContain('href="/checkout"');
    expect(cart).not.toMatch(/<Link href="\/checkout"/);
  });

  it("shows nothing when the navigation is instant", () => {
    // `useLinkStatus` ist nur `pending`, solange tatsächlich gewartet wird.
    expect(code(PENDING)).toContain("useLinkStatus()");
  });

  it("names the destination while it loads", () => {
    expect(cart).toContain("de.cart.toCheckoutPending");
    expect(de.cart.toCheckoutPending).toContain("Kasse");
  });
});

describe("the two slow steps of the checkout", () => {
  const checkout = code(CHECKOUT);

  it("gives the order button a spinner, not only another word", () => {
    expect(checkout).toContain("<PendingButton");
    expect(checkout).toContain("pendingLabel={de.checkout.submitting}");
  });

  it("covers the page only for the hand-over to Stripe", () => {
    expect(checkout).toContain("<BusyOverlay");
    expect(checkout).toContain("show={redirecting}");
    // Genau einmal: für den Weg zur Kasse und für das Anlegen der Bestellung
    // genügt der Knopf, und ein Overlay dafür wäre ein Vollbild für 200 ms.
    expect(checkout.match(/<BusyOverlay/g)).toHaveLength(1);
  });

  it("says what is happening and where it leads", () => {
    expect(checkout).toContain("de.checkout.redirectOverlay");
    expect(de.checkout.redirectOverlayHint).toContain("Stripe");
  });

  it("lets go again when the hand-over fails or the page comes back", () => {
    // Beides stand schon da und muss stehen bleiben: ohne das eine bliebe
    // das Overlay nach einem Fehler stehen, ohne das andere nach „Zurück".
    expect(checkout).toContain("setRedirecting(false)");
    expect(checkout).toContain("watchPageShow");
  });
});

describe("signing in no longer answers with three dots", () => {
  const field = code(AUTH_FIELD);

  it("uses the shared button", () => {
    expect(field).toContain("<PendingButton");
    expect(field).toContain("de.pending.submitting");
  });

  it("has dropped the ellipsis that used to be the whole feedback", () => {
    expect(field).not.toContain('{pending ? "…" : label}');
  });
});

describe("the business forms that write to the database", () => {
  /*
   * Jedes dieser Formulare ruft eine Server Action auf und wartet dabei auf
   * Netz und Datenbank. Sie hatten alle `disabled={pending}` — also keinen
   * doppelten Schreibvorgang, aber auch kein sichtbares „läuft".
   */
  const FORMS = [
    "src/components/business/new-purchase.tsx",
    "src/components/business/new-sale.tsx",
    "src/components/admin/ship-order-form.tsx",
    "src/components/admin/tracking-form.tsx",
    "src/components/admin/refund-form.tsx",
    "src/components/messages/conversation-thread.tsx",
  ];

  for (const form of FORMS) {
    it(`gives feedback in ${form.split("/").pop()}`, () => {
      const text = code(form);
      expect(text).toContain("PendingButton");
      expect(text).toContain("pendingLabel=");
    });
  }
});
