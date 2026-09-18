/**
 * Reconciling the shop's stock against the owner's spreadsheet (ADR-0087).
 *
 * THE FILE DOES NOT GO ANYWHERE. It is 450 MB, 449 MB of which are the in-cell
 * pictures the owner needs for local stock-taking. This component reads roughly
 * 0.75 MB of it — the ZIP directory at the end, the six worksheets and the
 * shared strings near the beginning — and sends the extracted rows. Nothing is
 * uploaded, so there is no body limit to route around, no private bucket to
 * expire and nothing to clean up afterwards.
 *
 * A CLIENT COMPONENT BECAUSE THE FILE IS HERE. `File.slice()` is the whole
 * trick: it returns a view rather than a copy, so reading the last 64 KB of a
 * 450 MB file costs 64 KB. That is what lets this run on a phone.
 *
 * THE SPREADSHEET IS THE TRUTH ABOUT PHYSICAL STOCK. `Storage` is an absolute
 * target: the owner uploads the file to make SkyIsles agree with the shelf. So
 * the preview shows the resulting quantity, not just an arithmetic change — the
 * change is how the ledger gets there, and the target is what he decided.
 *
 * TWO SCREENS, NEVER ONE. Reading and proposing is one act; changing stock is
 * another, on a separate confirmation with every line visible. A synchronisation
 * can remove stock — if the sheet says 0 and the shop holds 3, the result is 0 —
 * and that direction is never taken without being shown first.
 */
"use client";

import { useMemo, useState, useTransition } from "react";

import { ACTION_PRIMARY } from "@/components/ui/action";
import {
  applyImport,
  createImportPreview,
  loadBaseline,
  type PreviewRow,
} from "@/lib/admin/import-actions";
import {
  IMPORT_CONDITION,
  SUPPORTED_SHEETS,
  classifyRow,
  normaliseName,
  reconcile,
  type Baseline,
  type CatalogEntry,
  type SavedMapping,
} from "@/lib/import/classify";
import { missingCapabilities } from "@/lib/import/capabilities";
import { fingerprint } from "@/lib/import/fingerprint";
import { parseSharedStrings, parseSheet } from "@/lib/import/sheet-rows";
import { XlsxReadError, readWorkbookParts, workbookModifiedAt } from "@/lib/import/xlsx-reader";
import { de } from "@/lib/i18n/de";

type Phase = "idle" | "reading" | "analysing" | "preview" | "applying" | "done";

type Prepared = {
  rows: PreviewRow[];
  fileName: string;
  fileSize: number;
  bytesRead: number;
  modifiedAt: string | null;
  sheets: string[];
};

const PANEL = "rounded-sky-lg bg-surface/80 p-5 ring-1 ring-border/70";

