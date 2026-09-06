/**
 * What the collection looks like the instant it is asked for.
 *
 * This file is the reason tapping "Sammlung" now does something. `/collection`
 * is a dynamic route, and Next.js skips prefetching a dynamic route entirely
 * unless it has a `loading` boundary — so a click had to wait for a full
 * server round trip before anything on screen changed, and the catalog simply
 * stayed put for most of a second (measured: 209 ms to the first byte, 816 ms
 * to the end). With this file the router has something prefetched to show, and
 * the transition starts immediately.
 *
 * It renders the destination's own heading and its skeleton rather than a
 * spinner: the point is that you have arrived in the collection and it is
 * still filling in, not that something is spinning.
 *
 * Kept in step with `page.tsx` by construction — same heading markup, same
 * `CollectionSkeleton` the page's own Suspense boundary uses.
 */
import { CollectionHeading } from "@/components/collection/collection-heading";
import { CollectionSkeleton } from "@/components/collection/collection-skeleton";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-8 pb-6 md:pt-12 md:pb-10">
      <CollectionHeading />
      <CollectionSkeleton />
    </main>
  );
}
