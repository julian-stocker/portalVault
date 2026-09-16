import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

import {
  DRAFT_FIELDS,
  baselineAfter,
  changedFields,
  draftFrom,
  isComplete,
  isDirty,
  summarise,
  visibilityIsIndependent,
  type AdminFigureDraft,
  type DraftField,
} from "./figure-draft.ts";

/** A figure as the catalogue hands it over, plus its note. */
const FIGURE = {
  displayNameOverride: null as string | null,
  cardType: "standard",
  imageOverridePath: null as string | null,
  catalogVisible: true,
};

const base = (): AdminFigureDraft => draftFrom(FIGURE, null);

const source = (path: string) => readFileSync(path, "utf8");
const code = (path: string) =>
  source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const MODAL = "src/components/admin/figure-modal.tsx";
const ACTIONS = "src/components/admin/card-actions.tsx";
const CARD = "src/components/catalog/catalog-card.tsx";
const VIEW = "src/components/catalog/catalog-view.tsx";

describe("the five fields an administrator owns", () => {
  it("are exactly five, and exactly these", () => {
    /*
     * Everything else a figure has belongs to the catalogue import, which
     * rewrites it on every run — the name, the slug, the series, the
     * category, the market price. Offering one of those here would be
     * offering an edit that silently disappears.
     */
    expect([...DRAFT_FIELDS]).toEqual([
      "displayNameOverride",
      "cardType",
      "imageOverridePath",
      "catalogVisible",
      "adminNote",
    ]);
  });

  it("are initialised from the server's answer, not from defaults", () => {
    const draft = draftFrom(
      {
        displayNameOverride: "Blue Bash",
        cardType: "legendary",
        imageOverridePath: "SKY-0009/abc.jpg",
        catalogVisible: false,
      },
      "geprüft",
    );
    expect(draft).toEqual({
      displayNameOverride: "Blue Bash",
      cardType: "legendary",
      imageOverridePath: "SKY-0009/abc.jpg",
      catalogVisible: false,
      adminNote: "geprüft",
    });
  });

  it("turns a missing note into an empty string, not into undefined", () => {
    // The dialog edits a string. A maybe would make "cleared" and "never had
    // one" the same value, and the write would not know which it was told.
    expect(draftFrom(FIGURE, null).adminNote).toBe("");
  });

  it("guards a card type it does not know", () => {
    // A value a later migration adds, read by an older build, becomes the
    // default instead of an undefined artwork lookup.
    expect(draftFrom({ ...FIGURE, cardType: "holographic" }, null).cardType).toBe("standard");
  });
});

describe("nothing is written until it is saved", () => {
  it("reports no change for an untouched draft", () => {
    const initial = base();
    expect(changedFields(initial, { ...initial })).toEqual([]);
    expect(isDirty(initial, { ...initial })).toBe(false);
  });

  it("reports exactly what was touched, in save order", () => {
    const initial = base();
    const draft = { ...initial, adminNote: "x", cardType: "elite" as const };
    // Declaration order, not the order the operator typed in.
    expect(changedFields(initial, draft)).toEqual(["cardType", "adminNote"]);
    expect(isDirty(initial, draft)).toBe(true);
  });

  it("plans a write for every field, one at a time", () => {
    const initial = base();
    for (const field of DRAFT_FIELDS) {
      const draft: AdminFigureDraft = { ...initial };
      // One deliberate change per field, of the right type.
      if (field === "catalogVisible") draft.catalogVisible = !initial.catalogVisible;
      else if (field === "cardType") draft.cardType = "dark";
      else if (field === "adminNote") draft.adminNote = "note";
      else (draft as Record<string, unknown>)[field] = "value";
      expect(changedFields(initial, draft), field).toEqual([field]);
    }
  });

  it("treats clearing a field as a change", () => {
    const initial = draftFrom({ ...FIGURE, displayNameOverride: "Blue Bash" }, "note");
    expect(changedFields(initial, { ...initial, displayNameOverride: null })).toEqual([
      "displayNameOverride",
    ]);
    expect(changedFields(initial, { ...initial, adminNote: "" })).toEqual(["adminNote"]);
  });
});