export function InventoryImport({
  catalog,
  mappings,
}: {
  catalog: CatalogEntry[];
  /** Serialised for the client boundary; a Map cannot cross it. */
  mappings: Record<string, SavedMapping>;
}) {
  const copy = de.business.imports;
  const [phase, setPhase] = useState<Phase>("idle");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [importId, setImportId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // The catalog, indexed once: series → exact name → entries, and by SKY-ID.
  const index = useMemo(() => {
    const bySeries = new Map<string, Map<string, CatalogEntry[]>>();
    const byId = new Map<string, CatalogEntry>();
    for (const entry of catalog) {
      byId.set(entry.skyId, entry);
      let forSeries = bySeries.get(entry.series);
      if (!forSeries) {
        forSeries = new Map();
        bySeries.set(entry.series, forSeries);
      }
      forSeries.set(entry.name, [...(forSeries.get(entry.name) ?? []), entry]);
    }
    return { bySeries, byId };
  }, [catalog]);

  const savedMappings = useMemo(() => new Map(Object.entries(mappings)), [mappings]);

  async function handleFile(file: File) {
    setError(null);
    setResult(null);

    /*
     * Before the file is touched (ADR-0087).
     *
     * A browser without `DecompressionStream("deflate-raw")` cannot inflate a
     * worksheet, and finding that out mid-parse produced "Die Datei konnte
     * nicht gelesen werden" — true, useless, and indistinguishable from a
     * corrupt file. Nothing is read, nothing is classified and no import batch
     * exists when this returns.
     */
    const missing = missingCapabilities();
    if (missing.length > 0) {
      setError(copy.unsupportedBrowser);
      setPhase("idle");
      return;
    }

    setPhase("reading");

    try {
      const parts = await readWorkbookParts(file, SUPPORTED_SHEETS);
      if (parts.sheets.size === 0) {
        setError(copy.noSheets);
        setPhase("idle");
        return;
      }

      setPhase("analysing");
      const shared = parseSharedStrings(parts.sharedStrings);
      const modifiedAt = workbookModifiedAt(parts.core);

      // ---- classify every row ------------------------------------------
      const classified: {
        sheet: string;
        sourceRow: number;
        name: string;
        storage: number | null;
        result: ReturnType<typeof classifyRow>;
      }[] = [];

      for (const sheet of SUPPORTED_SHEETS) {
        const xml = parts.sheets.get(sheet);
        if (!xml) continue;
        for (const row of parseSheet(sheet, xml, shared)) {
          classified.push({
            ...row,
            result: classifyRow({
              sheet: row.sheet,
              name: row.name,
              storage: row.storage,
              bySeriesName: index.bySeries.get(sheet) ?? new Map(),
              mappings: savedMappings,
              byId: index.byId,
            }),
          });
        }
      }

      // ---- ask the shop about the figures this workbook names ----------
      const skyIds = [
        ...new Set(
          classified
            .filter((c) => c.result.classification === "SUPPORTED_COMPLETE_LOOSE_FIGURE")
            .map((c) => c.result.skyId!),
        ),
      ];
      const baseline = await loadBaseline(skyIds);

      // ---- reconcile ---------------------------------------------------
      const rows: PreviewRow[] = classified.map((entry) => {
        const { result } = entry;
        const base: PreviewRow = {
          sheet: entry.sheet,
          source_row: entry.sourceRow,
          raw_name: entry.name,
          classification: result.classification,
          sky_id: result.skyId,
          condition: null,
          previous_quantity: null,
          desired_quantity: null,
          delta: null,
          status: "skipped",
          note: result.note,
        };

        if (result.classification !== "SUPPORTED_COMPLETE_LOOSE_FIGURE") {
          // An ignored row carries no delta at all — the database refuses one.
          return { ...base, sky_id: result.classification.startsWith("IGNORED") ? null : result.skyId };
        }

        const shop: Baseline = baseline[result.skyId!] ?? {
          quantity: 0,
          reserved: 0,
          lastMovementAt: null,
          lastImportDesired: null,
        };
        const decision = reconcile(result.desiredQuantity!, shop);

        return {
          ...base,
          condition: IMPORT_CONDITION,
          previous_quantity: shop.quantity,
          desired_quantity: result.desiredQuantity,
          delta: decision.delta,
          status: decision.status,
          note: decision.note,
        };
      });

      setPrepared({
        rows,
        fileName: file.name,
        fileSize: file.size,
        bytesRead: parts.bytesRead,
        modifiedAt,
        sheets: [...parts.sheets.keys()],
      });

      /*
       * What identifies this stock-take.
       *
       * Computed over the rows as read — sheet, name, Storage — and therefore
       * the same for a workbook that was merely re-saved, and different the
       * moment a count changes. It labels the import in the history; it never
       * stops one.
       */
      const contentFingerprint = await fingerprint(
        classified.map((entry) => ({
          sheet: entry.sheet,
          name: entry.name,
          storage: entry.storage,
        })),
      );

      const created = await createImportPreview({
        fileName: file.name,
        contentFingerprint,
        workbookModifiedAt: modifiedAt,
        sheets: [...parts.sheets.keys()],
        rows,
      });
      if (!created.ok) {
        setError(created.message);
        setPhase("idle");
        return;
      }
      setImportId(created.importId);
      setPhase("preview");
    } catch (cause) {
      setError(cause instanceof XlsxReadError ? cause.message : copy.readFailed);
      setPhase("idle");
    }
  }

  function confirm() {
    if (importId === null) return;
    setPhase("applying");
    startTransition(async () => {
      const applied = await applyImport(importId);
      if (applied.ok) {
        setResult(copy.appliedResult(applied.applied, applied.unchanged));
        setPhase("done");
      } else {
        setError(applied.message);
        setPhase("preview");
      }
    });
  }

  const counts = useMemo(() => summarise(prepared?.rows ?? []), [prepared]);

  return (
    <div className="flex flex-col gap-6">
      {phase === "idle" || phase === "reading" || phase === "analysing" ? (
        <section className={PANEL}>
          <p className="text-sm text-muted">{copy.hint}</p>
          <label className={`${ACTION_PRIMARY} mt-4 inline-flex w-fit cursor-pointer`}>
            {phase === "idle"
              ? copy.choose
              : phase === "reading"
                ? copy.reading
                : copy.analysing}
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              disabled={phase !== "idle"}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
          </label>
        </section>
      ) : null}

      {error === null ? null : (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}

      {prepared && phase !== "done" ? (
        <>
          <section className={PANEL}>
            <h2 className="text-sm font-semibold">{copy.summary}</h2>
            <p className="mt-1 text-xs text-muted">
              {copy.rowsSeen(prepared.rows.length)} ·{" "}
              {copy.readBytes(
                (prepared.bytesRead / 1e6).toFixed(2),
                (prepared.fileSize / 1e6).toFixed(0),
              )}
            </p>
            {prepared.modifiedAt ? (
              <p className="mt-1 text-xs text-muted">
                {copy.savedAt(new Date(prepared.modifiedAt).toLocaleString(de.locale))}
              </p>
            ) : null}

            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <Figure label={copy.increases} value={counts.increases} />
              <Figure label={copy.decreases} value={counts.decreases} tone="danger" />
              <Figure label={copy.unchanged} value={counts.unchanged} />
              <Figure label={copy.newPositions} value={counts.newPositions} />
              <Figure label={copy.conflicts} value={counts.conflicts} tone="danger" />
              <Figure label={copy.ignored} value={counts.ignored} />
            </dl>
          </section>

          {counts.conflicts > 0 ? (
            <Group
              heading={copy.conflictHeading}
              hint={copy.conflictHint}
              rows={prepared.rows.filter((r) => r.status === "conflict")}
              danger
            />
          ) : null}

          {counts.decreases > 0 ? (
            <Group
              heading={copy.decreaseHeading}
              hint={copy.decreaseHint}
              rows={prepared.rows.filter((r) => r.status === "pending" && (r.delta ?? 0) < 0)}
              danger
            />
          ) : null}

          {counts.increases > 0 ? (
            <Group
              heading={`${copy.increases} (${counts.increases})`}
              rows={prepared.rows.filter((r) => r.status === "pending" && (r.delta ?? 0) > 0)}
            />
          ) : null}

          <IgnoredSummary rows={prepared.rows} />

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={confirm}
              disabled={phase === "applying"}
              className={ACTION_PRIMARY}
            >
              {phase === "applying" ? copy.applying : copy.apply}
            </button>
            <button
              type="button"
              onClick={() => {
                setPrepared(null);
                setImportId(null);
                setPhase("idle");
              }}
              className="text-sm text-muted underline underline-offset-4 hover:text-foreground"
            >
              {copy.discard}
            </button>
          </div>
        </>
      ) : null}

      {phase === "done" && result ? (
        <section className={PANEL}>
          <p className="font-medium">{result}</p>
        </section>
      ) : null}
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "danger";
}) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd
        className={
          "text-lg font-semibold tabular-nums " +
          (tone === "danger" && value > 0 ? "text-danger" : "")
        }
      >
        {value}
      </dd>
    </div>
  );
}

