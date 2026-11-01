/**
 * The administrator's figure editor, as a dialog (V3.8, compact since CAT-14).
 *
 * WHY A DIALOG AND NOT A PAGE
 *
 * Editing a figure used to mean leaving the catalogue: a link to
 * `/admin/catalog/<skyId>`, a page, and the back button to get to where you
 * were. That is the right shape for a deep edit and the wrong one for the
 * work this actually is — glance at a grid, fix one thing, glance at the next.
 * The page stays; this is the fast path beside it.
 *
 * WHAT IS WHERE (CAT-14)
 *
 * The head carries the figure: picture (with a small edit overlay for the
 * image), the name (a pencil edits the display-name override — the imported
 * name is never touched), SKY-ID, series, element and the status. Below it
 * the two properties that are changed most: "Variante von" and the types.
 * Everything else — card art, internal note, technical identity, history —
 * sits in closed sections under "Weitere Details".
 *
 * FIELDS ARE COLLECTED, THEN SAVED
 *
 * Every editor on the detail page writes the moment you touch it. Here they
 * do not: the dialog takes a copy, the operator changes what they like, and
 * one button sends only what differs (`lib/admin/figure-draft.ts`).
 *
 * THAT SAVE IS NOT A TRANSACTION, AND THIS FILE DOES NOT PRETEND IT IS.
 *
 * Each field is its own `security definer` function with its own admin
 * check. There is no RPC that takes all of them, and inventing one would be a
 * schema change for a dialog — so changed fields are separate writes, in
 * order, and any of them can fail on its own. What that costs is honesty: a
 * partial save says which fields landed, keeps the dialog open, and leaves
 * the rest dirty. It never says "Gespeichert" when only some went through.
 *
 * "VARIANTE VON" IS ONLY OFFERED AS AN EDIT WHERE THE CATALOGUE IS EDITED
 *
 * Staging is the editorial source (ADR-0167). The server tells the dialog
 * whether this deployment is it (`loadFigureEditor` → `editorialSource`);
 * elsewhere the relation is shown and not offered, so this dialog opens no
 * new catalogue write path on Production. That is a UI rule, not the lock —
 * the lock is CAT-13.
 *
 * WHAT IS READ-ONLY, AND WHY IT IS SHOWN ANYWAY
 *
 * The identity block — SKY-ID, raw name, series, category, group, element —
 * belongs to the catalogue import, which rewrites it on every run. It is
 * shown because you cannot decide about a figure you cannot see, and it is
 * not editable because an edit there would silently disappear.
 */
"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";

import { Modal } from "@/components/ui/modal";
import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { BasePicker } from "@/components/admin/base-picker";
import { TypeChips } from "@/components/admin/type-chips";
import { CARD_TYPES, CARD_TYPE_LABELS } from "@/lib/catalog/card-type";
import {
  baselineAfter,
  changedFields,
  draftFrom,
  isComplete,
  summarise,
  type AdminFigureDraft,
  type DraftField,
  type FieldOutcome,
} from "@/lib/admin/figure-draft";
import { loadFigureEditor } from "@/lib/admin/figure-editor-data";
import {
  setAdminNote,
  setCardType,
  setFigureTypes,
  setDisplayNameOverride,
  setImageOverride,
  setVariantBase,
  type AdminResult,
} from "@/lib/admin/actions";
import { stageFigureImage } from "@/lib/admin/image-actions";
import { previewVariantFamily } from "@/lib/admin/base-figure-search";
import type { VariantFamilyOutcome } from "@/lib/admin/variant-family-rule";
import { MAX_IMAGE_BYTES } from "@/lib/admin/image-file";
import type { CatalogChange } from "@/lib/admin/queries";
import type { CatalogFigure } from "@/lib/catalog/types";
import { groupLabel } from "@/lib/catalog/group";
import { imageSrc } from "@/lib/catalog/image";
import { formatDate } from "@/lib/format";
import {
  CATALOG_STATUSES,
  DEFAULT_CATALOG_STATUS,
  isCatalogStatus,
  type CatalogStatus,
} from "@/lib/catalog/catalog-status";
import { de } from "@/lib/i18n/de";
import { setCatalogStatus } from "@/lib/admin/actions";

