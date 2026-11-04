/**
 * Choose report files and see what they would send — nothing is sent
 * (ADR-0174, phase 4 step 3).
 *
 * THE FILES STAY ON THE DEVICE. They are read with `File.text()`, parsed,
 * merged and checked by `buildPreview` in this tab. No server action is
 * imported here, and there is no button that pretends to send: the analysis
 * is step 4 and will be a separate, confirmed action.
 *
 * WHAT CAN GO WRONG WHILE CHOOSING, AND WHAT HAPPENS
 *
 *   the dialog is cancelled     nothing changes — an earlier preview stays
 *   the same files again        the input is emptied after every read, so
 *                               choosing the same files fires again
 *   a new choice while reading  the older run is dropped (`run` counter)
 *   a file is too large         it is not read at all (`MAX_FILE_BYTES`)
 *   a file cannot be read       it is listed as unreadable; nothing else stops
 *   reading takes a moment      a status line says so, and the work yields
 *                               to the browser between files
 *
 * ACCESSIBILITY. A native file input (keyboard and screen reader for free,
 * 44 px). One live region that is always in the document says what is
 * happening; reasons that stop the selection are an alert.
 */
"use client";

import { useRef, useState } from "react";

import { Spinner } from "@/components/ui/pending";
import { formatDate, formatNumber } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import { buildPreview, MAX_FILE_BYTES, MAX_PAYLOAD_BYTES, type Preview, type SelectedFile } from "@/lib/reconciliation/preview";
import { sha256 } from "@/lib/reconciliation/sha256";
import type { ReportIssue } from "@/lib/reconciliation/types";

const copy = de.business.reconciliation;
const t = copy.picker;

type State =
  | { kind: "idle" }
  | { kind: "reading"; count: number }
  | { kind: "done"; preview: Preview }
  | { kind: "failed" };

const kib = (bytes: number) => `${formatNumber(Math.ceil(bytes / 1024))} KiB`;
const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Read every chosen file; one that cannot be read becomes `text: null`. */
export async function readFiles(list: readonly File[]): Promise<SelectedFile[]> {
  const out: SelectedFile[] = [];
  for (const file of list) {
    let text: string | null = null;
    if (file.size <= MAX_FILE_BYTES) {
      try {
        text = await file.text();
      } catch {
        text = null;
      }
    }
    out.push({ name: file.name, size: file.size, text });
    await yieldToBrowser();
  }
  return out;
}

export function ReportPicker() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const run = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  async function choose(list: FileList | null) {
    // A cancelled dialog: keep what is on screen.
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    const mine = ++run.current;
    setState({ kind: "reading", count: files.length });
    try {
      await yieldToBrowser();
      const selected = await readFiles(files);
      const preview = await buildPreview(selected, (text) => sha256(text));
      if (mine === run.current) setState({ kind: "done", preview });
    } catch (error) {
      console.error("report preview:", error instanceof Error ? error.name : "unknown");
      if (mine === run.current) setState({ kind: "failed" });
    } finally {
      // The same files may be chosen again and must fire `change` again.
      if (input.current) input.current.value = "";
    }
  }

  function reset() {
    run.current += 1;
    setState({ kind: "idle" });
    if (input.current) { input.current.value = ""; input.current.focus(); }
  }

  const status = state.kind === "reading" ? t.reading(state.count)
    : state.kind === "done" ? t.done(state.preview.files.length)
    : "";

  return (
    <section aria-labelledby="recon-picker" className="mt-6">
      <h2 id="recon-picker" className="text-base font-medium">{t.heading}</h2>
      <p className="mt-1 max-w-prose text-sm text-muted">{t.hint}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="recon-files" className="sr-only">{t.input}</label>
        <input
          ref={input} id="recon-files" type="file" multiple accept=".csv,text/csv"
          aria-describedby="recon-picker-status"
          onChange={(e) => void choose(e.currentTarget.files)}
          className={
            "focus-ring block min-h-11 w-full max-w-full rounded-sky-md text-sm text-muted sm:w-auto " +
            "file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-sky-md file:border-0 file:bg-surface " +
            "file:px-3 file:text-sm file:font-medium file:text-fg file:ring-1 file:ring-border/70"
          }
        />
        {state.kind === "done" || state.kind === "failed" ? (
          <button type="button" onClick={reset}
                  className="focus-ring min-h-11 rounded-sky-md px-3 text-sm text-muted underline underline-offset-2 hover:text-fg sm:min-h-8">
            {t.reset}
          </button>
        ) : null}
      </div>

      <p id="recon-picker-status" role="status" aria-live="polite" className="mt-2 flex min-h-5 items-center gap-2 text-sm text-muted">
        {state.kind === "reading" ? <Spinner /> : null}
        {status}
      </p>

      {state.kind === "failed" ? (
        <p role="alert" className="mt-2 rounded-sky-md bg-surface px-3 py-2 text-sm text-danger ring-1 ring-border/70">{t.failed}</p>
      ) : null}

      {state.kind === "done" ? <PreviewView preview={state.preview} /> : null}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm tabular-nums">{children}</dd>
    </div>
  );
}

