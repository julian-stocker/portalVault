import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The create dialog as a piece of the catalogue (V3.9, ADR-0070).
 *
 * Who can see the button, what the fields are allowed to be, that the picture
 * cannot produce a second identity, and that the panel scrolls the way V3.8a
 * settled. No DOM here — `vitest.config.mts` collects `*.test.ts` and nothing
 * renders — so these hold the source, exactly as `figure-modal-scroll.test.ts`
 * and `quick-view-ux.test.ts` do.
 */
const MODAL = "src/components/admin/add-figure-modal.tsx";
const VIEW = "src/components/catalog/catalog-view.tsx";
const PAGE = "src/app/(public)/(catalog)/page.tsx";
const DRAFT = "src/lib/admin/new-figure-draft.ts";

const source = (path: string) => readFileSync(path, "utf8");

const code = (path: string) =>
  source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const BODY_ANCHOR = "min-h-0 overflow-y-auto overscroll-contain";

function zones(modal: string) {
  const headStart = modal.indexOf("<header");
  const bodyStart = modal.lastIndexOf("<div", modal.indexOf(BODY_ANCHOR));
  const footStart = modal.indexOf("<footer");
  expect(headStart).toBeGreaterThan(-1);
  expect(bodyStart).toBeGreaterThan(headStart);
  expect(footStart).toBeGreaterThan(bodyStart);
  return {
    head: modal.slice(headStart, bodyStart),
    scrolling: modal.slice(bodyStart, footStart),
    foot: modal.slice(footStart),
  };
}

describe("only an administrator can reach it", () => {
  const view = code(VIEW);
  const page = code(PAGE);

  it("gates the button on the role, not on a class name", () => {
    expect(view).toContain("de.admin.addFigure");
    // The button and the dialog are both inside `admin ? ... : null`, so a
    // collector's render carries neither.
    const button = view.slice(view.indexOf("de.admin.addFigure") - 900, view.indexOf("de.admin.addFigure"));
    expect(button).toContain("{admin ? (");
  });

  it("renders no create dialog for a collector", () => {
    const dialog = view.slice(view.indexOf("<AddFigureModal") - 300, view.indexOf("<AddFigureModal"));
    expect(dialog).toContain("{admin ? (");
  });

  it("asks the server for the role, never the browser", () => {
    // `isAdmin()` reads `is_shop_admin()` in the database inside the request.
    expect(page).toContain("const admin = await isAdmin();");
  });

  it("does not load the dropdown data for a collector", () => {
    expect(page).toContain("admin ? fetchFigureFormOptions() : Promise.resolve(null)");
  });

  it("sits beside the filter rather than on a page of its own", () => {
    // The administrator works in the catalogue, not next to it (ADR-0042).
    expect(view.indexOf("</FilterSheet>")).toBeLessThan(view.indexOf("de.admin.addFigure"));
    expect(view.indexOf("de.admin.addFigure")).toBeLessThan(view.indexOf("</BrowseToolbar>"));
  });

  it("navigates nowhere", () => {
    const modal = code(MODAL);
    expect(modal).not.toContain("router.push");
    expect(modal).not.toContain("<Link");
    expect(modal).not.toContain("href=");
  });
});

describe("every domain value comes from a controlled list", () => {
  const modal = code(MODAL);

  it("offers series and categories as selects, never as text", () => {
    expect(modal).toContain("{series.map((option) => (");
    expect(modal).toContain("{available.map((option) => (");
    // A free-text series is how a second spelling of "Spyro's Adventure"
    // gets into the data.
    expect(modal).not.toMatch(/type="text"[\s\S]{0,200}seriesCode/);
  });

  it("filters the categories by the chosen series", () => {
    expect(modal).toContain("categoriesFor(categories, draft.seriesCode)");
    expect(modal).toContain('disabled={draft.seriesCode === ""}');
  });

  it("offers the card type from the one vocabulary", () => {
    expect(modal).toContain("{CARD_TYPES.map((type) => (");
  });

  it("has exactly one free-text field for a name, plus the override and the note", () => {
    const inputs = [...modal.matchAll(/<input\b[\s\S]*?\/>/g)].map((m) => m[0]);
    const texts = inputs.filter((input) => input.includes('type="text"'));
    expect(texts).toHaveLength(2); // name and display-name override
    expect((modal.match(/<textarea/g) ?? []).length).toBe(1);
  });
});