describe("five writes are not one transaction", () => {
  const plan: DraftField[] = ["cardType", "catalogVisible", "adminNote"];

  it("calls a complete save complete", () => {
    const report = summarise(plan, plan.map((field) => ({ field, ok: true })));
    expect(report.saved).toEqual(plan);
    expect(report.failed).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(isComplete(plan, report)).toBe(true);
  });

  it("never calls a partial save complete", () => {
    /*
     * THE CLAIM THIS EXISTS TO PREVENT. Each field is its own `security
     * definer` function with its own check; there is no RPC that takes all
     * five. So a save can end up half done, and the dialog has to say which
     * half rather than showing "Gespeichert".
     */
    const report = summarise(plan, [
      { field: "cardType", ok: true },
      { field: "catalogVisible", ok: false, message: "nope" },
    ]);
    expect(report.saved).toEqual(["cardType"]);
    expect(report.failed).toHaveLength(1);
    expect(report.skipped).toEqual(["adminNote"]);
    expect(isComplete(plan, report)).toBe(false);
  });

  it("calls a save with nothing saved incomplete, not empty", () => {
    const report = summarise(plan, [{ field: "cardType", ok: false, message: "nope" }]);
    expect(isComplete(plan, report)).toBe(false);
    expect(report.saved).toEqual([]);
  });

  it("moves only the fields that landed into the new baseline", () => {
    const initial = base();
    const draft = { ...initial, cardType: "elite" as const, adminNote: "x" };
    const next = baselineAfter(initial, draft, ["cardType"]);
    expect(next.cardType).toBe("elite");
    // The note did not land, so it is still what the server holds — and
    // therefore still dirty, with what was typed still on screen.
    expect(next.adminNote).toBe(initial.adminNote);
    expect(changedFields(next, draft)).toEqual(["adminNote"]);
  });

  it("leaves nothing dirty after a complete save", () => {
    const initial = base();
    const draft = { ...initial, cardType: "chase" as const, catalogVisible: false };
    const next = baselineAfter(initial, draft, ["cardType", "catalogVisible"]);
    expect(isDirty(next, draft)).toBe(false);
  });
});

describe("visibility is not a consequence of the card type", () => {
  it("does not move when the card type does", () => {
    /*
     * Eon's Elite is the case that makes this concrete: all 42 rows are
     * `elite` and 28 of them are deliberately not public (ADR-0069). A dialog
     * that coupled the two would make them public the moment somebody
     * reclassified them.
     */
    const initial = draftFrom({ ...FIGURE, catalogVisible: false }, null);
    const draft = { ...initial, cardType: "elite" as const };
    expect(changedFields(initial, draft)).toEqual(["cardType"]);
    expect(draft.catalogVisible).toBe(false);
    expect(visibilityIsIndependent(initial, draft)).toBe(true);
  });

  it("moves only when it is changed itself", () => {
    const initial = base();
    const draft = { ...initial, catalogVisible: false };
    expect(changedFields(initial, draft)).toEqual(["catalogVisible"]);
    expect(visibilityIsIndependent(initial, draft)).toBe(true);
  });

  it("is a field of its own, never derived", () => {
    const logic = code("src/lib/admin/figure-draft.ts");
    expect(logic).not.toMatch(/catalogVisible\s*=\s*[^;]*cardType/);
    /*
     * In the dialog the only thing that sets it is its own checkbox. A
     * broader scan would trip over the writer table, where the two fields are
     * simply neighbours — being near each other is not being derived from
     * each other.
     */
    const modal = code(MODAL);
    const setters = [...modal.matchAll(/set\("catalogVisible",\s*([^)]*)\)/g)].map((m) => m[1].trim());
    expect(setters).toEqual(["event.target.checked"]);
    expect(modal).not.toMatch(/set\("catalogVisible"[^)]*cardType/);
    // And nothing else in the dialog writes that field at all.
    expect(modal.match(/catalogVisible:/g) ?? []).toHaveLength(1); // the writer table
  });
});

