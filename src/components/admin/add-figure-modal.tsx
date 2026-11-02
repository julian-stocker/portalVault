/**
 * Creating a catalogue figure, as a dialog (V3.9, ADR-0070; compact since
 * CAT-11).
 *
 * WHAT THE OPERATOR SEES FIRST
 *
 * The standard case fits a desktop screen without scrolling: „Variante von",
 * name, variant type and series, category and card art, a one-line preview,
 * and the two actions in a footer that never scrolls away. Everything rarer —
 * the display name, the picture, visibility, the internal note, the template
 * and the derived values — sits under „Weitere Optionen", closed.
 *
 * „VARIANTE VON" IS A RELATION, THE TEMPLATE IS NOT
 *
 * Choosing a base figure stores `base_sky_id` — the catalogue groups, sorts
 * and badges by it, and the publish carries it to Production. The template
 * (still there, under „Weitere Optionen", for standalone figures only) hands
 * over a character and is forgotten. With a base, the base IS the template:
 * `admin_create_variant_figure` (`0166`) takes the character from it, and
 * the series too, because a variant belongs to a base of the same series.
 *
 * WHY THE CREATE AND THE PICTURE ARE TWO PHASES
 *
 * The figure is one transaction: the database allocates the SKY-ID, writes
 * the row, the note, the relation and the journal entries, and either all of
 * it happened or none of it did. The picture cannot be inside that
 * transaction: an uploaded object lives at `SKY-xxxx/<hash>.webp`, so the
 * path needs the identity the create is in the middle of issuing.
 *
 * What it does instead is tell the truth about the middle state. If the row
 * lands and the upload does not, the figure EXISTS — with its own SKY-ID,
 * spent and unreissuable — and the dialog says so, offers to close, and never
 * calls create again. A second create on a failed upload would be a second
 * identity for one figure, which is the one mistake this design prevents.
 *
 * HIDDEN BY DEFAULT
 *
 * A new figure is a draft until somebody publishes it from the editor.
 *
 * WHAT IS NOT IN THIS DIALOG
 *
 * The SKY-ID and the slug (the database issues both), the market price (the
 * legacy path, ADR-0007), `image_file` (the import's, ADR-0009), and any
 * curated character field — curation stays in data/characters/characters.json
 * and is not something a form gets to guess at (ADR-0034).
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
import { TypeBadge } from "@/components/catalog/edition-banner";
import { CARD_TYPES, CARD_TYPE_LABELS } from "@/lib/catalog/card-type";
import { TYPE_LABELS } from "@/lib/catalog/catalog-type";
import {
  EMPTY_DRAFT,
  VARIANT_TYPES,
  baseCandidates,
  categoriesFor,
  fromTemplate,
  groupOf,
  inheritsCharacter,
  isCreatable,
  isVariantTypeValue,
  nameConfirmed,
  problemsWith,
  similarFigures,
  slugPreview,
  withBase,
  withSeries,
  withVariantType,
  type CategoryOption,
  type DraftProblem,
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

/** A label, its control, and the error that belongs to exactly this field. */
function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <span id={`${htmlFor}-error`} role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}

const FIELD =
  "min-h-11 w-full min-w-0 rounded-sky-md bg-surface px-3 py-2 text-sm ring-1 ring-border focus-ring";

/** The message for each problem `problemsWith()` can report. */
const PROBLEM_TEXT: Record<DraftProblem, string> = {
  name: de.admin.createNameRequired,
  series: de.admin.createSeriesRequired,
  category: de.admin.createCategoryRequired,
  variantType: de.admin.variantTypeRequired,
};