describe("the fields that are read, not typed", () => {
  const modal = code(MODAL);

  it("shows the SKY-ID as automatic", () => {
    expect(modal).toContain("de.admin.skyIdAuto");
    // No input for it anywhere — an identity is not a form field.
    expect(modal).not.toMatch(/value=\{[^}]*skyId[^}]*\}[\s\S]{0,80}onChange/);
  });

  it("shows the group as derived from the category", () => {
    expect(modal).toContain("de.admin.groupDerived");
    expect(modal).toContain("groupOf(categories, draft.categoryId)");
  });

  it("shows the element as something the character decides", () => {
    // `element` is not a column on skylanders at all: it comes from
    // characters.element through character_id (ADR-0034).
    expect(modal).toContain("de.admin.elementDerived");
    expect(modal).not.toContain("element:");
  });

  it("shows the slug as a preview and says it is one", () => {
    expect(modal).toContain("slugPreview(draft)");
    expect(modal).toContain("de.admin.slugPreviewHint");
  });

  it("offers no character field at all", () => {
    /*
     * V3.9 does not touch ADR-0034. The create writes NULL and the curated
     * file stays the complete record; a picker here would produce links that
     * exist only in the database.
     */
    for (const forbidden of ["characterId", "character_id", "characters"]) {
      expect(modal, forbidden).not.toContain(forbidden);
    }
  });

  it("offers no price field", () => {
    expect(modal).not.toContain("marketPrice");
    expect(modal).not.toContain("market_price");
  });
});

describe("a new figure is hidden until somebody publishes it", () => {
  const modal = code(MODAL);
  const draft = code(DRAFT);

  it("starts with the box unticked", () => {
    expect(draft).toContain("catalogVisible: false");
  });

  it("says why, rather than leaving an unexplained default", () => {
    expect(modal).toContain("de.admin.createVisibleHint");
  });
});

describe("the template carries what it is allowed to carry", () => {
  const modal = code(MODAL);
  const draft = code(DRAFT);

  it("offers both starting points", () => {
    expect(modal).toContain("de.admin.startEmpty");
    expect(modal).toContain("de.admin.startTemplate");
  });

  it("derives the draft in one place, not in the dialog", () => {
    expect(modal).toContain("fromTemplate(figure)");
    expect(draft).toContain("export function fromTemplate");
  });

  it("copies two foreign keys and the name, and nothing else", () => {
    const body = draft.slice(draft.indexOf("export function fromTemplate"));
    const assigned = body.slice(0, body.indexOf("}"));
    expect(assigned).toContain("seriesCode: figure.seriesCode");
    expect(assigned).toContain("categoryId: figure.categoryId");
    expect(assigned).toContain("name: figure.name");
    for (const forbidden of ["cardType", "catalogVisible", "characterId", "imageOverridePath", "displayNameOverride"]) {
      expect(assigned, forbidden).not.toContain(forbidden);
    }
  });

  it("will not create while the name is still the template's", () => {
    expect(modal).toContain("nameConfirmed(draft, template?.name ?? null)");
    expect(modal).toContain("const ready = isCreatable(draft, categories) && confirmed;");
  });

  it("costs no request — the catalogue is already on screen", () => {
    expect(modal).toContain("figures: readonly CatalogFigure[]");
    expect(modal).not.toContain("await fetch");
  });
});

