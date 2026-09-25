import type { Metadata, Viewport } from "next";

import { NavigationTelemetry } from "@/components/perf/navigation-telemetry";
import { SkyBackdrop } from "@/components/layout/sky-backdrop";
import { buildId, canTrackPerformance } from "@/lib/perf/permission";
import { de } from "@/lib/i18n/de";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: de.app.name,
    template: `%s · ${de.app.name}`,
  },
  description: de.app.description,

  /*
   * TEMPORARY — remove this block at the public beta gate.
   *
   * Corrected on 2026-09-25: this used to say there is "no checkout, no legal
   * page and no transactional mail". All three exist, and the shop has been
   * taking real money since 2026-09-21. What is still missing is the decision
   * to be found — the trigger for removing this block is that release gate,
   * not the domain and not the feature set. Having an address and being ready
   * to be found are different things.
   *
   * Vercel sets `X-Robots-Tag: noindex` on preview deployments by itself but
   * NOT on production ones, and this is a production deployment from `main`,
   * so the tag has to come from the app.
   *
   * Declared here rather than in a robots.txt on purpose: a `Disallow` stops
   * a crawler from fetching the page, which also stops it from ever reading
   * a noindex — a URL that someone links to can then still be indexed as a
   * bare address. Allowing the crawl and answering "noindex" is what actually
   * keeps the page out of the index.
   *
   * Root metadata, so it covers every route; removing it is one deletion.
   * `src/lib/layout/robots.test.ts` fails on that deletion and names the
   * launch checklist (docs/DEPLOYMENT.md).
   */
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

/**
 * The viewport, and the one field that makes the bottom bar sit right.
 *
 * WHAT WAS WRONG
 *
 * Nothing exported a viewport at all, so Next emitted its default —
 * `width=device-width, initial-scale=1` — WITHOUT `viewport-fit=cover`. And
 * without that, iOS reports every `env(safe-area-inset-*)` as **zero**.
 *
 * The consequence was not cosmetic and not theoretical. `SiteNav` and
 * `CartToast` each compute their position from `env(safe-area-inset-bottom)`,
 * and tests pin those expressions. On an iPhone all of that arithmetic added
 * nothing, and the bottom bar sat under the home indicator. (A third one,
 * `FloatingCart`, did the same until V3.4 removed it.) The tests could not
 * catch it: they assert that the CSS
 * string is in the bundle, which it was — what was missing is the declaration
 * that makes the value non-zero. `viewport.test.ts` asserts this export.
 *
 * WHY THE OTHER FIELDS ARE WRITTEN OUT
 *
 * Exporting a viewport object replaces the default entirely rather than
 * extending it, so `width` and `initialScale` have to be restated or they are
 * dropped. They are Next's own defaults, repeated deliberately.
 *
 * Zoom is NOT restricted. `maximumScale` and `userScalable` are deliberately
 * absent: a page that cannot be pinched is a page somebody cannot read, and
 * "it keeps the layout tidy" has never been worth that.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,

  /*
   * The whole point of this export. Lets the page paint into the display
   * cutout and the home-indicator area, which is also what makes the
   * safe-area insets report a real size. Everything that has to stay clear of
   * those edges already pads itself with them.
   */
  viewportFit: "cover",

  /*
   * The browser chrome takes the colour of the sky it sits above, so the
   * status bar does not cut a pale band across the top of a dark page. Both
   * values are `--sky-high`: dusk in the default scheme, night in the dark
   * one (ADR-0038).
   */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1b1b42" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0d24" },
  ],
};

/**
 * Root layout.
 *
 * `lang="de"` is hard-coded: V1 is single-language (ADR-0012). Once a second
 * language is added, this value is derived from the active locale instead.
 *
 * The backdrop is mounted once, here, rather than per page: it is fixed and
 * behind everything, so remounting it on every navigation would repaint the
 * sky for no reason. The page still works without it — `--canvas` is a solid
 * colour and every surface above sets its own ground (ADR-0038).
 */
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  /*
   * Asked on the server, once per request (ADR-0072). For everybody without
   * the `performance_tracking` tester permission the component below is not
   * rendered at all — no listener, no timer, no request, and none of the code
   * in the tree. "Off for normal users" is structural here, not a flag.
   */
  const tracking = await canTrackPerformance();

  return (
    <html
      lang="de"
      /*
       * The floor, and deliberately only the floor.
       *
       * `color-scheme` alone: it makes the browser paint its own canvas dark
       * and render form controls dark, so a stylesheet that never arrives
       * degrades to a dark unstyled page rather than a white one.
       *
       * A `background` here would be worse than nothing. Body's background
       * only propagates to the canvas while `html` has none — give `html` one
       * and body's background starts painting as an ordinary element
       * background, on top of every `z-index: -10` child it has. That is what
       * hid the world artwork in V3.3: the page went flat navy and the sky,
       * the islands and the portal all disappeared behind it (V3.4).
       */
      style={{ colorScheme: "dark" }}
    >
      <body className="relative min-h-screen antialiased">
        <SkyBackdrop />
        {children}
        {tracking ? <NavigationTelemetry buildId={buildId()} /> : null}
      </body>
    </html>
  );
}
