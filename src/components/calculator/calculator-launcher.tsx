/**
 * Der Einstieg in den Kalkulator, im Kopf (V1).
 *
 * WARUM EIN EIGENES BAUTEIL. Der Kopf soll nicht wissen, was ein Kalkulator
 * ist. Er zeigt ein Symbol, wenn der Betrachter ein Betrieb ist, und das
 * Symbol bringt sein Fenster selbst mit. `site-nav.tsx` bekommt dadurch
 * genau eine Zeile dazu und keine Zustandsvariable.
 *
 * DAS MODAL WIRD ERST GEBAUT, WENN ES GEBRAUCHT WIRD. Vor dem ersten Druck
 * steht hier nur ein Knopf: kein Katalog, kein Suchindex, keine Liste. Wer
 * den Rechner nie öffnet, zahlt für ihn nichts — und das ist die Mehrheit
 * der Seitenaufrufe, auch beim Betrieb.
 *
 * DIE SICHTBARKEIT IST BEQUEMLICHKEIT, NICHT DIE GRENZE. Wer den Katalog
 * lesen darf, entscheidet `canOperateSeller()` in `fetchOrderbookCatalog` —
 * serverseitig, bei jeder Anfrage. Ein Kunde, der dieses Bauteil von Hand
 * einhängte, bekäme eine leere Liste (ADR-0039: Bequemlichkeit, niemals eine
 * Berechtigung).
 */
"use client";

import { lazy, Suspense, useState } from "react";

import { CalculatorGlyph } from "@/components/layout/nav-glyphs";
import { de } from "@/lib/i18n/de";

const CalculatorModal = lazy(() =>
  import("./calculator-modal").then((m) => ({ default: m.CalculatorModal })),
);

export function CalculatorLauncher() {
  const [open, setOpen] = useState(false);
  /* Einmal geöffnet, bleibt das Modal montiert: es hält die Kalkulation, und
     die soll ein versehentliches Schließen nicht kosten. */
  const [mounted, setMounted] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => { setMounted(true); setOpen(true); }}
        aria-label={de.calculator.openLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        /* Dieselbe Geometrie wie Profil und Warenkorb daneben: 44 px um eine
           18-px-Marke, damit die Reihe im Kopf auf einer Linie bleibt. */
        className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-on-deep-muted transition-colors hover:text-on-deep"
      >
        <CalculatorGlyph />
      </button>

      {mounted ? (
        <Suspense fallback={null}>
          <CalculatorModal open={open} onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </>
  );
}