export function AddFigureModal({
  open,
  onClose,
  series,
  categories,
  variantCreation = false,
  figures,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  series: readonly SeriesOption[];
  categories: readonly CategoryOption[];
  /**
   * May „Variante von" be chosen here? (CAT-20) Only where `0166` exists —
   * Staging. Elsewhere the field stays „eigenständig" and says why; the
   * server refuses a variant regardless.
   */
  variantCreation?: boolean;
  /** The catalogue already on screen — the base and template pickers and the
      duplicate warning all read it, so none of them costs a request. */
  figures: readonly CatalogFigure[];
  /** Told the new identity so the catalogue can refresh and confirm it. */
  onCreated: (skyId: string) => void;
}) {
  const uid = useId();
  const headingId = `${uid}-heading`;
  const ids = {
    base: `${uid}-base`,
    baseList: `${uid}-base-list`,
    name: `${uid}-name`,
    variantType: `${uid}-variant-type`,
    series: `${uid}-series`,
    category: `${uid}-category`,
    cardType: `${uid}-card-type`,
    override: `${uid}-override`,
    note: `${uid}-note`,
    template: `${uid}-template`,
  };

  const [start, setStart] = useState<Start>("empty");
  const [templateSkyId, setTemplateSkyId] = useState<string | null>(null);
  const [templateQuery, setTemplateQuery] = useState("");
  const [draft, setDraft] = useState<NewFigureDraft>(EMPTY_DRAFT);
  const [phase, setPhase] = useState<Phase>({ kind: "editing" });
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  /* Field errors appear after the first attempt, not while typing. */
  const [showErrors, setShowErrors] = useState(false);

  /* The base picker: closed shows the choice, open shows a search list. */
  const [picking, setPicking] = useState(false);
  const [baseQuery, setBaseQuery] = useState("");
  const [active, setActive] = useState(0);

  const fileInput = useRef<HTMLInputElement>(null);
  const baseButton = useRef<HTMLButtonElement>(null);
  /* Guards the one thing a double click could do: issue a second SKY-ID. */
  const inFlight = useRef(false);
  /*
   * THE CREATE IS DISPATCHED IN A TRANSITION, AND THAT IS NOT DECORATION.
   *
   * Next applies a mutation's revalidated RSC payload to the mounted tree
   * only when the Server Action was called inside one. Called from a bare
   * `onClick`, the action still runs and still writes, and the browser keeps
   * the catalogue it was rendered with: the new figure exists and is nowhere
   * to be seen.
   */
  const [, startTransition] = useTransition();

  const template = useMemo(
    () => figures.find((figure) => figure.skyId === templateSkyId) ?? null,
    [figures, templateSkyId],
  );
  const base = useMemo(
    () => figures.find((figure) => figure.skyId === draft.baseSkyId) ?? null,
    [figures, draft.baseSkyId],
  );

  const set = <K extends keyof NewFigureDraft>(key: K, value: NewFigureDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const available = categoriesFor(categories, draft.seriesCode);
  const group = groupOf(categories, draft.categoryId);
  const slug = slugPreview(draft);

  /* The whole catalogue behind a search box: deferred, like the catalogue's own. */
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

  const deferredBaseQuery = useDeferredValue(baseQuery);
  const baseMatches = useMemo(
    () => baseCandidates(figures, deferredBaseQuery, 6),
    [figures, deferredBaseQuery],
  );
  /* Option 0 is always „Keine – eigenständige Figur". */
  const options: (CatalogFigure | null)[] = [null, ...baseMatches];

  const similar = useMemo(() => similarFigures(draft, figures), [draft, figures]);

  const confirmed = nameConfirmed(draft, template?.name ?? null);
  const ready = isCreatable(draft, categories) && confirmed;
  const busy = phase.kind === "working";
  const problems = showErrors ? problemsWith(draft, categories) : [];
  const problemFor = (problem: DraftProblem) =>
    problems.includes(problem) ? PROBLEM_TEXT[problem] : null;

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
    setDraft((current) => ({ ...EMPTY_DRAFT, name: current.name }));
  }

  function openPicker() {
    setBaseQuery("");
    setActive(0);
    setPicking(true);
  }

  function closePicker() {
    setPicking(false);
    /* Back to the control that opened it, so keyboard users are not lost. */
    window.requestAnimationFrame(() => baseButton.current?.focus());
  }

  function chooseBase(figure: CatalogFigure | null) {
    setDraft((current) => withBase(current, figure));
    if (figure !== null) {
      /* A base and a template at once would be two sources for one thing. */
      setStart("empty");
      setTemplateSkyId(null);
    }
    closePicker();
  }

  function onBaseKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      chooseBase(options[active] ?? null);
    } else if (event.key === "Escape") {
      /* Closes the list, not the dialog — see `Modal`. */
      event.preventDefault();
      event.nativeEvent.stopImmediatePropagation();
      closePicker();
    }
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

  /** Field errors on, and the first field with one gets the focus. */
  function revealProblems() {
    setShowErrors(true);
    const first = problemsWith(draft, categories)[0];
    const target =
      first === "name" || !confirmed ? ids.name
      : first === "variantType" ? ids.variantType
      : first === "series" ? ids.series
      : ids.category;
    window.requestAnimationFrame(() => document.getElementById(target)?.focus());
  }

  /**
   * PHASE A, then PHASE B. Never A twice.
   *
   * `inFlight` and the `partial` phase between them mean the create call has
   * exactly one chance to run per dialog: once a SKY-ID exists, every path
   * out of here either closes or hands over to the editor.
   */
  async function submit() {
    if (!ready) {
      revealProblems();
      return;
    }
    if (inFlight.current) return;
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
      templateSkyId: draft.baseSkyId === null ? draft.templateSkyId : null,
      baseSkyId: draft.baseSkyId,
      variantType: draft.variantType,
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

  const previewName = draft.name.trim() === "" ? "—" : draft.name.trim();

  return (
    <Modal open onClose={requestClose} labelledBy={headingId} size="lg">
      {/* The V3.8a structure, unchanged: head, one scrolling body, foot —
          straight into the panel, no wrapper, no height of its own. */}
      <header className="flex shrink-0 items-start gap-3 border-b border-border/60 px-4 py-3">
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

      <div className="min-h-0 overflow-y-auto overscroll-contain p-4 pb-5">
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
          <div className="flex flex-col gap-3">
            {/* ---- 1. Variante von — a choice, then a search list. */}
            <div className="flex min-w-0 flex-col gap-1">
              <span id={`${ids.base}-label`} className="text-xs text-muted">
                {de.admin.variantOf}
              </span>
              {!variantCreation ? (
                <>
                  <span id={ids.base} className={FIELD + " flex items-center text-muted"}>
                    {de.admin.variantNone}
                  </span>
                  <span className="text-[11px] text-muted">{de.admin.variantCreateStagingOnly}</span>
                </>
              ) : picking ? (
                <div className="flex flex-col gap-1">
                  <input
                    id={ids.base}
                    type="search"
                    role="combobox"
                    aria-expanded="true"
                    aria-controls={ids.baseList}
                    aria-labelledby={`${ids.base}-label`}
                    aria-activedescendant={`${ids.baseList}-${active}`}
                    autoFocus
                    value={baseQuery}
                    onChange={(event) => {
                      setBaseQuery(event.target.value);
                      setActive(0);
                    }}
                    onKeyDown={onBaseKey}
                    placeholder={de.admin.variantSearch}
                    className={FIELD}
                  />
                  <ul
                    id={ids.baseList}
                    role="listbox"
                    aria-labelledby={`${ids.base}-label`}
                    className="flex flex-col rounded-sky-md bg-surface ring-1 ring-border"
                  >
                    {options.map((figure, index) => (
                      <li
                        key={figure?.skyId ?? "none"}
                        id={`${ids.baseList}-${index}`}
                        role="option"
                        aria-selected={index === active}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => chooseBase(figure)}
                        onMouseEnter={() => setActive(index)}
                        className={
                          "flex min-h-10 cursor-pointer items-center gap-2 px-3 text-sm " +
                          (index === active ? "bg-white/10" : "")
                        }
                      >
                        {figure === null ? (
                          <span className="text-muted">{de.admin.variantNone}</span>
                        ) : (
                          <>
                            <span className="min-w-0 flex-1 truncate">{figure.displayName}</span>
                            <span className="shrink-0 text-xs text-muted">{figure.seriesLabel}</span>
                            <span className="shrink-0 font-mono text-xs text-muted">{figure.skyId}</span>
                          </>
                        )}
                      </li>
                    ))}
                    {baseQuery.trim() !== "" && baseMatches.length === 0 ? (
                      <li role="presentation" className="px-3 py-2 text-xs text-muted">
                        {de.admin.variantNoMatch}
                      </li>
                    ) : null}
                  </ul>
                </div>
              ) : (
                <button
                  ref={baseButton}
                  id={ids.base}
                  type="button"
                  aria-haspopup="listbox"
                  aria-labelledby={`${ids.base}-label ${ids.base}`}
                  onClick={openPicker}
                  className={FIELD + " flex items-center gap-2 text-left"}
                >
                  {base === null ? (
                    <span className="min-w-0 flex-1 truncate">{de.admin.variantNone}</span>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate">{base.displayName}</span>
                      <span className="shrink-0 font-mono text-xs text-muted">{base.skyId}</span>
                    </>
                  )}
                  <span aria-hidden="true" className="shrink-0 text-xs text-muted">▾</span>
                </button>
              )}
            </div>

            {/* ---- 2. Name */}
            <Field label={de.admin.createName} htmlFor={ids.name}
              error={problemFor("name") ?? (confirmed ? null : de.admin.templateNameUnchanged)}>
              <input
                id={ids.name}
                type="text"
                value={draft.name}
                onChange={(event) => set("name", event.target.value)}
                maxLength={200}
                aria-invalid={problemFor("name") !== null || !confirmed || undefined}
                aria-describedby={problemFor("name") !== null || !confirmed ? `${ids.name}-error` : undefined}
                className={FIELD}
              />
            </Field>

            {/* ---- 3. + 4. Varianten-Typ (only with a base) and Serie */}
            <div className={"grid gap-3 " + (base !== null ? "sm:grid-cols-2" : "")}>
              {base !== null ? (
                <Field label={de.admin.variantType} htmlFor={ids.variantType}
                  error={problemFor("variantType")}>
                  <select
                    id={ids.variantType}
                    value={draft.variantType ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDraft((current) =>
                        withVariantType(current, isVariantTypeValue(value) ? value : null));
                    }}
                    aria-invalid={problemFor("variantType") !== null || undefined}
                    className={FIELD}
                  >
                    <option value="">{de.admin.variantTypeChoose}</option>
                    {VARIANT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}

              <Field label={de.admin.createSeries} htmlFor={ids.series} error={problemFor("series")}>
                <select
                  id={ids.series}
                  value={draft.seriesCode}
                  onChange={(event) => setDraft((current) => withSeries(current, event.target.value))}
                  /* A variant belongs to its base's series (`0159`). */
                  disabled={draft.baseSkyId !== null}
                  className={FIELD + " disabled:opacity-60"}
                >
                  <option value="">—</option>
                  {series.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {/* ---- 5. Kategorie and Kartenkunst */}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={de.admin.createCategory} htmlFor={ids.category} error={problemFor("category")}>
                <select
                  id={ids.category}
                  value={draft.categoryId ?? ""}
                  onChange={(event) =>
                    set("categoryId", event.target.value === "" ? null : Number(event.target.value))
                  }
                  disabled={draft.seriesCode === ""}
                  aria-invalid={problemFor("category") !== null || undefined}
                  className={FIELD + " disabled:opacity-60"}
                >
                  <option value="">—</option>
                  {available.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={de.admin.cardType} htmlFor={ids.cardType}>
                <select
                  id={ids.cardType}
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
              </Field>
            </div>

            {/* ---- 6. Weitere Optionen, closed by default */}
            <details className="group rounded-sky-md ring-1 ring-border/60">
              <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sky-md px-3 text-sm">
                <span aria-hidden="true" className="text-xs text-muted transition-transform group-open:rotate-90">▸</span>
                {de.admin.moreOptions}
              </summary>

              <div className="flex flex-col gap-3 border-t border-border/60 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={de.admin.overrideLabel} htmlFor={ids.override}>
                    <input
                      id={ids.override}
                      type="text"
                      value={draft.displayNameOverride}
                      onChange={(event) => set("displayNameOverride", event.target.value)}
                      maxLength={120}
                      className={FIELD}
                    />
                  </Field>

                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-xs text-muted">{de.admin.image}</span>
                    <input
                      ref={fileInput}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      tabIndex={-1}
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
                      className={ACTION_NEUTRAL + " truncate"}
                    >
                      {file === null ? de.admin.imageReplace : file.name}
                    </button>
                    {imageError !== null ? (
                      <p role="alert" className="text-xs text-danger">
                        {imageError}
                      </p>
                    ) : null}
                  </div>
                </div>

                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={draft.catalogVisible}
                    onChange={(event) => set("catalogVisible", event.target.checked)}
                    className="h-5 w-5 accent-[#3b2a17] focus-ring"
                  />
                  <span className="text-sm">{de.admin.createVisibleLabel}</span>
                </label>
                <p className="-mt-2 text-xs text-muted">{de.admin.createVisibleHint}</p>

                <Field label={de.admin.note} htmlFor={ids.note}>
                  <textarea
                    id={ids.note}
                    value={draft.adminNote}
                    onChange={(event) => set("adminNote", event.target.value)}
                    maxLength={2000}
                    rows={2}
                    className="w-full rounded-sky-md bg-surface px-3 py-2 text-sm ring-1 ring-border focus-ring"
                  />
                </Field>

                {/*
                  * The template, for standalone figures only. With a base, the
                  * base is where the character comes from — two sources for one
                  * thing would be one too many.
                  */}
                {draft.baseSkyId === null ? (
                  <div className="flex flex-col gap-2">
                    <span className="text-xs text-muted">{de.admin.startHeading}</span>
                    <div className="flex flex-wrap gap-x-4">
                      {(["empty", "template"] as const).map((option) => (
                        <label key={option} className="flex min-h-11 items-center gap-2">
                          <input
                            type="radio"
                            name={`${uid}-start`}
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
                          {/* A template without a curated character hands over
                              nothing, and the operator has to know it (ADR-0070a). */}
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
                        <div className="flex flex-col gap-1">
                          <input
                            id={ids.template}
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
                              <ul className="flex flex-col">
                                {matches.map((figure) => (
                                  <li key={figure.skyId}>
                                    <button
                                      type="button"
                                      onClick={() => chooseTemplate(figure)}
                                      className="focus-ring flex min-h-10 w-full items-center gap-2 rounded-sky-md px-2 text-left text-sm hover:bg-white/5"
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
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                  <Derived
                    label={de.admin.group}
                    value={isCatalogGroup(group) ? groupLabel(group) : "—"}
                    hint={de.admin.groupDerived}
                  />
                  <Derived label={de.admin.elementLabel} value="—" hint={de.admin.elementDerived} />
                  <Derived
                    label={de.admin.slugLabel}
                    value={slug === "" ? "—" : slug}
                    hint={de.admin.slugPreviewHint}
                  />
                </div>
              </div>
            </details>

            {/* ---- 7. Vorschau — one line, the three things that matter. */}
            <div
              aria-label={de.admin.previewLabel}
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-sky-md bg-white/5 px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate font-medium">{previewName}</span>
              <TypeBadge type={draft.variantType} />
              <span className="text-xs text-muted">
                {base !== null ? de.admin.variantOfName(base.displayName) : de.admin.standaloneFigure}
              </span>
            </div>

            {/* A warning, never a refusal: the catalogue is full of names that
                legitimately repeat, so this reports and steps aside. */}
            {similar.length > 0 ? (
              <div role="note" className="flex flex-col gap-1 rounded-sky-md px-3 py-2 ring-1 ring-gold-line">
                <p className="text-xs font-medium">
                  {de.admin.similarTitle} — {de.admin.similarHint}
                </p>
                <ul className="flex flex-col gap-0.5 text-xs text-muted">
                  {similar.map((match) => (
                    <li key={match.skyId} className="truncate">
                      <span className="font-mono">{match.skyId}</span>{" "}
                      <span className="text-foreground">{match.displayName}</span>{" "}
                      {match.seriesLabel} · {CARD_TYPE_LABELS[match.cardType]}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <footer className="flex shrink-0 flex-col gap-2 border-t border-border/60 px-4 py-3">
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
              disabled={busy}
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
