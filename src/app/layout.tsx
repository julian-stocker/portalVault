import type { Metadata } from "next";

import { de } from "@/lib/i18n/de";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: de.app.name,
    template: `%s · ${de.app.name}`,
  },
  description: de.app.description,
};

/**
 * Root layout.
 *
 * `lang="de"` is hard-coded: V1 is single-language (ADR-0012). Once a second
 * language is added, this value is derived from the active locale instead.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
