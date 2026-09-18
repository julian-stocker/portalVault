/**
 * Das Muster-Widerrufsformular (ADR-0086).
 *
 * Anlage 2 zu Art. 246a § 1 Abs. 2 Satz 1 Nr. 1 und § 2 Abs. 2 Nr. 2 EGBGB,
 * verbatim, with only the entrepreneur's details filled into the placeholder
 * the model marks for them.
 *
 * IT IS NOT AN INPUT FORM, and that is deliberate. The statutory model is a
 * document the consumer may copy, print or adapt — replacing it with a tidy
 * set of text fields would replace the statutory model with one of our own,
 * which is the one thing the statute does not allow. The **interactive** route
 * is the § 356a function at `/widerrufen`; this is the paper one, and both are
 * offered because the law offers both.
 *
 * Rendered as a `<pre>` inside a `<figure>`: it is a quoted document, its line
 * breaks carry meaning, and a screen reader should announce it as the
 * quotation it is rather than as a form to fill in.
 */
import { WIDERRUFSFORMULAR } from "@/lib/legal/widerruf";
import { de } from "@/lib/i18n/de";

export function WithdrawalForm() {
  const copy = de.legal.form;

  const body = [
    WIDERRUFSFORMULAR.intro,
    "",
    `${copy.recipient}:`,
    ...WIDERRUFSFORMULAR.recipient,
    "",
    ...WIDERRUFSFORMULAR.lines.map((line) => `— ${line}`),
    "",
    WIDERRUFSFORMULAR.footnote,
  ].join("\n");

  return (
    <section aria-labelledby="muster" className="mx-auto w-full max-w-2xl px-4 pb-16">
      <h2 id="muster" className="text-lg font-semibold tracking-tight">
        {copy.heading}
      </h2>
      <p className="mt-3 text-sm text-muted">{copy.hint}</p>

      <figure className="mt-4">
        <pre className="overflow-x-auto rounded-sky-lg bg-surface/70 p-5 text-sm leading-relaxed ring-1 ring-border/70">
          {body}
        </pre>
        <figcaption className="mt-3 text-xs text-muted">
          Gesetzlicher Wortlaut · Anlage 2 zu Art. 246a § 1 Abs. 2 Satz 1 Nummer 1 und § 2
          Absatz 2 Nummer 2 EGBGB
        </figcaption>
      </figure>
    </section>
  );
}