/** Die drei Beschriftungen, an einer Stelle. */
export const STATUS_LABELS: Readonly<Record<CatalogStatus, string>> = {
  public: de.catalog.statusPublic,
  hidden: de.catalog.statusHidden,
  draft: de.catalog.statusDraft,
};

/** Ein `select` liefert `string`; der Wächter macht daraus einen Status. */
function asStatus(value: string): CatalogStatus {
  return isCatalogStatus(value) ? value : DEFAULT_CATALOG_STATUS;
}

/**
 * One field, one server action.
 *
 * A table rather than a switch, so the save loop is a loop and the order the
 * fields are written in is the order they are declared in `DRAFT_FIELDS`.
 * `imageOverridePath` and `displayNameOverride` both take an empty string as
 * "clear it" — that is the database's contract, not this file's.
 */
const WRITERS: Record<DraftField, (skyId: string, draft: AdminFigureDraft) => Promise<AdminResult>> = {
  displayNameOverride: (skyId, draft) =>
    setDisplayNameOverride(skyId, draft.displayNameOverride ?? ""),
  /*
   * DERSELBE SCHREIBWEG WIE AUF DER DETAILSEITE (`0159`): Serie, keine
   * Kette, keine Figur mit eigenen Varianten, Familienregel — alles in der
   * Datenbank. Der Dialog bietet das Feld nur auf Staging an (ADR-0167);
   * anderswo ändert es sich nie und steht deshalb nie im Speicherplan.
   */
  baseSkyId: (skyId, draft) =>
    setVariantBase(skyId, draft.baseSkyId,
                   draft.adoptBaseFamily ? "adopt-base"
                   : draft.reuseFamilyId !== null ? { reuseFamilyId: draft.reuseFamilyId }
                   : draft.createFamilyWithBase),
  cardType: (skyId, draft) => setCardType(skyId, draft.cardType),
  /*
   * EIN EIGENER SCHREIBWEG, wie jedes andere Feld. `setFigureTypes` ersetzt
   * die Menge und setzt dabei das Banner auf „–", wenn der sichtbare Type
   * herausfällt — die Regel liegt in `0163` und nicht hier.
   */
  types: (skyId, draft) => setFigureTypes(skyId, draft.types),
  imageOverridePath: (skyId, draft) => setImageOverride(skyId, draft.imageOverridePath),
  catalogStatus: (skyId, draft) => setCatalogStatus(skyId, draft.catalogStatus),
  adminNote: (skyId, draft) => setAdminNote(skyId, draft.adminNote),
};

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="truncate text-sm">{value}</dd>
    </div>
  );
}

/** One property row: the label on the left, the value beside it. */
function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1">
      <span className="pt-1.5 text-xs text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * A closed-by-default section. `<details>` and not a state flag: the browser
 * already makes it a keyboard-operable disclosure with the right semantics.
 */
function More({ title, summary, children }: {
  title: string; summary?: string; children: React.ReactNode;
}) {
  return (
    <details className="group rounded-sky-md ring-1 ring-border/60">
      <summary
        className="focus-ring flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sky-md
                   px-3 text-sm [&::-webkit-details-marker]:hidden"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16"
             className="h-3 w-3 shrink-0 text-muted transition-transform group-open:rotate-90"
             fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M6 3l5 5-5 5" />
        </svg>
        <span className="font-medium">{title}</span>
        {summary ? <span className="ml-auto truncate text-xs text-muted">{summary}</span> : null}
      </summary>
      <div className="flex flex-col gap-3 px-3 pt-1 pb-3">{children}</div>
    </details>
  );
}

/**
 * What happens to the family with the new base (CAT-15) — and, where the two
 * disagree, the explicit choice to take the base's. Nothing is decided here;
 * the server reads again and the RPCs check again.
 */