describe("the picture is a second phase and can never make a second figure", () => {
  const modal = code(MODAL);

  it("creates first, then uploads under the identity it got back", () => {
    const submit = modal.slice(modal.indexOf("async function submit()"), modal.indexOf("if (!open) return null;"));
    expect(submit.indexOf("await createFigure(")).toBeLessThan(submit.indexOf("stageFigureImage(form)"));
    expect(submit).toContain('form.set("skyId", created.skyId)');
  });

  it("reuses the V3.8 upload path rather than growing a second one", () => {
    expect(modal).toContain('from "@/lib/admin/image-actions"');
    expect(modal).toContain("stageFigureImage");
    expect(modal).toContain("setImageOverride");
    expect(modal).not.toContain("supabase.storage");
  });

  it("calls the create exactly once per dialog", () => {
    expect((modal.match(/createFigure\(/g) ?? []).length).toBe(1);
    expect(modal).toContain("inFlight.current");
  });

  it("says the figure exists when only the picture failed", () => {
    /*
     * The one message that matters here. "Create failed" would be a lie and
     * would invite a second attempt — and a second attempt would draw a
     * second SKY-ID for one figure.
     */
    expect(modal).toContain("de.admin.createdWithoutImage");
    expect(modal).toContain('setPhase({ kind: "partial", skyId: created.skyId })');
    expect(modal).toContain("onCreated(created.skyId)");
  });

  it("offers no create button once a figure exists", () => {
    /*
     * The foot has two branches and the order proves which is which: the
     * partial branch closes, the else branch creates. `de.admin.create}` with
     * its closing brace, because `de.admin.create` is also the start of
     * `createVisibleHint` and four of its siblings.
     */
    const foot = modal.slice(modal.indexOf("<footer"), modal.indexOf("</footer>"));
    const partialAt = foot.indexOf('phase.kind === "partial" ? (');
    const elseAt = foot.indexOf(") : (", partialAt);
    expect(partialAt).toBeGreaterThan(-1);
    expect(foot.indexOf("de.admin.closeWithoutImage")).toBeGreaterThan(partialAt);
    expect(foot.indexOf("de.admin.closeWithoutImage")).toBeLessThan(elseAt);
    expect(foot.indexOf("de.admin.create}")).toBeGreaterThan(elseAt);
  });

  it("keeps the failed upload out of the figure's own error line", () => {
    expect(modal).toContain("setImageError(staged.message)");
    expect(modal).toContain("setError(created.message)");
  });
});

describe("similar entries warn and step aside", () => {
  const modal = code(MODAL);

  it("shows what somebody needs to tell them apart", () => {
    expect(modal).toContain("de.admin.similarTitle");
    for (const field of ["match.skyId", "match.displayName", "match.seriesLabel", "match.cardType"]) {
      expect(modal, field).toContain(field);
    }
  });

  it("does not gate the create on it", () => {
    // `ready` is the three required fields plus the confirmed name. The
    // warning is not part of it.
    expect(modal).toContain("const ready = isCreatable(draft, categories) && confirmed;");
    expect(modal).not.toMatch(/disabled=\{[^}]*similar/);
  });
});

describe("the panel scrolls the way V3.8a settled", () => {
  const modal = code(MODAL);

  it("puts head, body and foot straight into the primitive", () => {
    expect(modal).toContain('from "@/components/ui/modal"');
    const panel = modal.slice(modal.indexOf("<Modal"), modal.indexOf("</Modal>"));
    expect(panel).not.toMatch(/<Modal[^>]*>\s*<div className="flex[^"]*flex-col/);
  });

  it("states no height of its own", () => {
    expect(modal).not.toMatch(/max-h-\[/);
    expect(modal).not.toMatch(/\d+vh/);
    for (const stretcher of ["h-screen", "h-dvh", "h-full", "min-h-screen"]) {
      expect(modal, stretcher).not.toContain(stretcher);
    }
  });

  it("has one scrolling region, spelled so it can shrink", () => {
    expect(modal).toContain(BODY_ANCHOR);
    expect((modal.match(/overflow-y-auto/g) ?? []).length).toBe(1);
    expect((modal.match(/overscroll-contain/g) ?? []).length).toBe(1);
  });

  it("holds the head and the foot at their size", () => {
    const { head, foot } = zones(modal);
    expect(head).toContain("shrink-0");
    expect(foot).toContain("shrink-0");
  });

  it("leaves room below the last field", () => {
    expect(modal).toMatch(/min-h-0 overflow-y-auto overscroll-contain p-4 pb-\d/);
  });

  it("keeps closing and creating out of the scrolling content", () => {
    const { head, scrolling, foot } = zones(modal);
    expect(head).toContain("de.admin.closeAdd");
    expect(scrolling).not.toContain("de.admin.closeAdd");
    expect(foot).toContain("de.admin.create}");
    expect(scrolling).not.toContain("de.admin.create}");
  });

  it("will not close while a create is in flight", () => {
    expect(modal).toContain("if (busy) return;");
  });
});

describe("after the create", () => {
  const view = code(VIEW);

  it("refreshes from the server, and the catalogue stays router-free", () => {
    /*
     * The `edited` overlay can only restate a figure the server already sent,
     * so a figure that did not exist a moment ago has to come from the server.
     * The refresh is therefore `refresh()` from `next/cache`, called inside
     * the action — not `router.refresh()` here. `ui/browse.test.ts` and
     * `ui/quick-view-ux.test.ts` both hold this file to using no router at
     * all, because opening a dialog in the catalogue must never become a
     * navigation (ADR-0027), and that rule had no reason to bend.
     */
    const action = code("src/lib/admin/create-actions.ts");
    expect(action).toContain('from "next/cache"');
    expect(action).toContain("refresh();");
    expect(view).not.toContain("useRouter");
    expect(view).not.toContain("router.refresh");
  });

  it("names the new figure in a live region", () => {
    expect(view).toContain("de.admin.created(created)");
    expect(view).toContain('role="status"');
    expect(view).toContain('aria-live="polite"');
  });

  it("navigates nowhere", () => {
    const after = view.slice(view.indexOf("<AddFigureModal"));
    expect(after).not.toContain("router.push");
  });
});
