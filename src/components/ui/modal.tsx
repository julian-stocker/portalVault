/**
 * The one modal dialog.
 *
 * SkyIsles had none before the quick view, so this is written as a primitive
 * rather than as part of that feature: it knows nothing about figures, offers
 * or the cart, and the next dialog should use it rather than grow a second
 * one.
 *
 * WHY IT IS PORTALLED, AND WHY THAT IS NOT OPTIONAL
 *
 * `FigureCard` carries `@container`, which is `container-type: inline-size`,
 * which implies `contain: layout` — and an element with layout containment
 * becomes the containing block for its `position: fixed` descendants. A
 * dialog rendered inside the card would therefore lay itself out inside a
 * 211 px card instead of the viewport. `site-nav.tsx` records the same class
 * of bug for `backdrop-filter`. Portalling to `document.body` steps outside
 * every such ancestor for good.
 *
 * WHY THE BACKGROUND IS NOT `inert`
 *
 * The obvious way to make the page behind a dialog unreachable is `inert` (or
 * `aria-hidden`) on everything else. Both would also silence `CartToast`,
 * which is a `role="status"` live region living inside the layout — and the
 * confirmation it announces is the answer to the one action this dialog
 * exists for. Removing the page from the accessibility tree at the exact
 * moment it has something to say is the worse trade.
 *
 * So the background is made unreachable the way `aria-modal` was specified
 * for: pointers hit the backdrop and go no further, Tab is cycled inside the
 * panel, and `aria-modal="true"` tells assistive technology that what is
 * outside is not part of this dialog.
 */
"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * What Tab may reach. `[tabindex="-1"]` is excluded on purpose: the panel
 * itself carries one so it can be focused on open without joining the cycle.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Whether this render is happening in a browser.
 *
 * `createPortal` needs a `document`, which the server render has not got. The
 * naive guard is `useState(false)` plus an effect that sets it true, but that
 * is a synchronous `setState` inside an effect — a cascading render, and the
 * lint rule that forbids it is right.
 *
 * `useSyncExternalStore` states the same thing declaratively, with a server
 * snapshot that differs from the client one. It is the pattern
 * `lib/collection/view-mode.ts` already uses for its own
 * "the server has no storage" problem, and it subscribes to nothing because
 * the answer never changes after the first paint.
 */
const subscribeToNothing = () => () => {};

function useIsBrowser(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}

/**
 * How wide the panel may grow on a large screen.
 *
 * Only a cap — the panel is `w-full` below it, so neither value changes
 * anything on a phone. `md` suits a dialog that asks one question; `lg` suits
 * one that shows a thing, where a picture and its facts want to sit side by
 * side rather than stacked into a column.
 */
const WIDTH = {
  md: "max-w-md",
  lg: "max-w-[660px]",
} as const;

export function Modal({
  open,
  onClose,
  /** Id of the element that names this dialog — usually its heading. */
  labelledBy,
  size = "md",
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  size?: keyof typeof WIDTH;
  children?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const browser = useIsBrowser();

  /* Focus in on open, and back where it came from on close. */
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    // The panel, not the first button: the first button here is a commerce
    // action, and opening a dialog must never put a purchase under the space
    // bar.
    panel.current?.focus();

    return () => {
      /*
       * The opener may be gone — the visitor collected the figure while the
       * dialog was open and the ownership filter removed its card. Focusing a
       * detached node throws focus to <body> and, worse, some browsers scroll
       * on the attempt. So it is checked first; if it has gone, focus is left
       * alone rather than sent somewhere arbitrary.
       */
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [open]);

  /* Escape closes, Tab cycles. One listener, because both are key handling. */
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;

      const reachable = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        // A control inside a collapsed or hidden branch is in the DOM but not
        // reachable, and cycling onto it would strand the focus ring.
        (element) => element.offsetParent !== null || element === document.activeElement,
      );
      if (reachable.length === 0) {
        // Nothing to cycle between: keep focus on the panel rather than
        // letting Tab walk out into the page behind.
        event.preventDefault();
        panel.current.focus();
        return;
      }

      const first = reachable[0];
      const last = reachable[reachable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === panel.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  /* The page behind must not scroll while the dialog is open. */
  useEffect(() => {
    if (!open) return;
    const { body, documentElement } = document;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;

    /*
     * Hiding the scrollbar makes the page wider by its width, and everything
     * behind the dialog jumps sideways. Compensating keeps it still. The gap
     * is zero on overlay scrollbars, which is most phones.
     */
    const gap = window.innerWidth - documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (gap > 0) body.style.paddingRight = `${gap}px`;

    return () => {
      // The values that were there, not hard-coded defaults: another dialog
      // may have been open, and "" is not always what it was.
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
    };
  }, [open]);

  if (!open || !browser) return null;

  return createPortal(
    <div
      /*
       * Above the header (z-30) and the floating cart (z-30), below the cart
       * confirmation (z-60): the toast is the answer to the action inside
       * this dialog and has to stay visible over it.
       */
      className={
        "fixed inset-0 z-50 flex items-center justify-center " +
        /*
         * The gap to the edge of the screen is what makes this read as
         * something laid over the catalog rather than as a new page. Wider
         * from `sm:` up, where there is room for it — on a phone the dialog
         * may use nearly the full width, but never all of it.
         *
         * The safe area matters at the bottom in landscape as well as
         * portrait, so it is added to the padding rather than to a margin.
         */
        "p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-8 " +
        /*
         * The catalog has to stay READABLE behind this, not merely present.
         *
         * `backdrop-blur-md` is 12 px, which turned the grid into fog and
         * made the dialog read as a new page. 3 px is enough to push the
         * cards back without dissolving them; what actually creates the focus
         * is the darkening and the panel's own contrast and shadow, not the
         * blur.
         */
        "bg-[oklch(10%_0.03_280_/_0.78)] backdrop-blur-[3px] " +
        "motion-safe:animate-[fade-in_120ms_ease-out]"
      }
      /*
       * `mousedown` rather than `click`, and only when the press began on the
       * backdrop itself. A click handler would close the dialog when a text
       * selection started inside the panel and ended outside it, which is a
       * gesture people make while reading a price.
       */
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        // Focusable, not tabbable: it receives focus on open and then steps
        // out of the Tab cycle.
        tabIndex={-1}
        className={
          `relative flex w-full ${WIDTH[size]} flex-col overflow-hidden outline-none ` +
          /*
           * A ceiling, never a height. The panel is as tall as what is in it
           * and stops growing here; it does not reach for the ceiling when
           * the content is short. 78 % leaves a band of catalog above and
           * below on a desktop — at 90 % the dialog read as a page.
           *
           * `dvh`, not `vh`: on iOS Safari `vh` is the tallest the viewport
           * ever gets, so the panel would run under the address bar.
           */
          "max-h-[85dvh] sm:max-h-[74dvh] " +
          /*
           * Depth, not ornament (ADR-0038).
           *
           * Three layers instead of "dark rectangle with a gold edge": an
           * indigo ground a shade deeper than the page, a hairline of warm
           * brand gold on the outside, and a very faint white line just
           * inside it so the panel reads as a struck plate catching the light
           * of the sky behind it — the same device the navigation bar uses.
           * The shadow does the lifting the blur no longer does.
           */
          "rounded-sky-lg bg-[oklch(16%_0.045_282)] ring-1 ring-gold-line " +
          "shadow-[0_24px_70px_-12px_oklch(4%_0.02_280_/_0.75),0_0_0_1px_rgb(255_255_255/0.06)_inset] " +
          "motion-safe:animate-[rise_140ms_ease-out]"
        }
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
