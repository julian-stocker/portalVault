"use client";
/**
 * Close an open session (`closeReconciliation`, 0172) — the step between
 * taking over order numbers and the new analysis that pairs those sales by
 * number. An open session with exactly these files would otherwise be
 * returned again by `seller_recon_create`. Closing changes no sale.
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { Modal } from "@/components/ui/modal";
import { PendingButton } from "@/components/ui/pending";
import { de } from "@/lib/i18n/de";
import { shownActionRefusal } from "@/lib/reconciliation/messages";
import { closeReconciliation } from "@/lib/reconciliation/server/actions";

const t = de.business.reconciliation.reconcile.close;

export function CloseSession({ sessionId }: { sessionId: number }) {
  const router = useRouter();
  const busy = useRef(false);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function close() {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    setError(null);
    try {
      const result = await closeReconciliation(sessionId);
      if (!result.ok) { setError(shownActionRefusal(result.message, t.failed)); return; }
      setOpen(false);
      router.refresh();
    } catch (e) {
      console.error("close reconciliation:", e instanceof Error ? e.name : "unknown");
      setError(t.failed);
    } finally {
      busy.current = false;
      setRunning(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${ACTION_NEUTRAL} mt-3 sm:w-auto`}>{t.button}</button>
      <Modal open={open} onClose={() => { if (!busy.current) setOpen(false); }} labelledBy="recon-close-title" role="alertdialog">
        <div className="p-5">
          <h2 id="recon-close-title" className="text-lg font-semibold">{t.title}</h2>
          <p className="mt-1 text-sm">{t.body}</p>
          {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setOpen(false)} disabled={running} className={`${ACTION_NEUTRAL} sm:w-auto`}>
              {t.cancel}
            </button>
            <PendingButton type="button" pending={running} pendingLabel={t.running} onClick={() => void close()}
                           className={`${ACTION_PRIMARY} gap-2 sm:w-auto`}>
              {t.confirm}
            </PendingButton>
          </div>
        </div>
      </Modal>
    </>
  );
}