describe("the dialog", () => {
  const modal = code(MODAL);

  it("is built on the one modal primitive, not a second one", () => {
    expect(modal).toContain('from "@/components/ui/modal"');
    expect(modal).toContain("<Modal");
    expect(existsSync("src/components/ui/modal.tsx")).toBe(true);
    // It names itself for a screen reader and closes through the primitive.
    expect(modal).toContain("labelledBy={headingId}");
    expect(modal).toContain("onClose={requestClose}");
  });

  it("sells nothing", () => {
    /*
     * The operator manages the catalogue, they do not shop in it (ADR-0042).
     * No cart, no offer line, no seller, no price.
     */
    for (const forbidden of ["Cart", "cart", "addToCart", "OfferLink", "seller", "Kaufen", "checkout"]) {
      expect(modal, forbidden).not.toContain(forbidden);
    }
  });

  it("offers no edit for anything the import owns", () => {
    /*
     * The identity block is read: SKY-ID, raw name, series, category, group,
     * element. An input on any of them would be an edit the next import
     * silently undoes.
     */
    const inputs = [...modal.matchAll(/<(input|select|textarea)\b[\s\S]*?\/?>/g)].map((m) => m[0]);
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      for (const owned of ["canonicalName", "slug", "seriesLabel", "categoryName", "marketPrice", "element"]) {
        expect(input, owned).not.toContain(owned);
      }
    }
    // And those values are rendered through the read-only fact list.
    expect(modal).toContain("<Fact label={de.admin.canonicalName}");
    expect(modal).toContain("<Fact label={de.admin.series}");
  });

  it("writes only what changed, through the existing actions", () => {
    expect(modal).toContain("for (const field of plan)");
    expect(modal).toContain("WRITERS[field](skyId, draft)");
    expect(modal).toContain("changedFields(initial, draft)");
    // Every field has exactly one writer, and there are five.
    const writers = [...modal.matchAll(/^\s{2}(\w+): \(skyId, draft\)/gm)].map((m) => m[1]);
    expect(writers.sort()).toEqual([...DRAFT_FIELDS].sort());
  });

  it("stops at the first refusal rather than writing on past it", () => {
    expect(modal).toContain("if (!result.ok) break;");
  });

  it("cannot submit twice", () => {
    expect(modal).toContain("inFlight");
    expect(modal).toContain("if (!skyId || !initial || !draft || inFlight.current || plan.length === 0) return;");
    expect(modal).toContain("disabled={!dirty || saving}");
    expect(modal).toContain('aria-busy={saving || undefined}');
  });

  it("asks before discarding unsaved changes, and only then", () => {
    expect(modal).toContain("if (dirty) {");
    expect(modal).toContain("setConfirming(true)");
    expect(modal).toContain("de.admin.discardTitle");
    expect(modal).toContain("de.admin.keepEditing");
    // A clean dialog closes straight away.
    expect(modal).toContain("onClose();");
    // And a save in flight is not interrupted by Escape.
    expect(modal).toContain("if (saving) return;");
  });

  it("tells the catalogue only what actually landed", () => {
    expect(modal).toContain("if (summary.saved.length > 0) onSaved(skyId, next);");
    expect(modal).toContain("baselineAfter(initial, draft, summary.saved)");
  });

  it("does not announce success when part of it failed", () => {
    expect(modal).toContain("report.failed.length > 0");
    expect(modal).toContain("de.admin.savedPartly");
    expect(modal).toContain('const complete = report !== null && report.failed.length === 0 && report.saved.length > 0;');
  });

  it("loads the note and the journal once, when it opens", () => {
    // Not per card: a catalogue screen is up to 561 of them.
    expect(modal).toContain("loadFigureEditor(figure.skyId)");
    expect(code(VIEW)).not.toContain("loadFigureEditor");
    expect(code(CARD)).not.toContain("loadFigureEditor");
  });
});

describe("the card in admin mode", () => {
  const card = code(CARD);
  const view = code(VIEW);

  it("is the same FigureCard, with a different action", () => {
    expect(card).toContain("<FigureCard");
    expect((card.match(/<FigureCard/g) ?? []).length).toBeGreaterThan(1);
    expect(existsSync("src/components/admin/admin-figure-card.tsx")).toBe(false);
    expect(existsSync("src/components/catalog/admin-figure-card.tsx")).toBe(false);
  });

  it("offers no purchase", () => {
    const branch = card.slice(card.indexOf("if (admin) {"), card.indexOf("const quickBuy"));
    for (const forbidden of ["OfferLink", "onOpenOffers", "quickBuy", "cart"]) {
      expect(branch, forbidden).not.toContain(forbidden);
    }
  });

  it("opens the dialog, and the public card opens the quick view", () => {
    expect(card).toContain("onEdit={() => onEdit?.(figure)}");
    expect(view).toContain("onEdit={() => setEditSkyId(figure.skyId)}");
    // Unchanged for a collector.
    expect(view).toContain("onOpenOffers={() => setQuickViewSkyId(figure.skyId)}");
    expect(view).toContain("<QuickView");
  });

  it("keeps the editor behind the admin guard", () => {
    expect(view).toContain("{admin ? (");
    const at = view.indexOf("<AdminFigureModal");
    expect(view.lastIndexOf("{admin ? (", at)).toBeGreaterThan(-1);
  });

  it("still marks a hidden figure without giving it a second action", () => {
    expect(card).toContain("muted={!visible}");
    expect(card).toContain("<HiddenBadge />");
    // The badge is a badge: it sits over the window, not in the action row.
    expect(code(ACTIONS)).toContain("absolute top-2 left-2");
  });

  it("redraws the card from what was saved", () => {
    // The artwork follows the card type and the name follows the override,
    // in the same frame — `revalidatePath` arrives a render later.
    expect(view).toContain("cardType: saved.cardType");
    expect(view).toContain("displayName: saved.displayNameOverride ?? figure.displayName");
    expect(view).toContain("const figure = withEdits(original);");
  });
});

