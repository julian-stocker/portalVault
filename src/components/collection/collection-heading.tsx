/**
 * The collection's title.
 *
 * Its own component because two files render it: the page, and the `loading`
 * boundary that stands in for the page while it is being fetched. A heading
 * that differed between the two would make the arrival visibly jump.
 *
 * No data, no client code — it can be sent before anything has been queried.
 */
import { de } from "@/lib/i18n/de";

export function CollectionHeading() {
  return (
    /* A strip of the world, not a wallpaper (ADR-0038, V3.2): enough sky that
       the collection belongs to the same place as the catalog, nowhere near
       the figures the panel below has to state. */
    <div className="mb-6 md:mb-8">
      <h1
        className="text-3xl leading-tight font-semibold tracking-tight md:text-5xl"
        style={{ textShadow: "0 2px 20px rgb(10 9 24 / 0.85), 0 1px 3px rgb(10 9 24 / 0.95)" }}
      >
        {de.collection.title}
      </h1>
      <p
        className="mt-2 text-sm text-on-deep-muted md:text-base"
        style={{ textShadow: "0 1px 14px rgb(10 9 24 / 0.9)" }}
      >
        {de.collection.subline}
      </p>
    </div>
  );
}
