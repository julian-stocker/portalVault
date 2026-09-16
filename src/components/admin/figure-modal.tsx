/**
 * The administrator's figure editor, as a dialog (V3.8).
 *
 * WHY A DIALOG AND NOT A PAGE
 *
 * Editing a figure used to mean leaving the catalogue: a link to
 * `/admin/catalog/<skyId>`, a page, and the back button to get to where you
 * were. That is the right shape for a deep edit and the wrong one for the
 * work this actually is — glance at a grid, fix one thing, glance at the next.
 * The page stays; this is the fast path beside it.
 *
 * FIVE FIELDS, COLLECTED, THEN SAVED
 *
 * Every editor on the detail page writes the moment you touch it. Here they
 * do not: the dialog takes a copy, the operator changes what they like, and
 * one button sends only what differs (`lib/admin/figure-draft.ts`).
 *
 * THAT SAVE IS NOT A TRANSACTION, AND THIS FILE DOES NOT PRETEND IT IS.
 *
 * Each field is its own `security definer` function with its own
 * `is_shop_admin()` check. There is no RPC that takes all five, and inventing
 * one would be a schema change for a dialog — so five changed fields are five
 * writes, in order, and any of them can fail on its own. What that costs is
 * honesty: a partial save says which fields landed, keeps the dialog open,
 * and leaves the rest dirty. It never says "Gespeichert" when four of five
 * went through.
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
  setCatalogVisible,
  setDisplayNameOverride,
  setImageOverride,
  type AdminResult,
} from "@/lib/admin/actions";
import { stageFigureImage } from "@/lib/admin/image-actions";
import { FigureImage } from "@/components/catalog/figure-image";
import { MAX_IMAGE_BYTES } from "@/lib/admin/image-file";
import type { CatalogChange } from "@/lib/admin/queries";
import type { CatalogFigure } from "@/lib/catalog/types";
import { groupLabel } from "@/lib/catalog/group";
import { imageSrc } from "@/lib/catalog/image";
import { formatDate } from "@/lib/format";
import { de } from "@/lib/i18n/de";

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
  cardType: (skyId, draft) => setCardType(skyId, draft.cardType),
  imageOverridePath: (skyId, draft) => setImageOverride(skyId, draft.imageOverridePath),
  catalogVisible: (skyId, draft) => setCatalogVisible(skyId, draft.catalogVisible),
  adminNote: (skyId, draft) => setAdminNote(skyId, draft.adminNote),
};

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border/60 pt-4 first:border-0 first:pt-0">
      <h3 className="text-sm font-medium">{title}</h3>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="truncate text-sm">{value}</dd>
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

  const skyId = figure?.skyId ?? null;

  /*
   * The note and the journal are not on a catalogue card. One request, when
   * the dialog opens — never one per card.
   *
   * Nothing is reset here. The dialog is mounted with `key={skyId}` by the
   * catalogue, so a different figure is a different component with fresh
   * state — which is both cheaper and safer than five setters at the top of
   * an effect, where React would have to throw away a render it had just
   * started.
   */
  useEffect(() => {
    if (!figure) return;
    let cancelled = false;

    void loadFigureEditor(figure.skyId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.message);
        return;
      }
      const base = draftFrom(figure, result.data.note);
      setInitial(base);
      setDraft(base);
      setChanges(result.data.changes);
    });

    return () => {
      cancelled = true;
    };
  }, [figure]);

  /*
   * What the preview shows: the draft's picture if one has been chosen, the
   * figure's current one otherwise. Resolved the same way every other surface
   * resolves it, so a staged upload looks exactly like it will look once it
   * is saved.
   */
  const previewSrc =
    figure === null || draft === null
      ? null
      : /* The same resolver every other surface uses, given the DRAFT's
           override rather than the stored one — so a staged upload already
           looks exactly like it will look once it is saved. */
        imageSrc({ imageOverridePath: draft.imageOverridePath, imageFile: figure.imageFile });

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
     * dialog gets out of the way, `Modal` puts focus back on the button that
     * opened it, and the page never navigated, so the scroll position was
     * never anywhere else.
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

  return (
    <Modal open onClose={requestClose} labelledBy={headingId} size="lg">
      <div className="flex max-h-[85vh] flex-col">
        {/* The figure, so there is no doubt which one is being changed. */}
        <header className="flex items-start gap-3 border-b border-border/60 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageSrc(figure) ?? ""}
            alt=""
            aria-hidden="true"
            className="h-14 w-14 shrink-0 rounded-sky-sm bg-white object-contain"
          />
          <div className="min-w-0 flex-1">
            <h2 id={headingId} className="truncate text-base font-semibold">
              {figure.displayName}
            </h2>
            <p className="mt-0.5 font-mono text-xs text-muted">
              {figure.skyId} · {CARD_TYPE_LABELS[draft?.cardType ?? figure.cardType]}
            </p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain p-4">
          {loadError !== null ? (
            <p role="alert" className="text-sm text-danger">
              {loadError}
            </p>
          ) : draft === null ? (
            <p className="text-sm text-muted">{de.admin.loading}</p>
          ) : (
            <div className="flex flex-col gap-5">
              <Section title={de.admin.sectionIdentity} hint={de.admin.sectionIdentityHint}>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <Fact label={de.admin.skyId} value={figure.skyId} />
                  <Fact label={de.admin.canonicalName} value={figure.canonicalName} />
                  <Fact label={de.admin.series} value={figure.seriesLabel} />
                  <Fact label={de.admin.category} value={figure.categoryName} />
                  <Fact label={de.admin.group} value={groupLabel(figure.catalogGroup)} />
                  <Fact label={de.admin.elementLabel} value={figure.element ?? "—"} />
                </dl>
              </Section>

              <Section title={de.admin.sectionDisplay}>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted">{de.admin.overrideLabel}</span>
                  <input
                    type="text"
                    value={draft.displayNameOverride ?? ""}
                    onChange={(event) =>
                      set("displayNameOverride", event.target.value === "" ? null : event.target.value)
                    }
                    maxLength={120}
                    className="min-h-11 rounded-sky-md bg-surface px-3 py-2 text-sm ring-1 ring-border focus-ring"
                  />
                  <span className="text-xs text-muted">{de.admin.overrideHint}</span>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted">{de.admin.cardType}</span>
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

                {/*
                  * THE PICTURE, IN TWO STEPS THAT ARE NOT ONE.
                  *
                  * Choosing a file uploads it to storage straight away —
                  * bytes have to exist somewhere before anything can point at
                  * them — but the FIGURE is not changed until the dialog is
                  * saved. So the preview below is a draft like every other
                  * field, and cancelling leaves the figure showing exactly
                  * what it showed before.
                  *
                  * What that costs is an orphan in the bucket if the operator
                  * uploads and then discards. The object is content-addressed,
                  * so the same picture is the same object however often it is
                  * chosen, and `image-actions.ts` already records that an
                  * orphan is the cheaper of the two mistakes.
                  */}
                <div className="flex flex-col gap-2">
                  <span className="text-xs text-muted">{de.admin.image}</span>
                  <div className="flex items-start gap-3">
                    <div className="w-24 shrink-0">
                      <FigureImage src={previewSrc} name={figure.displayName} />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <p className="text-[11px] text-muted">
                        {draft.imageOverridePath ? de.admin.imageOwn : de.admin.imageImported}
                      </p>
                      <input
                        ref={fileInput}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="sr-only"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (file) stage(file);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => fileInput.current?.click()}
                        disabled={uploading || saving}
                        aria-busy={uploading || undefined}
                        className={ACTION_NEUTRAL}
                      >
                        {uploading ? de.admin.imageUploading : de.admin.imageReplace}
                      </button>
                      {draft.imageOverridePath !== null ? (
                        <button
                          type="button"
                          onClick={() => set("imageOverridePath", null)}
                          disabled={uploading || saving}
                          className="text-xs text-link underline underline-offset-2"
                        >
                          {de.admin.imageRemove}
                        </button>
                      ) : null}
                      {imageError !== null ? (
                        <p role="alert" className="text-xs text-danger">
                          {imageError}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </Section>

              <Section title={de.admin.sectionVisibility} hint={de.admin.sectionVisibilityHint}>
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={draft.catalogVisible}
                    onChange={(event) => set("catalogVisible", event.target.checked)}
                    className="h-5 w-5 accent-[#3b2a17] focus-ring"
                  />
                  <span className="text-sm">{de.admin.visibleLabel}</span>
                </label>
              </Section>

              <Section title={de.admin.sectionInternal}>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted">{de.admin.note}</span>
                  <textarea
                    value={draft.adminNote}
                    onChange={(event) => set("adminNote", event.target.value)}
                    maxLength={2000}
                    rows={3}
                    className="rounded-sky-md bg-surface px-3 py-2 text-sm ring-1 ring-border focus-ring"
                  />
                  <span className="text-xs text-muted">{de.admin.noteHint}</span>
                </label>
              </Section>

              {changes.length > 0 ? (
                <Section title={de.admin.sectionHistory}>
                  <ul className="flex flex-col gap-1 text-xs text-muted">
                    {changes.map((change) => (
                      <li key={`${change.field}-${change.changedAt}`}>
                        <span className="text-foreground">{change.field}</span>{" "}
                        {change.oldValue ?? "—"} → {change.newValue ?? "—"}{" "}
                        {formatDate(change.changedAt)}
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}
            </div>
          )}
        </div>

        <footer className="flex flex-col gap-2 border-t border-border/60 p-4">
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
      </div>

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
