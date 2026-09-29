/**
 * Der Ausgang — eine Umsetzung, zwei Türen.
 *
 * WAS SCHIEFGING. Bis ADR-0111 führte das Konto-Symbol jede Rolle nach
 * `/account`, und dort stand der einzige Abmelden-Knopf des Produkts. Seit
 * die aktive Rolle die Tür bestimmt, landet ein Betriebskonto auf
 * `/business` — und dort gab es keinen. Der Ausgang war für den Verkäufer
 * nicht mehr erreichbar, ohne `/account` von Hand einzutippen.
 *
 * Eine Regression aus einer richtigen Entscheidung: die Hierarchie wurde
 * verdoppelt, der Ausgang nicht.
 *
 * WARUM EINE KOMPONENTE UND NICHT ZWEI FORMULARE. Abmelden ist keine
 * Rollenhandlung — es beendet eine Sitzung, die jedes Konto hat. Zwei
 * abgeschriebene Formulare wären zwei Stellen, an denen sich Methode, Ziel
 * oder Beschriftung auseinanderentwickeln können. Es gibt eine Umsetzung,
 * einen Endpunkt (`/auth/signout`) und zwei Stellen, die sie zeigen — je
 * eine je Kontobereich.
 *
 * POST, NICHT LINK. Ein `GET` auf eine Abmeldung beendet die Sitzung, sobald
 * irgendein Vorauslader die Adresse berührt. Die Route nimmt deshalb nur
 * POST, und dies ist ein echtes Formular.
 *
 * SICHTBAR ABGETRENNT. Es ist das Einzige in einem Kontobereich, das nichts
 * ändert, sondern beendet.
 */
import { ACTION_NEUTRAL } from "@/components/ui/action";
import { de } from "@/lib/i18n/de";

export function SignOutForm() {
  return (
    <form action="/auth/signout" method="post" className="border-t border-border/70 pt-6">
      <button type="submit" className={ACTION_NEUTRAL}>
        {de.nav.signOut}
      </button>
    </form>
  );
}