function FamilyPlanLine({ plan, adopt, reuse, disabled, onAdopt, onReuse }: {
  plan: VariantFamilyOutcome;
  adopt: boolean;
  reuse: number | null;
  disabled: boolean;
  onAdopt: (value: boolean) => void;
  onReuse: (id: number | null) => void;
}) {
  const t = de.admin;
  const line =
    plan.kind === "carry" ? t.familyPlanCarry(plan.family.name)
    : plan.kind === "same" ? t.familyPlanSame(plan.family.name)
    : plan.kind === "existing"
      ? t.familyPlanExisting(plan.family.name,
          plan.members.slice(0, 4).map((m) => `${m.skyId} ${m.name}`).join(", ")
          + (plan.members.length > 4 ? " …" : ""))
    : plan.kind === "create" ? t.familyPlanCreate(plan.name)
    : plan.kind === "none" ? t.familyPlanNone
    : plan.kind === "variant-only" ? t.familyPlanVariantOnly(plan.variant.name)
    : t.familyPlanConflict(plan.variant.name, plan.base.name);
  const warn = plan.kind === "conflict";
  return (
    <div className="mt-1 flex flex-col gap-1">
      <p role={warn ? "alert" : undefined}
         className={`text-[11px] ${warn ? "text-danger" : "text-muted"}`}>
        {line}
      </p>
      {plan.kind === "conflict" || plan.kind === "variant-only" ? (
        <label className="flex min-h-8 items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={adopt}
            disabled={disabled}
            onChange={(event) => onAdopt(event.target.checked)}
            className="size-4"
          />
          {plan.kind === "conflict" ? t.familyAdoptBase(plan.base.name) : t.familyAdoptNone}
        </label>
      ) : null}
      {plan.kind === "existing" ? (
        <label className="flex min-h-8 items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={reuse === plan.family.id}
            disabled={disabled}
            onChange={(event) => onReuse(event.target.checked ? plan.family.id : null)}
            className="size-4"
          />
          {t.familyReuseConfirm(plan.family.name)}
        </label>
      ) : null}
    </div>
  );
}

