/**
 * How a legal document is drawn (ADR-0086).
 *
 * One renderer for all of them, because the documents are structured data and
 * not hand-written HTML. That is what lets a test assert a document's contents
 * without parsing markup, and it is why a new section cannot arrive with a
 * heading level that breaks the outline.
 *
 * ACCESSIBILITY IS THE POINT HERE, not a coat of paint. A legal page is read
 * by people using screen readers, by people zooming to 200 %, and by people
 * who will never touch a mouse. So: one `<h1>`, `<h2>` per section and nothing
 * skipped; real lists for lists; `<dl>` for label/value pairs; a measure that
 * stays near 70 characters; and statutory quotations marked as quotations with
 * their source named, so a reader can tell the law's words from ours.
 *
 * `**bold**` is the only markup the text carries. Deliberately: a legal text
 * needs emphasis and nothing else, and a fuller markdown would be a parser
 * between the author and the reader.
 */
import type { LegalBlock, LegalDocument } from "@/lib/legal/documents";

/** `**bold**` → `<strong>`. Everything else is text, including any `<`. */
function emphasise(text: string, keyPrefix: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={`${keyPrefix}-${index}`} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

/** Paragraphs keep their line breaks: addresses are written as addresses. */
function Prose({ text, id }: { text: string; id: string }) {
  return <p className="mt-3 whitespace-pre-line first:mt-0">{emphasise(text, id)}</p>;
}

function Block({ block, id }: { block: LegalBlock; id: string }) {
  switch (block.kind) {
    case "text":
      return (
        <>
          {block.paragraphs.map((p, i) => (
            <Prose key={`${id}-${i}`} text={p} id={`${id}-${i}`} />
          ))}
        </>
      );

    case "list":
      return (
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-5">
          {block.items.map((item, i) => (
            <li key={`${id}-${i}`} className="whitespace-pre-line">
              {emphasise(item, `${id}-${i}`)}
            </li>
          ))}
        </ul>
      );

    case "steps":
      return (
        <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5">
          {block.items.map((item, i) => (
            <li key={`${id}-${i}`} className="whitespace-pre-line">
              {emphasise(item, `${id}-${i}`)}
            </li>
          ))}
        </ol>
      );

    case "pairs":
      return (
        <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">
          {block.pairs.map(([label, value], i) => (
            <div key={`${id}-${i}`} className="contents">
              <dt className="text-sm text-muted">{label}</dt>
              <dd className="whitespace-pre-line">{emphasise(value, `${id}-${i}`)}</dd>
            </div>
          ))}
        </dl>
      );

    case "quote":
      /*
       * Statutory text, marked as such. The visible source line is not
       * decoration: a reader is entitled to know which sentences are the
       * legislator's — and so is the next person to edit this file.
       */
      return (
        <figure className="mt-4 rounded-sky-lg bg-surface/70 p-5 ring-1 ring-border/70">
          <blockquote className="flex flex-col gap-3">
            {block.paragraphs.map((p, i) => (
              <p key={`${id}-${i}`} className="whitespace-pre-line">
                {emphasise(p, `${id}-${i}`)}
              </p>
            ))}
          </blockquote>
          <figcaption className="mt-4 border-t border-border/60 pt-3 text-xs text-muted">
            Gesetzlicher Wortlaut · {block.source}
          </figcaption>
        </figure>
      );
  }
}

export function LegalDocumentView({ document }: { document: LegalDocument }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pt-8 pb-16 md:pt-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">
          {document.title}
        </h1>
        <p className="mt-2 text-sm text-muted">{document.lead}</p>
        {document.version ? (
          /* Which version this is, on the page, because the order you placed
             points at a version and you may need to compare them. */
          <p className="mt-1 text-xs text-muted">Fassung {document.version}</p>
        ) : null}
      </header>

      <div className="mt-8 flex flex-col gap-8 leading-relaxed">
        {document.sections.map((section, s) => (
          <section key={section.heading} aria-labelledby={`sec-${s}`}>
            <h2 id={`sec-${s}`} className="text-lg font-semibold tracking-tight text-balance">
              {section.heading}
            </h2>
            {section.blocks.map((block, b) => (
              <Block key={`${s}-${b}`} block={block} id={`${s}-${b}`} />
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