function Group({
  heading,
  hint,
  rows,
  danger,
}: {
  heading: string;
  hint?: string;
  rows: PreviewRow[];
  danger?: boolean;
}) {
  const copy = de.business.imports;
  return (
    <section
      className={
        "rounded-sky-lg bg-surface/80 p-5 ring-1 " +
        (danger ? "ring-danger/60" : "ring-border/70")
      }
    >
      <h2 className={"text-sm font-semibold " + (danger ? "text-danger" : "")}>{heading}</h2>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/70 text-left text-xs text-muted">
              <th scope="col" className="py-1.5 pr-3 font-medium">{copy.name}</th>
              <th scope="col" className="py-1.5 pr-3 font-medium">{copy.sheet}</th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">{copy.current}</th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">{copy.desired}</th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">{copy.change}</th>
              <th scope="col" className="py-1.5 text-right font-medium">{copy.after}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.sheet}-${row.source_row}`} className="border-b border-border/40">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                  {row.raw_name}
                  {row.note ? (
                    <span className="block text-xs text-muted">{row.note}</span>
                  ) : null}
                </th>
                <td className="py-1.5 pr-3 text-xs text-muted">
                  {row.sheet} {copy.row} {row.source_row}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{row.previous_quantity}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{row.desired_quantity}</td>
                <td
                  className={
                    "py-1.5 pr-3 text-right tabular-nums " +
                    ((row.delta ?? 0) < 0 ? "text-danger" : "")
                  }
                >
                  {(row.delta ?? 0) > 0 ? `+${row.delta}` : row.delta}
                </td>
                {/* What the shelf will say afterwards — the number the owner
                    actually decided, rather than the arithmetic to reach it. */}
                <td className="py-1.5 text-right font-medium tabular-nums">
                  {row.status === "conflict" ? "—" : row.desired_quantity}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * The rows this importer is not responsible for, grouped by reason.
 *
 * Shown rather than hidden, and counted rather than listed: 39 games and 13
 * Swap Force halves are a fact about the workbook, not a problem, and the
 * owner should be able to see that they were left alone on purpose.
 */
function IgnoredSummary({ rows }: { rows: PreviewRow[] }) {
  const copy = de.business.imports;
  const byReason = new Map<string, number>();
  for (const row of rows) {
    if (row.classification === "SUPPORTED_COMPLETE_LOOSE_FIGURE") continue;
    byReason.set(row.classification, (byReason.get(row.classification) ?? 0) + 1);
  }
  if (byReason.size === 0) return null;

  return (
    <section className={PANEL}>
      <h2 className="text-sm font-semibold">{copy.ignored}</h2>
      <dl className="mt-3 flex flex-col gap-2 text-sm">
        {[...byReason].map(([reason, count]) => (
          <div key={reason}>
            <dt className="font-medium tabular-nums">
              {count} ×{" "}
              {reason === "UNMATCHED_RELEVANT" || reason === "AMBIGUOUS_RELEVANT"
                ? copy.unmatched
                : ""}
            </dt>
            <dd className="text-xs text-muted">
              {copy.ignoredWhy[reason as keyof typeof copy.ignoredWhy] ?? reason}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function summarise(rows: PreviewRow[]) {
  let increases = 0;
  let decreases = 0;
  let unchanged = 0;
  let conflicts = 0;
  let ignored = 0;
  let newPositions = 0;

  for (const row of rows) {
    if (row.classification !== "SUPPORTED_COMPLETE_LOOSE_FIGURE") {
      ignored += 1;
      continue;
    }
    if (row.status === "conflict") conflicts += 1;
    else if (row.status === "unchanged") unchanged += 1;
    else if ((row.delta ?? 0) > 0) {
      increases += 1;
      if (row.previous_quantity === 0) newPositions += 1;
    } else if ((row.delta ?? 0) < 0) decreases += 1;
  }

  return { increases, decreases, unchanged, conflicts, ignored, newPositions };
}

/** Exported for the tests; the component uses it through `useMemo`. */
export { summarise, normaliseName };
