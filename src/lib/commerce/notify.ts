/**
 * Die Hinweismails — eine Stelle, ein Vertrag (0100).
 *
 * WAS EIN HINWEIS IST. Er sagt, dass in SkyIsles etwas passiert ist, und wo
 * es steht. Er ist **kein** Beleg, keine Erklärung und keine Quelle: der
 * Zustand lebt in der Anwendung, und die Lesestände aus `0098`/`0099` sind
 * und bleiben die einzige Wahrheit darüber, was jemand gesehen hat.
 *
 * **EINE MAIL VERSCHIEBT NIEMALS EINEN WASSERSTAND.** Das ist die Regel, die
 * diese Datei überall einhält und die ein Test festhält. Täte sie es, würde
 * eine Zustellung eine Marke löschen, in die niemand hineingesehen hat.
 *
 * GENAU EINMAL JE EREIGNIS. `ref` nennt das auslösende Ereignis — eine
 * Erstattung, ein Zeilenereignis, eine Nachricht. Die Datenbank (0100) macht
 * daraus den Schlüssel `(order, kind, ref)`, und Resend bekommt denselben
 * Wert in seinen Idempotenzschlüssel. Ohne `ref` gilt weiter „einmal je
 * Bestellung", und genau das ist für Bestätigung und Versand richtig.
 *
 * NIE WERFEN. Jeder Aufrufer ist ein Schreibvorgang, der bereits gelungen
 * ist — eine Erstattung ist angewiesen, eine Nachricht steht im Strang. Ein
 * Mailanbieter mit einer schlechten Minute ist kein Grund, einem Menschen zu
 * sagen, seine Handlung sei fehlgeschlagen. Was nicht hinausging, steht in
 * `order_mail` und ist auf der Bestellung sichtbar.
 */
import { createClient } from "@/lib/supabase/server";

/** Die Arten, die diese Datei auslöst. Die einmaligen tragen keine `ref`. */
export type NoticeKind =
  | "refund_confirmation"
  | "cancellation_notice"
  | "message_to_customer"
  | "message_to_seller"
  | "new_order_notice"
  | "withdrawal_notice";

/**
 * Einen Hinweis anstoßen.
 *
 * Über die Edge Function, weil `RESEND_API_KEY` ein Supabase-Secret ist und
 * dieses Deployment keinen Schlüssel hält, der irgendetwas versenden könnte
 * (ADR-0051).
 */
export async function notify(input: {
  orderNumber: string;
  kind: NoticeKind;
  /** Die Identität des Ereignisses. `null` heißt: einmal je Bestellung. */
  ref?: string | number | null;
}): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.functions.invoke("send-order-mail", {
      body: {
        orderNumber: input.orderNumber,
        kind: input.kind,
        ref: input.ref === null || input.ref === undefined ? null : String(input.ref),
      },
    });
  } catch {
    /* In `order_mail` vermerkt, auf der Bestellung sichtbar. */
  }
}

/*
 * DIE DROSSELUNG STEHT NICHT HIER, SONDERN IN DER EDGE FUNCTION.
 *
 * `message_notice_due()` (0100) hat kein Clientrecht, und das ist Absicht:
 * wer sie fragen dürfte, könnte erfahren, ob zu einer fremden Bestellung
 * schon einmal ein Hinweis herausging. `send-order-mail` läuft ohnehin als
 * Service Role und entscheidet es dort — einmal, für alle Aufrufer, und
 * unumgehbar.
 */
