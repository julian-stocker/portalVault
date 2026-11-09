"use client";
/**
 * What every "Abgleichen" button of one session page needs to know: which
 * session, whether it is still open, and whether the apply is released
 * (`APPLY_RELEASED`, read on the server). Nothing is selected or stored here.
 */
import { createContext, useContext, type ReactNode } from "react";

import type { ResultView } from "@/lib/reconciliation/routes";

export type ReconcileState = {
  sessionId: number;
  /** The session can still be reconciled (`state = open`). */
  sessionOpen: boolean;
  /** False only with the emergency stop: "Abgleich bestätigen" stays locked, and the action refuses on its own. */
  applyReleased: boolean;
  /** The result filter the page shows — the way back from the Orderbuch keeps it. */
  view?: ResultView | null;
};

const ReconcileContext = createContext<ReconcileState | null>(null);

export function ReconcileProvider({ children, ...value }: ReconcileState & { children: ReactNode }) {
  return <ReconcileContext.Provider value={value}>{children}</ReconcileContext.Provider>;
}

/** Null outside a provider: a button then renders nothing. */
export function useReconcile(): ReconcileState | null {
  return useContext(ReconcileContext);
}
