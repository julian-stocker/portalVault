/**
 * „Ich habe diese Bestellung angesehen" — einmal, beim Öffnen (0099).
 *
 * WARUM HIER UND NICHT IM SERVER-RENDER. Das Markieren ist ein Schreibvorgang
 * samt `revalidatePath`, und beides gehört nicht in ein Rendern: eine Seite,
 * die beim Zeichnen schreibt, schreibt auch beim Vorausladen und beim
 * erneuten Zeichnen. Dieselbe Lösung wie beim Nachrichtenstrang, dessen
 * Effekt genauso aussieht — eine Zeile Client für einen Vorgang, der an einer
 * menschlichen Handlung hängt.
 *
 * EINMAL JE AUFRUF. `mark_order_attention_read()` ist idempotent und monoton,
 * aber ein Effekt, der bei jedem erneuten Zeichnen feuert, schriebe im
 * Sekundentakt. Das Ref hält ihn bei einem.
 *
 * KEINE ANZEIGE. Diese Komponente zeichnet nichts; sie ist die Handlung, die
 * zum Öffnen gehört, und nicht ihr Ergebnis.
 */
"use client";

import { useEffect, useRef } from "react";

import { markOrderAttentionRead } from "@/lib/attention/actions";

export function MarkOrderSeen({ orderNumber, unseen }: {
  orderNumber: string;
  /**
   * Ob überhaupt etwas ungesehen ist. Ohne das schriebe jedes Öffnen einer
   * längst gelesenen Bestellung einen neuen Wasserstand — richtig im
   * Ergebnis, aber eine Schreiboperation für nichts.
   */
  unseen: boolean;
}) {
  const marked = useRef(false);

  useEffect(() => {
    if (marked.current || !unseen) return;
    marked.current = true;
    void markOrderAttentionRead(orderNumber);
  }, [orderNumber, unseen]);

  return null;
}