/**
 * The card shows; the dialog edits (V3.8, clarified).
 *
 * The admin card had collected editing affordances one at a time — an inline
 * name with a pencil, a visibility toggle, a link to a detail page — until it
 * was a small control panel that happened to have a picture on it. It is a
 * card again: the same one a collector sees, with one action underneath.
 */
describe("the admin card edits nothing itself", () => {
  const card = code(CARD);
  const actions = code(ACTIONS);
  const adminBranch = card.slice(card.indexOf("if (admin) {"), card.indexOf("const quickBuy"));

  it("carries no editor, toggle or second destination", () => {
    for (const forbidden of [
      "InlineName", "VisibilityToggle", "CardTypeSelect", "ImageEditor", "FigureEditor",
      "setCatalogVisible", "setDisplayNameOverride", "setCardType", "setImageOverride",
      "setAdminNote", "nameSlot", "aria-pressed", "/admin/catalog/",
    ]) {
      expect(adminBranch, forbidden).not.toContain(forbidden);
      expect(actions, forbidden).not.toContain(forbidden);
    }
  });

  it("sells nothing and collects nothing", () => {
    for (const forbidden of [
      "OfferLink", "onOpenOffers", "quickBuy", "cart", "Cart",
      "onToggle", "setCollected", "initialCollected",
    ]) {
      expect(adminBranch, forbidden).not.toContain(forbidden);
    }
    // And the body is not a target at all.
    expect(adminBranch).toContain("interactive={false}");
  });

  it("has exactly one action, and it opens the dialog", () => {
    expect(actions.match(/<button/g) ?? []).toHaveLength(1);
    expect(actions).not.toContain("<Link");
    expect(actions).not.toContain("<a ");
    expect(adminBranch).toContain("<AdminEditAction");
    expect(adminBranch.match(/<AdminEditAction/g) ?? []).toHaveLength(1);
    expect(actions).toContain("onClick={onEdit}");
  });

  it("writes nothing from the card, at all", () => {
    // `card-actions.tsx` used to import a server action. It imports none now:
    // the only thing it does is tell its parent that a button was pressed.
    expect(actions).not.toContain('from "@/lib/admin/actions"');
    expect(actions).not.toContain("useTransition");
    expect(actions).not.toContain("useRouter");
    expect(actions).not.toContain("router.refresh");
  });

  it("still shows the figure's state, which is not an interaction", () => {
    expect(card).toContain("muted={!visible}");
    expect(card).toContain("<HiddenBadge />");
    expect(actions).toContain("HiddenBadge");
  });
});