export function AdminFigureModal({
  figure,
  onClose,
  onSaved,
}: {
  /** `null` closes the dialog. */
  figure: CatalogFigure | null;
  onClose: () => void;
  /** Tells the catalogue what landed, so the card redraws without a reload. */
  onSaved: (skyId: string, draft: AdminFigureDraft) => void;
}) {
  const headingId = useId();
  const [initial, setInitial] = useState<AdminFigureDraft | null>(null);
  const [draft, setDraft] = useState<AdminFigureDraft | null>(null);
  const [changes, setChanges] = useState<CatalogChange[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [report, setReport] = useState<{ saved: DraftField[]; failed: FieldOutcome[] } | null>(null);
  const [confirming, setConfirming] = useState(false);
  /* Guards the one thing a double click could do: send the writes twice. */
  const inFlight = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [uploading, startUpload] = useTransition();
  const [imageMenu, setImageMenu] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [pickingBase, setPickingBase] = useState(false);
  /* What the server said about the relation; the name follows the draft. */
  const [editorialSource, setEditorialSource] = useState(false);
  const [variantCount, setVariantCount] = useState(0);
  const [baseName, setBaseName] = useState<string | null>(null);
  /* What the family will be once the new base is saved (CAT-15). */
  const [familyPlan, setFamilyPlan] = useState<VariantFamilyOutcome | null>(null);

  const skyId = figure?.skyId ?? null;

  /*
   * The note, the journal and the base figure's name are not on a catalogue
   * card. One request, when the dialog opens — never one per card.
   *
   * Nothing is reset here. The dialog is mounted with `key={skyId}` by the
   * catalogue, so a different figure is a different component with fresh
   * state.
   */
  useEffect(() => {
    if (!figure) return;
    let cancelled = false;

    void loadFigureEditor(figure.skyId, figure.baseSkyId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.message);
        return;
      }
      const base = draftFrom(figure, result.data.note);
      setInitial(base);
      setDraft(base);
      setChanges(result.data.changes);
      setBaseName(result.data.baseName);
      setVariantCount(result.data.variantCount);
      setEditorialSource(result.data.editorialSource);
    });

    return () => {
      cancelled = true;
    };
  }, [figure]);

  /*
   * What the head shows: the draft's picture if one has been chosen, the
   * figure's current one otherwise — resolved the same way every other
   * surface resolves it, so a staged upload already looks exactly like it
   * will look once it is saved.
   */
  const previewSrc =
    figure === null
      ? null
      : imageSrc({
          imageOverridePath: draft === null ? figure.imageOverridePath : draft.imageOverridePath,
          imageFile: figure.imageFile,
        });

  function stage(file: File) {
    setImageError(null);
    /* Checked here too, so an obviously oversized file never leaves the
       machine. The server checks again, and the bucket a third time. */
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(de.admin.imageTooLarge);
      return;
    }
    if (!skyId) return;
    const form = new FormData();
    form.set("skyId", skyId);
    form.set("file", file);
    startUpload(async () => {
      const result = await stageFigureImage(form);
      if (!result.ok) {
        setImageError(result.message);
        return;
      }
      /* The bytes are in storage; the figure is not changed until save. */
      set("imageOverridePath", result.path);
    });
  }

  const plan = useMemo(
    () => (initial && draft ? changedFields(initial, draft) : []),
    [initial, draft],
  );

  /*
   * THE FAMILY, SHOWN BEFORE IT IS WRITTEN (CAT-15). Only for a base that
   * differs from the stored one; the same rule `setVariantBase` writes by.
   */
  const pendingBase = draft !== null && initial !== null && draft.baseSkyId !== initial.baseSkyId
    ? draft.baseSkyId : null;
  const familyWanted = draft?.createFamilyWithBase ?? false;
  useEffect(() => {
    if (skyId === null || pendingBase === null) return;
    let cancelled = false;
    void previewVariantFamily(skyId, pendingBase, familyWanted).then((outcome) => {
      if (!cancelled) setFamilyPlan(outcome);
    });
    return () => { cancelled = true; };
  }, [skyId, pendingBase, familyWanted]);
  const dirty = plan.length > 0;

  const requestClose = useCallback(() => {
    if (saving) return; // a save in flight is not interrupted by Escape
    if (dirty) {
      setConfirming(true);
      return;
    }
    onClose();
  }, [saving, dirty, onClose]);

  async function save() {
    if (!skyId || !initial || !draft || inFlight.current || plan.length === 0) return;
    inFlight.current = true;
    setSaving(true);
    setReport(null);

    const outcomes: FieldOutcome[] = [];
    for (const field of plan) {
      const result = await WRITERS[field](skyId, draft);
      outcomes.push(
        result.ok ? { field, ok: true } : { field, ok: false, message: result.message },
      );
      /* Stop at the first refusal. Carrying on would write later fields onto a
         figure whose earlier change was rejected, and the operator would have
         to work out which half of their edit exists. */
      if (!result.ok) break;
    }

    const summary = summarise(plan, outcomes);
    const next = baselineAfter(initial, draft, summary.saved);
    setInitial(next);
    setReport({ saved: summary.saved, failed: summary.failed });
    setSaving(false);
    inFlight.current = false;

    /* Only what actually landed reaches the catalogue. */
    if (summary.saved.length > 0) onSaved(skyId, next);

    /*
     * A COMPLETE SAVE CLOSES THE DIALOG. The operator came from a card in a
     * grid, changed one thing, and wants to be back at that card — so the
     * dialog gets out of the way and `Modal` puts focus back on the button
     * that opened it.
     *
     * A PARTIAL SAVE DOES NOT. Closing on a half-written figure would hide
     * the one thing the operator needs to see, and the fields that failed are
     * still dirty with what they typed.
     */
    if (isComplete(plan, summary)) onClose();
  }

  if (!figure) return null;

  const set = <K extends keyof AdminFigureDraft>(key: K, value: AdminFigureDraft[K]) =>
    setDraft((current) => (current === null ? current : { ...current, [key]: value }));

  const complete = report !== null && report.failed.length === 0 && report.saved.length > 0;
  const busy = saving || uploading;

  /*
   * THE NAME IN THE HEAD. The override when the draft has one; otherwise the
   * name the catalogue derives. `figure.displayName` IS that derived name
   * only while the stored override is empty — once one is stored, the raw
   * imported name is the honest fallback to show.
   */
  const shownName = draft?.displayNameOverride
    ?? (figure.displayNameOverride === null ? figure.displayName : figure.canonicalName);
  const overridden = (draft?.displayNameOverride ?? null) !== null;

  return (
    <Modal open onClose={requestClose} labelledBy={headingId} size="lg">
      {/*
        * THE PANEL IS THE COLUMN. THIS FILE ONLY FILLS IT.
        *
        * `Modal` already is `flex flex-col` with a `dvh` ceiling and
        * `overflow-hidden`. Head, body and foot are the panel's own flex
        * children, and the chain that has to hold is one link long.
        */}
      <header className="relative flex shrink-0 items-start gap-3 border-b border-border/60 p-4">
        {/*
          * THE PICTURE, WITH ITS OWN SMALL TOOL.
          *
          * Choosing a file uploads it to storage straight away — bytes have
          * to exist somewhere before anything can point at them — but the
          * FIGURE is not changed until the dialog is saved. Cancelling leaves
          * the figure showing exactly what it showed before; an orphan in the
          * bucket is the cheaper of the two mistakes (`image-actions.ts`).
          */}
        <div className="relative h-16 w-16 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewSrc ?? ""}
            alt=""
            aria-hidden="true"
            className="h-16 w-16 rounded-sky-sm bg-white object-contain"
          />
          <button
            type="button"
            onClick={() => setImageMenu((open) => !open)}
            disabled={draft === null || busy}
            aria-expanded={imageMenu}
            aria-label={de.admin.imageEdit}
            aria-busy={uploading || undefined}
            className="focus-ring absolute -right-1.5 -bottom-1.5 inline-flex h-7 w-7 items-center
                       justify-center rounded-full bg-surface text-muted shadow ring-1 ring-border
                       hover:text-foreground disabled:opacity-60"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none"
                 stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.5 2.5l3 3L6 13H3v-3z" />
            </svg>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) stage(file);
            }}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1">
            <h2 id={headingId} className="min-w-0 truncate text-base font-semibold">
              {shownName}
            </h2>
            <button
              type="button"
              onClick={() => setEditingName((open) => !open)}
              disabled={draft === null || saving}
              aria-expanded={editingName}
              aria-label={de.admin.nameEdit}
              className="focus-ring -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center
                         rounded-full text-muted hover:bg-white/10 hover:text-foreground
                         disabled:opacity-50"
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none"
                   stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.5 2.5l3 3L6 13H3v-3z" />
              </svg>
            </button>
          </div>
          {overridden ? (
            <p className="truncate text-[11px] text-muted">{de.admin.originalName(figure.canonicalName)}</p>
          ) : null}
          <p className="mt-0.5 truncate text-xs text-muted">
            <span className="font-mono">{figure.skyId}</span>
            {" · "}{figure.seriesLabel}
            {figure.element ? ` · ${figure.element}` : ""}
          </p>
          {draft !== null ? (
            <label className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted">
              <span className="sr-only">{de.admin.propertyStatus}</span>
              <select
                value={draft.catalogStatus}
                onChange={(event) => set("catalogStatus", asStatus(event.target.value))}
                disabled={saving}
                className="min-h-8 rounded-sky-sm bg-deep/50 px-1.5 text-xs text-foreground
                           ring-1 ring-border/50 focus-ring"
              >
                {CATALOG_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {/*
          * `requestClose`, not `onClose`: this is the same door as Escape and
          * the backdrop, so it asks before throwing away an unsaved edit. It
          * sits in the head, so a long form scrolls underneath it and never
          * past it.
          */}
        <button
          type="button"
          onClick={requestClose}
          disabled={saving}
          aria-label={de.admin.closeEditor}
          className={
            "focus-ring -mt-1.5 -mr-1.5 inline-flex h-11 w-11 shrink-0 items-center " +
            "justify-center rounded-full text-muted transition-colors " +
            "hover:bg-white/10 hover:text-foreground disabled:opacity-50"
          }
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>

        {/* The image tool's two actions, under the picture. */}
        {imageMenu && draft !== null ? (
          <div className="absolute top-[5.25rem] left-4 z-10 flex flex-col gap-1 rounded-sky-md
                          bg-surface p-1.5 shadow-lg ring-1 ring-border">
            <button
              type="button"
              onClick={() => { setImageMenu(false); fileInput.current?.click(); }}
              disabled={busy}
              className="focus-ring min-h-11 rounded-sky-sm px-3 text-left text-sm hover:bg-white/10"
            >
              {draft.imageOverridePath !== null || figure.imageFile ? de.admin.imageReplace
                                                                      : de.admin.imageUpload}
            </button>
            {draft.imageOverridePath !== null ? (
              <button
                type="button"
                onClick={() => { setImageMenu(false); set("imageOverridePath", null); }}
                disabled={busy}
                className="focus-ring min-h-11 rounded-sky-sm px-3 text-left text-sm hover:bg-white/10"
              >
                {de.admin.imageRemove}
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {/*
        * THE ONLY SCROLLING REGION, AND WHY IT IS SPELLED LIKE THIS.
        *
        * `min-h-0` lets a flex child shrink below its content, so the body
        * scrolls instead of the column growing past the panel's ceiling.
        * NOT `flex-1`: a short editor stays short. `overscroll-contain`
        * keeps the gesture here. `pb-6` keeps the last field off the foot.
        */}
      <div className="min-h-0 overflow-y-auto overscroll-contain p-4 pb-6">
        {loadError !== null ? (
          <p role="alert" className="text-sm text-danger">
            {loadError}
          </p>
        ) : draft === null ? (
          <p className="text-sm text-muted">{de.admin.loading}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {imageError !== null ? (
              <p role="alert" className="text-xs text-danger">{imageError}</p>
            ) : null}

            {editingName ? (
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">{de.admin.overrideLabel}</span>
                <span className="flex gap-2">
                  <input
                    type="text"
                    value={draft.displayNameOverride ?? ""}
                    autoFocus
                    onChange={(event) =>
                      set("displayNameOverride", event.target.value === "" ? null : event.target.value)
                    }
                    onKeyDown={(event) => {
                      /* Enter and Escape end the edit, not the dialog. The
                         value stays in the draft either way. */
                      if (event.key === "Enter" || event.key === "Escape") {
                        event.preventDefault();
                        setEditingName(false);
                      }
                    }}
                    maxLength={120}
                    className="min-h-11 min-w-0 flex-1 rounded-sky-md bg-surface px-3 py-2 text-sm
                               ring-1 ring-border focus-ring"
                  />
                  <button type="button" onClick={() => setEditingName(false)} className={ACTION_NEUTRAL}>
                    {de.admin.nameEditDone}
                  </button>
                </span>
                <span className="text-xs text-muted">{de.admin.overrideHint}</span>
              </label>
            ) : null}

            <Property label={de.admin.propertyVariantOf}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm">
                  {draft.baseSkyId === null ? de.admin.propertyNone : (baseName ?? draft.baseSkyId)}
                </span>
                {draft.baseSkyId !== null ? (
                  <span className="font-mono text-[11px] text-muted">{draft.baseSkyId}</span>
                ) : null}
                {editorialSource ? (
                  !pickingBase ? (
                    <button
                      type="button"
                      onClick={() => setPickingBase(true)}
                      disabled={saving}
                      className="focus-ring min-h-8 text-xs text-muted underline decoration-dotted
                                 hover:text-foreground"
                    >
                      {de.admin.baseChange}
                    </button>
                  ) : null
                ) : (
                  <span className="text-[11px] text-muted">{de.admin.baseEditOnStaging}</span>
                )}
              </div>
              {pendingBase !== null && familyPlan !== null ? (
                <FamilyPlanLine
                  plan={familyPlan}
                  adopt={draft.adoptBaseFamily}
                  reuse={draft.reuseFamilyId}
                  disabled={saving}
                  onAdopt={(value) => set("adoptBaseFamily", value)}
                  onReuse={(id) => set("reuseFamilyId", id)}
                />
              ) : null}
              {variantCount > 0 ? (
                <p className="mt-0.5 text-[11px] text-muted">{de.admin.baseVariantsSoFar(variantCount)}</p>
              ) : null}
              {editorialSource && pickingBase ? (
                <BasePicker
                  skyId={figure.skyId}
                  disabled={saving}
                  canRemove={draft.baseSkyId !== null}
                  onCancel={() => setPickingBase(false)}
                  onPick={(target, createFamily) => {
                    setFamilyPlan(null);
                    setDraft((current) => current === null ? current : {
                      ...current,
                      baseSkyId: target?.skyId ?? null,
                      createFamilyWithBase: target !== null && createFamily,
                      adoptBaseFamily: false,
                      reuseFamilyId: null,
                    });
                    setBaseName(target?.name ?? null);
                    setPickingBase(false);
                  }}
                />
              ) : null}
            </Property>

            <Property label={de.admin.typeHeading}>
              <TypeChips
                types={draft.types}
                bannerType={figure.visibleType ?? null}
                disabled={saving}
                onChange={(next) => set("types", next)}
              />
              <p className="mt-1 text-[11px] text-muted">{de.admin.typeChipHint}</p>
            </Property>

            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-medium tracking-wide text-muted uppercase">
                {de.admin.sectionMoreDetails}
              </h3>

              {/*
                * KARTENKUNST BLEIBT. `card_type` entscheidet, auf welche Karte
                * die Figur in Katalog, Shop und Sammlung gedruckt wird, und der
                * Publish überträgt das Feld (`publish-compare.ts`). Es wird nur
                * seltener geändert — darum hier und nicht oben.
                */}
              <More title={de.admin.cardType} summary={CARD_TYPE_LABELS[draft.cardType]}>
                <label className="flex flex-col gap-1">
                  <span className="sr-only">{de.admin.cardType}</span>
                  <select
                    value={draft.cardType}
                    onChange={(event) => set("cardType", event.target.value as AdminFigureDraft["cardType"])}
                    className="min-h-11 rounded-sky-md bg-surface px-3 py-2 text-sm ring-1 ring-border focus-ring"
                  >
                    {CARD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {CARD_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-muted">{de.admin.cardTypeHint}</span>
                </label>
              </More>

              <More title={de.admin.note} summary={draft.adminNote.trim() === "" ? undefined : "•"}>
                <label className="flex flex-col gap-1">
                  <span className="sr-only">{de.admin.note}</span>
                  <textarea
                    value={draft.adminNote}
                    onChange={(event) => set("adminNote", event.target.value)}
                    maxLength={2000}
                    rows={3}
                    className="rounded-sky-md bg-surface px-3 py-2 text-sm ring-1 ring-border focus-ring"
                  />
                  <span className="text-xs text-muted">{de.admin.noteHint}</span>
                </label>
              </More>

              <More title={de.admin.sectionTechnical} summary={figure.skyId}>
                <p className="text-xs text-muted">{de.admin.sectionIdentityHint}</p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <Fact label={de.admin.skyId} value={figure.skyId} />
                  <Fact label={de.admin.canonicalName} value={figure.canonicalName} />
                  <Fact label={de.admin.series} value={figure.seriesLabel} />
                  <Fact label={de.admin.category} value={figure.categoryName} />
                  <Fact label={de.admin.group} value={groupLabel(figure.catalogGroup)} />
                  <Fact label={de.admin.elementLabel} value={figure.element ?? "—"} />
                </dl>
              </More>

              {changes.length > 0 ? (
                <More title={de.admin.sectionHistory} summary={String(changes.length)}>
                  <ul className="flex flex-col gap-1 text-xs text-muted">
                    {changes.map((change) => (
                      <li key={`${change.field}-${change.changedAt}`} className="break-words">
                        <span className="text-foreground">{change.field}</span>{" "}
                        {change.oldValue ?? "—"} → {change.newValue ?? "—"}{" "}
                        {formatDate(change.changedAt)}
                      </li>
                    ))}
                  </ul>
                </More>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/*
        * `shrink-0`, like the head: whatever the body does, saving stays one
        * press away.
        */}
      <footer className="flex shrink-0 flex-col gap-2 border-t border-border/60 p-4">
        {/* The result, stated as what it is. A partial save is not a success. */}
        {report !== null && report.failed.length > 0 ? (
          <p role="alert" className="text-sm text-danger">
            {report.saved.length === 0
              ? report.failed[0].message
              : de.admin.savedPartly(report.saved.length, report.saved.length + report.failed.length)}
          </p>
        ) : complete ? (
          <p role="status" className="text-sm text-muted">
            {de.admin.saved}
          </p>
        ) : null}

        <div className="flex gap-2">
          <button type="button" onClick={requestClose} disabled={saving} className={ACTION_NEUTRAL}>
            {de.admin.cancel}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving}
            aria-busy={saving || undefined}
            className={ACTION_PRIMARY + (dirty && !saving ? "" : " opacity-60")}
          >
            {saving ? de.admin.saving : de.admin.saveChanges}
          </button>
        </div>
      </footer>
      {/* Closing with unsaved changes asks first. Rendered inside the same
          panel so the focus trap keeps holding. */}
      {confirming ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-sky-lg bg-surface p-4 ring-1 ring-border">
            <p className="text-sm font-medium">{de.admin.discardTitle}</p>
            <p className="mt-1 text-xs text-muted">{de.admin.discardBody}</p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setConfirming(false)} className={ACTION_NEUTRAL}>
                {de.admin.keepEditing}
              </button>
              <button type="button" onClick={onClose} className={ACTION_PRIMARY}>
                {de.admin.discard}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
