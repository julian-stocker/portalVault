import type { Metadata } from "next";

import { SkyBackdrop } from "@/components/layout/sky-backdrop";
import { de } from "@/lib/i18n/de";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: de.app.name,
    template: `%s · ${de.app.name}`,
  },
  description: de.app.description,

  /*
   * TEMPORARY — remove this block when skyisles.de goes live.
   *
   * The first deployment is a test address on *.vercel.app, meant for trying
   * the site on a real phone. It must not become the version Google knows.
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
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
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
      </body>
    </html>
  );
}
