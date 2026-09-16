/**
 * Creating a catalogue figure, as a dialog (V3.9, ADR-0070).
 *
 * WHY THE CREATE AND THE PICTURE ARE TWO PHASES
 *
 * The figure is one transaction: `admin_create_figure()` allocates the
 * SKY-ID, writes the row, the note and the journal entry, and either all of
 * it happened or none of it did. The picture cannot be inside that
 * transaction, and not for a reason worth designing around: an uploaded
 * object lives at `SKY-xxxx/<hash>.webp`, so the path needs the identity the
 * create is in the middle of issuing. There is no ordering that makes the two
 * atomic, so this file does not pretend there is.
 *
 * What it does instead is tell the truth about the middle state. If the row
 * lands and the upload does not, the figure EXISTS — with its own SKY-ID,
 * spent and unreissuable — and the dialog says so, offers to close, and never
 * calls create again. A second create on a failed upload would be a second
 * identity for one figure, which is the one mistake this whole design is
 * built to prevent.
 *
 * HIDDEN BY DEFAULT
 *
 * A new figure is not public until somebody says so. It arrives with no
 * picture, no curated character and possibly a working title; publishing that
 * the instant the button is pressed shows it to every visitor. The
 * administrator sees it in the grid, dimmed and badged, and publishes it from
 * the V3.8 editor when it is ready.
 *
 * WHAT IS NOT IN THIS DIALOG
 *
 * The SKY-ID and the slug (the database issues both), the market price (the
 * legacy path, ADR-0007), `image_file` (the import's, ADR-0009), and
 * `character_id` — curation stays in data/characters/characters.json and is
 * not something a form gets to guess at (ADR-0034).
 */
"use client";