export function PreviewView({ preview: p }: { preview: Preview }) {
  const s = t.summary;
  const period = p.firstSoldOn && p.lastSoldOn
    ? `${formatDate(p.firstSoldOn)} – ${formatDate(p.lastSoldOn)}${p.periodDays !== null ? ` (${s.days(p.periodDays + 1)})` : ""}`
    : "–";

  return (
    <div className="mt-4 flex flex-col gap-4">
      {p.blockers.length > 0 ? (
        <div role="alert" className="rounded-sky-md bg-surface px-3 py-2 ring-1 ring-border/70">
          <h3 className="text-sm font-medium text-danger">{t.blockersHeading}</h3>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {p.blockers.map((b) => <li key={b}>{t.blockers[b]}</li>)}
          </ul>
        </div>
      ) : null}

      <div>
        <h3 className="text-sm font-medium">{s.heading}</h3>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          <Fact label={s.files}>{formatNumber(p.files.length)}</Fact>
          <Fact label={s.platform}>{p.parser ? (t.platforms[p.parser] ?? p.parser) : t.unknownPlatform}</Fact>
          <Fact label={s.orders}>{formatNumber(p.orders)}</Fact>
          <Fact label={s.positions}>{formatNumber(p.positions)}</Fact>
          <Fact label={s.pieces}>{formatNumber(p.pieces)}</Fact>
          <div className="col-span-2"><Fact label={s.period}>{period}</Fact></div>
          <Fact label={s.chain}>
            {p.chainComplete === null ? "–" : p.chainComplete ? s.chainComplete : s.chainGaps(p.chainGaps)}
          </Fact>
          <div className="col-span-2 sm:col-span-4">
            <Fact label={s.size}>{s.sizeOf(kib(p.payloadBytes), kib(MAX_PAYLOAD_BYTES))}</Fact>
          </div>
        </dl>
      </div>

      {p.warnings.length > 0 ? (
        <div>
          <h3 className="text-sm font-medium">{t.warningsHeading}</h3>
          <ul className="mt-1 list-disc pl-5 text-sm text-muted">
            {p.warnings.map((w) => <li key={w}>{t.warnings[w]}</li>)}
          </ul>
        </div>
      ) : null}

      <div>
        <h3 className="text-sm font-medium">{t.fileList}</h3>
        <ul className="mt-2 flex flex-col gap-2">
          {p.files.map((f, i) => (
            <li key={`${i}-${f.name}`} className="rounded-sky-md bg-surface/60 px-3 py-2 text-sm ring-1 ring-border/70">
              <p className="font-medium break-all">{f.name}</p>
              {f.kind === "failed" ? (
                <p className="text-danger">{t.fileFailures[f.failure]}</p>
              ) : (
                <>
                  <p className="text-muted tabular-nums">
                    {t.file.orders(f.orders)}
                    {f.firstSoldOn ? ` · ${formatDate(f.firstSoldOn)} – ${formatDate(f.lastSoldOn)}` : ""}
                    {f.footerMatches === false && f.footerCount !== null ? ` · ${t.file.footer(f.footerCount)}` : ""}
                  </p>
                  {f.duplicateOf ? <p className="text-muted">{t.file.duplicateOf(f.duplicateOf)}</p> : null}
                  {Object.keys(f.issues).length > 0 ? (
                    <ul className="mt-1 text-xs text-muted">
                      {(Object.entries(f.issues) as [ReportIssue["code"], number][]).map(([code, n]) => (
                        <li key={code}>{copy.reportIssues[code]} ({t.file.issue(n)})</li>
                      ))}
                    </ul>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      </div>

      {p.blockers.length === 0 ? (
        <p className="text-sm">
          {t.ready} <span className="text-muted">{t.notYet}</span>
        </p>
      ) : null}
    </div>
  );
}
