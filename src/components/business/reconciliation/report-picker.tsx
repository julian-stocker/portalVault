/**
 * Choose ONE report file, see what it would send, and send only after a
 * confirmation (ADR-0174, phase 4 steps 3 and 4).
 *
 * ONE FILE PER RECONCILIATION (2026-11-08). The input takes a single file;
 * should more arrive at once they are refused with a sentence, never merged.
 * The preview shows platform, orders and period; the technical facts (chain,
 * positions, size, the file list) sit behind "Einzelheiten".
 *
 * THE FILES STAY ON THE DEVICE. They are read with `File.text()`, parsed,
 * merged and checked by `buildPreview` in this tab. Only after a SEPARATE,
 * confirmed step (step 4) does `analyseReconciliation` receive the checked
 * upload — `preview.upload`, nothing else. "Analyse starten" is enabled only
 * when nothing blocks; the dialog says what is sent and that no sale changes.
 *
 * ONE REQUEST AT A TIME. A ref guards the call before React has re-rendered,
 * so a double click cannot start a second analysis; while it runs, the
 * dialog cannot be closed and the selection cannot change.
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

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { Modal } from "@/components/ui/modal";
import { PendingButton, Spinner } from "@/components/ui/pending";
import { formatDate, formatNumber } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import { buildPreview, MAX_FILE_BYTES, MAX_PAYLOAD_BYTES, type Preview, type SelectedFile } from "@/lib/reconciliation/preview";
import { shownRefusal } from "@/lib/reconciliation/messages";
import { sessionHref } from "@/lib/reconciliation/routes";
import { analyseReconciliation } from "@/lib/reconciliation/server/actions";
import { sha256 } from "@/lib/reconciliation/sha256";
import type { ReportIssue } from "@/lib/reconciliation/types";

const copy = de.business.reconciliation;
const t = copy.picker;

type State =
  | { kind: "idle" }
  | { kind: "reading"; count: number }
  | { kind: "done"; preview: Preview }
  | { kind: "failed" }
  /** More than one file at once — one report per reconciliation (2026-11-08). */
  | { kind: "tooMany" };

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
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [done, setDone] = useState<string>("");
  const busy = useRef(false);
  const run = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  async function choose(list: FileList | null) {
    // A cancelled dialog: keep what is on screen. During an analysis nothing changes.
    if (!list || list.length === 0 || busy.current) return;
    setDone("");
    // One report per reconciliation: the input takes one file, and a second one is refused, not merged.
    if (list.length > 1) {
      run.current += 1;
      setState({ kind: "tooMany" });
      if (input.current) input.current.value = "";
      return;
    }
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
    if (busy.current) return;
    run.current += 1;
    setState({ kind: "idle" });
    setDone("");
    if (input.current) { input.current.value = ""; input.current.focus(); }
  }

  function openConfirm() {
    setSendError(null);
    setConfirming(true);
  }

  function closeConfirm() {
    // Not while the request runs: its answer has to land somewhere.
    if (!busy.current) setConfirming(false);
  }

  /** The one place that sends — only the checked upload, only once at a time. */
  async function analyse(preview: Preview) {
    if (busy.current || preview.upload === null) return;
    busy.current = true;
    setSending(true);
    setSendError(null);
    try {
      const result = await analyseReconciliation(preview.upload);
      if (!result.ok) {
        // Only a known fixed sentence reaches the screen (`ANALYSE_MESSAGES`).
        setSendError(shownRefusal(result.message, t.analyse.failed));
        return;
      }
      run.current += 1;
      setConfirming(false);
      setState({ kind: "idle" });
      setDone(t.analyse.done(result.sessionId));
      router.push(sessionHref(result.sessionId));
    } catch (error) {
      // A network failure or a refused body: no detail on screen, only a name in the log.
      console.error("analyse reconciliation:", error instanceof Error ? error.name : "unknown");
      setSendError(t.analyse.failed);
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  const status = state.kind === "reading" ? t.reading(state.count)
    : state.kind === "done" ? t.done(state.preview.files.length)
    : done;

  return (
    <section aria-labelledby="recon-picker" className="mt-6">
      <h2 id="recon-picker" className="text-base font-medium">{t.heading}</h2>
      <p className="mt-1 max-w-prose text-sm text-muted">{t.hint}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="recon-files" className="sr-only">{t.input}</label>
        <input
          ref={input} id="recon-files" type="file" accept=".csv,text/csv"
          aria-describedby="recon-picker-status"
          disabled={sending}
          onChange={(e) => void choose(e.currentTarget.files)}
          className={
            "focus-ring block min-h-11 w-full max-w-full rounded-sky-md text-sm text-muted sm:w-auto " +
            "file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-sky-md file:border-0 file:bg-surface " +
            "file:px-3 file:text-sm file:font-medium file:text-fg file:ring-1 file:ring-border/70"
          }
        />
        {state.kind === "done" || state.kind === "failed" || state.kind === "tooMany" ? (
          <button type="button" onClick={reset} disabled={sending}
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
      {state.kind === "tooMany" ? (
        <p role="alert" data-too-many="" className="mt-2 rounded-sky-md bg-surface px-3 py-2 text-sm text-danger ring-1 ring-border/70">{t.oneFile}</p>
      ) : null}

      {state.kind === "done" ? (
        <>
          <PreviewView preview={state.preview} />
          <div className="mt-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <button type="button" onClick={openConfirm}
                    disabled={state.preview.upload === null || sending}
                    aria-describedby={state.preview.upload === null ? "recon-start-blocked" : undefined}
                    className={`${ACTION_PRIMARY} disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto`}>
              {t.analyse.start}
            </button>
            {state.preview.upload === null ? (
              <p id="recon-start-blocked" className="text-xs text-muted">{t.blockedStart}</p>
            ) : null}
          </div>
          <ConfirmAnalysis
            open={confirming} preview={state.preview} sending={sending} error={sendError}
            onCancel={closeConfirm} onConfirm={() => void analyse(state.preview)}
          />
        </>
      ) : null}
    </section>
  );
}

function periodOf(p: Preview): string {
  if (!p.firstSoldOn || !p.lastSoldOn) return "–";
  const days = p.periodDays !== null ? ` (${t.summary.days(p.periodDays + 1)})` : "";
  return `${formatDate(p.firstSoldOn)} – ${formatDate(p.lastSoldOn)}${days}`;
}

/** What will be sent — the numbers of the preview, nothing new. */
export function ConfirmAnalysis({ open, preview: p, sending, error, onCancel, onConfirm }: {
  open: boolean;
  preview: Preview;
  sending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const s = t.summary;
  const a = t.analyse;
  return (
    <Modal open={open} onClose={onCancel} labelledBy="recon-confirm-title">
      <div className="p-5">
        <h2 id="recon-confirm-title" className="text-lg font-semibold">{a.dialogTitle}</h2>
        <p className="mt-1 text-sm text-muted">{a.dialogIntro}</p>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
          <Fact label={s.platform}>{p.parser ? (t.platforms[p.parser] ?? p.parser) : t.unknownPlatform}</Fact>
          <Fact label={a.sentFiles}>{formatNumber(p.upload?.files.length ?? 0)}</Fact>
          <Fact label={s.orders}>{formatNumber(p.orders)}</Fact>
          <Fact label={s.size}>{s.sizeOf(kib(p.payloadBytes), kib(MAX_PAYLOAD_BYTES))}</Fact>
          <div className="col-span-2"><Fact label={s.period}>{periodOf(p)}</Fact></div>
        </dl>
        <p className="mt-4 text-sm">{a.note}</p>
        {error ? (
          <p role="alert" className="mt-3 rounded-sky-md bg-surface px-3 py-2 text-sm text-danger ring-1 ring-border/70">{error}</p>
        ) : null}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={sending} className={`${ACTION_NEUTRAL} sm:w-auto`}>
            {a.cancel}
          </button>
          <PendingButton type="button" onClick={onConfirm} pending={sending} pendingLabel={a.running}
                         disabled={p.upload === null}
                         className={`${ACTION_PRIMARY} gap-2 sm:w-auto`}>
            {a.confirm}
          </PendingButton>
        </div>
      </div>
    </Modal>
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
  const period = periodOf(p);

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

      {/* What matters first: which report, how many orders, which period. */}
      <div>
        <h3 className="text-sm font-medium">{s.heading}</h3>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <Fact label={s.platform}>{p.parser ? (t.platforms[p.parser] ?? p.parser) : t.unknownPlatform}</Fact>
          <Fact label={s.orders}>{formatNumber(p.orders)}</Fact>
          <div className="col-span-2 sm:col-span-1"><Fact label={s.period}>{period}</Fact></div>
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

      {/* The technical facts stay available, but folded away. */}
      <details data-picker-details="">
        <summary className="focus-ring -mx-1 inline-flex min-h-11 cursor-pointer items-center rounded-sky-md px-1 text-sm underline underline-offset-2 sm:min-h-8">
          {t.moreDetails}
        </summary>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          <Fact label={s.files}>{formatNumber(p.files.length)}</Fact>
          <Fact label={s.positions}>{formatNumber(p.positions)}</Fact>
          <Fact label={s.pieces}>{formatNumber(p.pieces)}</Fact>
          <Fact label={s.chain}>
            {p.chainComplete === null ? "–" : p.chainComplete ? s.chainComplete : s.chainGaps(p.chainGaps)}
          </Fact>
          <div className="col-span-2 sm:col-span-4">
            <Fact label={s.size}>{s.sizeOf(kib(p.payloadBytes), kib(MAX_PAYLOAD_BYTES))}</Fact>
          </div>
        </dl>
      <div className="mt-3">
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
      </details>

      {p.blockers.length === 0 ? <p className="text-sm">{t.ready}</p> : null}
    </div>
  );
}