import {
  useCallback,
  useDeferredValue,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { Modal } from "@/components/ui/modal";
import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { CARD_TYPES, CARD_TYPE_LABELS } from "@/lib/catalog/card-type";
import {
  EMPTY_DRAFT,
  categoriesFor,
  fromTemplate,
  groupOf,
  inheritsCharacter,
  isCreatable,
  nameConfirmed,
  similarFigures,
  slugPreview,
  withSeries,
  type CategoryOption,
  type NewFigureDraft,
  type SeriesOption,
} from "@/lib/admin/new-figure-draft";
import { createFigure } from "@/lib/admin/create-actions";
import { stageFigureImage } from "@/lib/admin/image-actions";
import { setImageOverride } from "@/lib/admin/actions";
import { MAX_IMAGE_BYTES } from "@/lib/admin/image-file";
import { groupLabel } from "@/lib/catalog/group";
import { isCatalogGroup } from "@/lib/catalog/group";
import type { CatalogFigure } from "@/lib/catalog/types";
import { de } from "@/lib/i18n/de";

type Start = "empty" | "template";

/**
 * Where the dialog is in the two-phase flow.
 *
 * `partial` is the one that earns its place: the figure exists and the
 * picture does not, and from there the only actions are "close" and "look at
 * it in the editor" — never "create again".
 */
type Phase =
  | { kind: "editing" }
  | { kind: "working" }
  | { kind: "partial"; skyId: string };

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border/60 pt-4 first:border-0 first:pt-0">
      <h3 className="text-sm font-medium">{title}</h3>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

/** A value the operator reads but cannot type. */
function Derived({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted">{label}</p>
      <p className="truncate text-sm">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

const FIELD =
  "min-h-11 rounded-sky-md bg-surface px-3 py-2 text-sm ring-1 ring-border focus-ring";

export function AddFigureModal({
  open,
  onClose,
  series,
  categories,
  figures,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  series: readonly SeriesOption[];
  categories: readonly CategoryOption[];
  /** The catalogue already on screen — the template picker and the duplicate
      warning both read it, so neither costs a request. */
  figures: readonly CatalogFigure[];
  /** Told the new identity so the catalogue can refresh and confirm it. */
  onCreated: (skyId: string) => void;
}) {
  const headingId = useId();
  const [start, setStart] = useState<Start>("empty");
  const [templateSkyId, setTemplateSkyId] = useState<string | null>(null);
  const [templateQuery, setTemplateQuery] = useState("");
  const [draft, setDraft] = useState<NewFigureDraft>(EMPTY_DRAFT);
  const [phase, setPhase] = useState<Phase>({ kind: "editing" });
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /* Guards the one thing a double click could do: issue a second SKY-ID. */
  const inFlight = useRef(false);
  /*
   * THE CREATE IS DISPATCHED IN A TRANSITION, AND THAT IS NOT DECORATION.
   *
   * Next applies a mutation's revalidated RSC payload to the mounted tree
   * only when the Server Action was called inside one — it happens by itself
   * for `<form action>` and `<button formAction>`, and has to be done by hand
   * anywhere else. Called from a bare `onClick`, the action still runs and
   * still writes: the row is created, `revalidatePath()` and `refresh()` do
   * their work on the server, and the browser keeps the catalogue it was
   * rendered with. The new figure exists and is nowhere to be seen.
   *
   * The V3.8 editor gets away without one because it never needed the
   * server's answer — it redraws the card from its own draft. A create has no
   * existing row to overlay, so the payload is the only way the figure can
   * arrive. Every other admin component that depends on one — `inline-name`,
   * `image-editor`, `price-editor`, `stock-stepper`, `shop-settings` — uses a
   * transition for exactly this reason.
   */
  const [, startTransition] = useTransition();

  const template = useMemo(
    () => figures.find((figure) => figure.skyId === templateSkyId) ?? null,
    [figures, templateSkyId],
  );

  const set = <K extends keyof NewFigureDraft>(key: K, value: NewFigureDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const available = categoriesFor(categories, draft.seriesCode);
  const group = groupOf(categories, draft.categoryId);
  const slug = slugPreview(draft);

  /* 561 cards behind a search box: deferred, like the catalogue's own. */
  const deferredQuery = useDeferredValue(templateQuery);
  const matches = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    if (needle === "") return [];
    return figures
      .filter(
        (figure) =>
          figure.displayName.toLowerCase().includes(needle) ||
          figure.skyId.toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [figures, deferredQuery]);

  const similar = useMemo(() => similarFigures(draft, figures), [draft, figures]);

  const confirmed = nameConfirmed(draft, template?.name ?? null);
  const ready = isCreatable(draft, categories) && confirmed;
  const busy = phase.kind === "working";

  const requestClose = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  function chooseTemplate(figure: CatalogFigure) {
    setTemplateSkyId(figure.skyId);
    setDraft(fromTemplate(figure));
    setTemplateQuery("");
  }

  function clearTemplate() {
    setTemplateSkyId(null);
    setDraft(EMPTY_DRAFT);
  }

  function pickFile(chosen: File) {
    setImageError(null);
    /* Checked here so an obviously oversized file never leaves the machine.
       The server checks again, and the bucket a third time. */
    if (chosen.size > MAX_IMAGE_BYTES) {
      setImageError(de.admin.imageTooLarge);
      return;
    }
    setFile(chosen);
  }

  /**
   * PHASE A, then PHASE B. Never A twice.
   *
   * `inFlight` and the `partial` phase between them mean the create call has
   * exactly one chance to run per dialog: once a SKY-ID exists, every path
   * out of here either closes or hands over to the editor.
   */
  async function submit() {
    if (!ready || inFlight.current) return;
    inFlight.current = true;
    setPhase({ kind: "working" });
    setError(null);
    setImageError(null);

    // ---- Phase A: the figure. One transaction, in the database.
    const created = await createFigure({
      name: draft.name,
      seriesCode: draft.seriesCode,
      categoryId: draft.categoryId as number,
      cardType: draft.cardType,
      catalogVisible: draft.catalogVisible,
      displayNameOverride: draft.displayNameOverride,
      adminNote: draft.adminNote,
      /* The SKY-ID the operator pointed at. The server reads the character
         from it; this side never states one (ADR-0070a). */
      templateSkyId: draft.templateSkyId,
    });

    if (!created.ok) {
      // Nothing was written. The drawn sequence number is spent, which is
      // why a retry gets the next one — and why that is correct.
      setPhase({ kind: "editing" });
      setError(created.message);
      inFlight.current = false;
      return;
    }

    // ---- Phase B: the picture, only if one was chosen. The figure already
    //      exists from here on, whatever happens next.
    if (file !== null) {
      const form = new FormData();
      form.set("skyId", created.skyId);
      form.set("file", file);
      const staged = await stageFigureImage(form);

      if (!staged.ok) {
        setPhase({ kind: "partial", skyId: created.skyId });
        setImageError(staged.message);
        inFlight.current = false;
        onCreated(created.skyId);
        return;
      }

      const pointed = await setImageOverride(created.skyId, staged.path);
      if (!pointed.ok) {
        setPhase({ kind: "partial", skyId: created.skyId });
        setImageError(pointed.message);
        inFlight.current = false;
        onCreated(created.skyId);
        return;
      }
    }

    inFlight.current = false;
    onCreated(created.skyId);
    onClose();
  }

  if (!open) return null;

  return (
    <Modal open onClose={requestClose} labelledBy={headingId} size="lg">
      {/* The V3.8a structure, unchanged: head, one scrolling body, foot —
          straight into the panel, no wrapper, no height of its own. */}
      <header className="flex shrink-0 items-start gap-3 border-b border-border/60 p-4">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="truncate text-base font-semibold">
            {de.admin.addFigureTitle}
          </h2>
          <p className="mt-0.5 font-mono text-xs text-muted">{de.admin.skyIdAuto}</p>
        </div>

        <button
          type="button"
          onClick={requestClose}
          disabled={busy}
          aria-label={de.admin.closeAdd}
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
      </header>

      <div className="min-h-0 overflow-y-auto overscroll-contain p-4 pb-6">
        {phase.kind === "partial" ? (
          /*
           * The figure exists. Everything that could create another one is
           * gone from the screen — this is the only state in the dialog with
           * no create button, on purpose.
           */
          <div className="flex flex-col gap-3">
            <p role="alert" className="text-sm text-danger">
              {de.admin.createdWithoutImage(phase.skyId)}
            </p>
            <p className="text-xs text-muted">{de.admin.imageAfterwards}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <Section title={de.admin.startHeading} hint={de.admin.templateHint}>
              <div className="flex flex-wrap gap-2">
                {(["empty", "template"] as const).map((option) => (
                  <label key={option} className="flex min-h-11 items-center gap-2">
                    <input
                      type="radio"
                      name="start"
                      checked={start === option}
                      onChange={() => {
                        setStart(option);
                        if (option === "empty") clearTemplate();
                      }}
                      className="h-4 w-4 accent-[#3b2a17] focus-ring"
                    />
                    <span className="text-sm">
                      {option === "empty" ? de.admin.startEmpty : de.admin.startTemplate}
                    </span>
                  </label>
                ))}
              </div>

              {start === "template" ? (
                template !== null ? (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-3">
                      <p className="min-w-0 flex-1 truncate text-sm">
                        {de.admin.templateChosen(template.displayName)}
                      </p>
                      <button
                        type="button"
                        onClick={clearTemplate}
                        className="text-xs text-link underline underline-offset-2"
                      >
                        {de.admin.templateClear}
                      </button>
                    </div>
                    {/*
                      * Said out loud, because it is the whole point of picking
                      * a template — and because a template that has no curated
                      * character hands over nothing, which the operator has to
                      * know rather than assume (ADR-0070a). Nothing is guessed
                      * from the name to fill that gap.
                      */}
                    <p
                      className={
                        "text-xs " + (inheritsCharacter(template) ? "text-muted" : "text-danger")
                      }
                    >
                      {inheritsCharacter(template)
                        ? de.admin.templateInherits
                        : de.admin.templateNoCharacter}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <input
                      type="search"
                      value={templateQuery}
                      onChange={(event) => setTemplateQuery(event.target.value)}
                      placeholder={de.admin.templateSearch}
                      aria-label={de.admin.templateSearch}
                      className={FIELD}
                    />
                    {templateQuery.trim() !== "" ? (
                      matches.length === 0 ? (
                        <p className="text-xs text-muted">{de.admin.templateNone}</p>
                      ) : (
                        <ul className="flex flex-col gap-1">
                          {matches.map((figure) => (
                            <li key={figure.skyId}>
                              <button
                                type="button"
                                onClick={() => chooseTemplate(figure)}
                                className="focus-ring flex min-h-11 w-full items-center gap-2 rounded-sky-md px-2 text-left text-sm hover:bg-white/5"
                              >
                                <span className="font-mono text-xs text-muted">{figure.skyId}</span>
                                <span className="min-w-0 flex-1 truncate">{figure.displayName}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )
                    ) : null}
                  </div>
                )
              ) : null}
            </Section>

            <Section title={de.admin.sectionIdentity}>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">{de.admin.createName}</span>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(event) => set("name", event.target.value)}
                  maxLength={200}
                  className={FIELD}
                />
                <span className="text-xs text-muted">{de.admin.createNameHint}</span>
                {!confirmed ? (
                  <span role="alert" className="text-xs text-danger">
                    {de.admin.templateNameUnchanged}
                  </span>
                ) : null}
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">{de.admin.createSeries}</span>
                <select
                  value={draft.seriesCode}
                  onChange={(event) => setDraft((current) => withSeries(current, event.target.value))}
                  className={FIELD}
                >
                  <option value="">—</option>
                  {series.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">{de.admin.createCategory}</span>
                <select
                  value={draft.categoryId ?? ""}
                  onChange={(event) =>
                    set("categoryId", event.target.value === "" ? null : Number(event.target.value))
                  }
                  disabled={draft.seriesCode === ""}
                  className={FIELD + " disabled:opacity-60"}
                >
                  <option value="">—</option>
                  {available.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
                {draft.seriesCode === "" ? (
                  <span className="text-xs text-muted">{de.admin.createCategoryFirst}</span>
                ) : null}
              </label>

              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Derived
                  label={de.admin.group}
                  value={isCatalogGroup(group) ? groupLabel(group) : "—"}
                  hint={de.admin.groupDerived}
                />
                <Derived label={de.admin.elementLabel} value="—" hint={de.admin.elementDerived} />
              </div>

              <Derived
                label={de.admin.slugLabel}
                value={slug === "" ? "—" : slug}
                hint={de.admin.slugPreviewHint}
              />
            </Section>

            <Section title={de.admin.sectionDisplay}>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">{de.admin.cardType}</span>
                <select
                  value={draft.cardType}
                  onChange={(event) =>
                    set("cardType", event.target.value as NewFigureDraft["cardType"])
                  }
                  className={FIELD}
                >
                  {CARD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {CARD_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted">{de.admin.cardTypeHint}</span>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">{de.admin.overrideLabel}</span>
                <input
                  type="text"
                  value={draft.displayNameOverride}
                  onChange={(event) => set("displayNameOverride", event.target.value)}
                  maxLength={120}
                  className={FIELD}
                />
                <span className="text-xs text-muted">{de.admin.overrideHint}</span>
              </label>

              <div className="flex flex-col gap-2">
                <span className="text-xs text-muted">{de.admin.image}</span>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(event) => {
                    const chosen = event.target.files?.[0];
                    event.target.value = "";
                    if (chosen) pickFile(chosen);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={busy}
                  className={ACTION_NEUTRAL}
                >
                  {file === null ? de.admin.imageReplace : file.name}
                </button>
                <span className="text-xs text-muted">{de.admin.createImageHint}</span>
                {imageError !== null ? (
                  <p role="alert" className="text-xs text-danger">
                    {imageError}
                  </p>
                ) : null}
              </div>
            </Section>

            <Section title={de.admin.sectionVisibility} hint={de.admin.createVisibleHint}>
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  checked={draft.catalogVisible}
                  onChange={(event) => set("catalogVisible", event.target.checked)}
                  className="h-5 w-5 accent-[#3b2a17] focus-ring"
                />
                <span className="text-sm">{de.admin.createVisibleLabel}</span>
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

            {/* A warning, never a refusal: the catalogue is full of names that
                legitimately repeat, so this reports and steps aside. */}
            {similar.length > 0 ? (
              <Section title={de.admin.similarTitle} hint={de.admin.similarHint}>
                <ul className="flex flex-col gap-1 text-xs text-muted">
                  {similar.map((match) => (
                    <li key={match.skyId} className="truncate">
                      <span className="font-mono">{match.skyId}</span>{" "}
                      <span className="text-foreground">{match.displayName}</span>{" "}
                      {match.seriesLabel} · {CARD_TYPE_LABELS[match.cardType]}
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}
          </div>
        )}
      </div>

      <footer className="flex shrink-0 flex-col gap-2 border-t border-border/60 p-4">
        {error !== null ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        {phase.kind === "partial" ? (
          <button type="button" onClick={onClose} className={ACTION_PRIMARY}>
            {de.admin.closeWithoutImage}
          </button>
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={requestClose} disabled={busy} className={ACTION_NEUTRAL}>
              {de.admin.cancel}
            </button>
            <button
              type="button"
              onClick={() => startTransition(submit)}
              disabled={!ready || busy}
              aria-busy={busy || undefined}
              className={ACTION_PRIMARY + (ready && !busy ? "" : " opacity-60")}
            >
              {busy ? de.admin.creating : de.admin.create}
            </button>
          </div>
        )}
      </footer>
    </Modal>
  );
}