describe("a hidden figure stays in the operator's catalogue", () => {
  it("is loaded for an administrator and filtered out for everyone else", () => {
    /*
     * Not a matter of local state: the page asks the database for hidden rows
     * when — and only when — the viewer is an administrator, so the figure is
     * still there after a reload.
     */
    const page = readFileSync("src/app/(public)/(catalog)/page.tsx", "utf8");
    expect(page).toContain("fetchCatalog({ includeHidden: admin })");
    const queries = readFileSync("src/lib/catalog/queries.ts", "utf8");
    expect(queries).toContain('if (!options.includeHidden) query = query.eq("catalog_visible", true);');
  });

  it("is dimmed and badged rather than removed from the grid", () => {
    const view = code(VIEW);
    /*
     * `visibility` feeds `muted` and the badge, and nothing else. Rather than
     * guessing at the shapes a filter could take, every use of the two names
     * is enumerated: if a new one appears, this fails and somebody has to say
     * what it is for.
     */
    expect(view).toContain("const isVisible = (figure: CatalogFigure) =>");
    expect(view.match(/isVisible\(/g) ?? []).toHaveLength(1); // visible={isVisible(figure)}
    expect(view).toContain("visible={isVisible(figure)}");
    /* `catalogVisible` appears where the fallback is read and where the
       dialog reports a change — never in a predicate that narrows the grid. */
    const uses = [...view.matchAll(/^.*catalogVisible.*$/gm)].map((m) => m[0].trim());
    expect(uses).toEqual([
      "visibility.get(figure.skyId) ?? figure.catalogVisible;",
      "onVisibilityChange(skyId, draft.catalogVisible);",
    ]);
  });
});

describe("saving, and getting back to where you were", () => {
  const modal = code(MODAL);
  const view = code(VIEW);

  it("closes itself when everything was written", () => {
    expect(modal).toContain("if (isComplete(plan, summary)) onClose();");
  });

  it("stays open when part of it was not", () => {
    /* Closing on a half-written figure would hide the one thing the operator
       needs to see. The only close in the save path is the complete one. */
    const save = modal.slice(modal.indexOf("async function save()"), modal.indexOf("if (!figure) return null;"));
    expect(save.match(/onClose\(\)/g) ?? []).toHaveLength(1);
    expect(save).toContain("isComplete(plan, summary)");
  });

  it("navigates nowhere, so the scroll position is never lost", () => {
    /*
     * The grid is not re-rendered from the top, the page is not reloaded and
     * nothing is pushed onto the history stack. The card updates in place
     * from what the save returned.
     */
    for (const forbidden of ["useRouter", "router.push", "router.replace", "router.refresh", "window.location", "<Link"]) {
      expect(modal, forbidden).not.toContain(forbidden);
    }
    expect(view).toContain("setEdited((current) => ({ ...current, [skyId]: draft }));");
  });

  it("gives focus back to the button that opened it", () => {
    // The primitive does it, and it is checked because losing focus to
    // <body> after every edit is what makes keyboard work unbearable.
    const primitive = readFileSync("src/components/ui/modal.tsx", "utf8");
    expect(primitive).toContain("const opener = document.activeElement;");
    expect(primitive).toContain("opener.focus()");
  });
});

describe("the picture is staged, not saved", () => {
  const modal = code(MODAL);
  const imageActions = code("src/lib/admin/image-actions.ts");

  it("uploads through an action that does not point the figure at it", () => {
    /*
     * TWO STEPS THAT ARE NOT ONE. `stageFigureImage` writes bytes into the
     * bucket and returns their path; `setImageOverride` — which the dialog
     * calls when the operator saves — is what makes the figure show them.
     *
     * The cost is an orphan when an upload is discarded. The object is
     * content-addressed, so the same picture is the same object however often
     * it is chosen, and this file already decided that an orphan is the
     * cheaper of the two mistakes.
     */
    expect(modal).toContain("stageFigureImage(form)");
    expect(modal).not.toContain("uploadFigureImage");
    const staged = imageActions.slice(
      imageActions.indexOf("export async function stageFigureImage"),
      imageActions.indexOf("export async function uploadFigureImage"),
    );
    expect(staged).toContain(".upload(path, bytes");
    expect(staged).not.toContain("setImageOverride");
    /* And the one that does both is still there, for the detail page. */
    expect(imageActions).toContain("export async function uploadFigureImage");
    expect(readFileSync("src/components/admin/image-editor.tsx", "utf8")).toContain("uploadFigureImage");
  });

  it("puts the path in the draft, where save picks it up", () => {
    expect(modal).toContain('set("imageOverridePath", result.path)');
    expect(modal).toContain("imageOverridePath: (skyId, draft) => setImageOverride(skyId, draft.imageOverridePath)");
  });

  it("previews the draft through the resolver every other surface uses", () => {
    expect(modal).toContain("imageSrc({ imageOverridePath: draft.imageOverridePath, imageFile: figure.imageFile })");
    expect(modal).toContain("<FigureImage src={previewSrc}");
  });

  it("checks the size before the file leaves the machine", () => {
    expect(modal).toContain("file.size > MAX_IMAGE_BYTES");
    // And the server checks again — this is convenience, not the boundary.
    expect(imageActions).toContain("if (file.size > MAX_IMAGE_BYTES)");
  });
});
