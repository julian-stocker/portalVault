/**
 * A catalog card, with the collect action built into it.
 *
 * The card itself is the action now (ADR-0038, V2.1): tapping it adds the
 * figure to the collection, tapping it again takes it out. The frame is the
 * feedback. That replaces a full-width button on every one of 561 cards,
 * which was the single largest source of interface noise in the grid.
 *
 * Signed out it is a link into the sign-in flow carrying the current catalog
 * context, so the visitor comes back to the same series and search (ADR-0027).
 * The action is deliberately not replayed afterwards.
 *
 * Signed in it updates immediately and reverts if the server disagrees.
 *
 * "Info" is a separate link in the footer, a sibling of the body rather than
 * a child — so navigating to the detail page cannot also toggle the state,
 * with no event handling required to keep the two apart.
 *
 * For an administrator the same card carries different actions (ADR-0042).
 * Everything about how a figure looks — picture, name, price, series,
 * element, layout, responsiveness — stays in FigureCard and is shared. Only
 * the interaction changes: a collector collects, an administrator edits.
 * There is no second card component and no second catalog.
 *
 * SINCE V3.8 THE ADMIN CARD READS EXACTLY LIKE THE PUBLIC ONE. It had grown
 * two differences beyond its action — an inline name editor with a pencil,
 * and a stack of three controls in a row that fits one. Both are gone: the
 * name is the same text a collector sees, and the trade row carries a single
 * "Bearbeiten" that opens a dialog holding all five editable fields.
 */
"use client";

import { useState, useTransition } from "react";

import { AdminTileActions } from "@/components/admin/card-actions";
import { InlinePrice } from "@/components/admin/inline-price";
import { TypeSelect } from "@/components/admin/type-select";
import { AvailabilityBell } from "@/components/catalog/availability-bell";
import { FavoriteHeart } from "@/components/catalog/favorite-heart";
import { FigureCard } from "@/components/catalog/figure-card";
import { FigureRow } from "@/components/catalog/figure-row";
import { OfferLink } from "@/components/shop/offer-link";
import { setCollected } from "@/lib/collection/actions";
import type { AccountType } from "@/lib/auth/capabilities";
import type { CatalogFigure } from "@/lib/catalog/types";
import type { Offer } from "@/lib/shop/offer";
import { hasQuickViewOffer } from "@/lib/ui/quick-view";
import { de } from "@/lib/i18n/de";


export function CatalogCard({
  figure,
  initialCollected,
  onCollectedChange,
  initialFavorited = false,
  onFavoritedChange,
  favorites = false,
  signInHref,
  highlighted = false,
  admin = false,
  accountType = "user",
  visible = true,
  offers = [],
  showSeries = false,
  onOpenOffers,
  onEdit,
  marketBoostPercent = 0,
  /*
   * UX-01G: DIE KACHEL IST DIE VORGABE. Vorher war es `"card"` — die
   * klassische Sammelkarte —, und der Katalog musste die Kachel ausdrücklich
   * verlangen. Jetzt ist es umgekehrt: der Katalog zeichnet die Kachel ohne
   * Zutun, und der SHOP verlangt seine Wahl ausdrücklich
   * (`layout={layoutFor(view)}`). Wer die Eigenschaft vergisst, bekommt die
   * Darstellung des Katalogs und nicht die eines anderen.
   */
  layout = "row",
}: {
  figure: CatalogFigure;
  initialCollected: boolean;
  /** Admin only: opens the edit dialog for this figure. */
  onEdit?: (figure: CatalogFigure) => void;
  /**
   * Welches der drei Konten hier liest (ADR-0078) — und damit, welche
   * Handlungen die Kachel trägt (UX-01G).
   *
   *   user      `[Glocke] [Info] [Herz]`, und der Körper sammelt
   *   business  `[Info]` — kein Herz, keine Glocke, kein Sammeln
   *   admin     `[Info] [Stift] [Auge]`
   *
   * WARUM EIN BETRIEBSKONTO NICHTS DAVON BEKOMMT: es sammelt nicht
   * (ADR-0042/ADR-0078), und `0145` weist ein Herz über
   * `is_collector_account()` ohnehin ab. Ein Knopf, der nur scheitern kann,
   * ist schlimmer als keiner — und bis UX-01G bekam ein Betriebskonto
   * genau den, weil nur `admin` abgefragt wurde.
   *
   * ES IST KEINE GRENZE. Jede Schreibhandlung dahinter fragt ihr Recht in
   * der Datenbank selbst: `setCollected` über die Richtlinien von
   * `collection_items`, das Herz über `favorite_demand()`, das Auge über
   * `is_platform_admin()` in `admin_set_catalog_status`. Diese Eigenschaft
   * entscheidet, was gezeichnet wird.
   */
  accountType?: AccountType;
  /**
   * Tells the catalog what this card just did, so the ownership filter sees
   * it in the same frame rather than after a round trip (V4.3).
   */
  onCollectedChange?: (skyId: string, collected: boolean) => void;
  /**
   * Whether this figure is on the viewer's wishlist (0145, ADR-0136).
   *
   * Handed down from the page like `initialCollected`: one query answers for
   * the whole catalog, and a per-card lookup would be 561 requests.
   */
  initialFavorited?: boolean;
  /**
   * Tells the grid's owner what the heart just did, so a wishlist can lose
   * the card in the same frame — and get it back when the server refuses.
   */
  onFavoritedChange?: (skyId: string, favorited: boolean) => void;
  /**
   * Whether this surface shows the heart at all.
   *
   * OFF BY DEFAULT, so a surface that cannot answer "does he want this" does
   * not offer the action by accident. The catalog and the wishlist turn it
   * on; the collection's showcase and every other grid stay as they were.
   *
   * An administrator never gets it, whatever this says — see the admin
   * branch below (ADR-0042).
   */
  favorites?: boolean;
  /** null when somebody is signed in; otherwise where the card leads instead. */
  signInHref: string | null;
  /** A deep link landed on this card. Passed straight through. */
  highlighted?: boolean;
  /** Administrator mode: editorial actions instead of collection actions. */
  admin?: boolean;
  /** Editorial visibility, only meaningful in administrator mode. */
  visible?: boolean;
  /**
   * What SkyIsles offers for this figure — usually nothing (ADR-0043).
   *
   * Handed down from the page rather than looked up here: one call answers
   * for the whole catalog, and a per-card lookup would be 561 requests.
   */
  offers?: readonly Offer[];
  /**
   * Whether the card names its game.
   *
   * Off by default, because the catalog always has a series selected and the
   * label would repeat the active tab on every card. `/shop` turns it on: that
   * grid mixes all six games, so the series is the one thing a card there
   * cannot be assumed to share with its neighbours.
   */
  showSeries?: boolean;
  /**
   * Opens the quick view for this figure (IR-001).
   *
   * Passed down rather than held here: the dialog must not be rendered inside
   * the card. `FigureCard` is an `@container`, which is a containing block
   * for `position: fixed` descendants, so a dialog mounted in this subtree
   * would lay itself out inside a 211 px card. The grid's owner holds the
   * state and renders one dialog for the whole page.
   */
  onOpenOffers?: () => void;
  /**
   * The temporary catalog market-value boost, in per cent (0094).
   *
   * Handed straight through to `FigureCard`, like `offers`: one value for the
   * whole grid, read once per request by the page. Default 0, so a surface
   * that does not pass one shows the stored price.
   */
  marketBoostPercent?: number;
  /**
   * WHICH PRESENTATION DRAWS THIS FIGURE (UX-01B, ADR-0148).
   *
   * `card` is the collector's card on its artwork and stays the default, so
   * every existing surface renders exactly what it rendered before. `row` is
   * the horizontal presentation.
   *
   * THE CHOICE IS THE ONLY THING THAT CHANGES. The collect toggle, its
   * optimistic state, its rollback, the heart, the offer line and the quick
   * view handler are all computed above this and handed to whichever
   * presentation is chosen — there is no second `setCollected()` call, no
   * second piece of optimistic state and no second offer rule anywhere in
   * this file. That is what makes "the row and the card behave identically"
   * a structural fact rather than something to keep in step by hand.
   *
   * THE ADMINISTRATOR NEVER GETS A ROW. Their branch returns before this is
   * read: an editorial card carries an inline name editor, a hidden badge and
   * a "Bearbeiten" action, none of which the row has a place for, and
   * `/admin` is not one of the surfaces the row is meant for (ADR-0148).
   *
   * Nothing passes this yet. UX-01C adds the switch that does, and until then
   * the row is reachable only from a test — which is the point of shipping
   * the presentation before the control that selects it.
   */
  layout?: "card" | "row";
}) {
  const [collected, setLocal] = useState(initialCollected);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  function onToggle() {
    const desired = !collected;
    setLocal(desired); // optimistic
    onCollectedChange?.(figure.skyId, desired);
    setFailed(false);

    startTransition(async () => {
      // The desired end state, not a toggle: a second tap that arrives while
      // the first is still in flight expresses its own end state (ADR-0027).
      const result = await setCollected(figure.skyId, desired);
      if (!result.ok) {
        setLocal(!desired); // a wrong state on screen is worse than an error
        // Also told upward, and that is the part that still works when the
        // card has meanwhile left the list under the ownership filter: the
        // figure comes back. Its inline error message is lost with it, which
        // is the right trade — a wrong list is worse than a missing note.
        onCollectedChange?.(figure.skyId, !desired);
        setFailed(true);
      }
    });
  }


  // The administrator's card. Same FigureCard, same layout, same everything
  // that shows a figure — a different set of things to do with it. No buy
  // action: the operator manages prices and listings in /admin/inventory and
  // does not shop in their own catalog (ADR-0042).
  if (admin) {
    /*
     * SEIT UX-01G IST DAS DIESELBE KACHEL WIE FÜR JEDES ANDERE KONTO.
     *
     * Vorher stand hier `FigureCard` — die klassische Sammelkarte —, und
     * zwar für jeden Administrator und unabhängig von der gemerkten Wahl:
     * `layout = admin ? "card" : …`. Das war der einzige Ort im Katalog, an
     * dem die Rolle das AUSSEHEN entschied und nicht nur die Handlung. Jetzt
     * entscheidet sie nur noch die Handlung, und die Kachel ist eine.
     *
     * KEIN SAMMELN UND KEIN HERZ: ein Betrieb oder Admin verwaltet den
     * Katalog und sammelt nicht daraus (ADR-0042). Die Kachel bekommt
     * deshalb weder `onToggle` noch `favoriteSlot` — ihr Körper ist dann
     * ruhig, und der Weg zur Figur steht als Info-Marke in der Leiste, wo er
     * bei jeder Rolle steht.
     *
     * DAS VARIANTENSIEGEL BLEIBT: es ist eine Eigenschaft der Figur und
     * nicht des Lesers, und ein Betreiber muss eine Legendary von ihrer
     * Grundfigur unterscheiden können — mehr als jeder andere (V3.2).
     *
     * KEINE ANGEBOTSZEILE: den Preis hat der Betreiber in
     * `/admin/inventory`, wo er ihn auch ändern kann. Ihn hier zu
     * wiederholen wäre eine zweite Stelle, die einen Preis nennt und ihn
     * nicht bearbeiten kann.
     */
    return (
      <FigureRow
        figure={figure}
        marketBoostPercent={marketBoostPercent}
        ownership="catalog"
        highlighted={highlighted}
        showSeries={showSeries}
        /*
         * CAT-09 — GEDÄMPFT, WENN SIE VERSTECKT IST, und nur dann.
         *
         * EIN ENTWURF IST NICHT VERSTECKT. Er stand noch nie öffentlich, und
         * ihn wie eine zurückgenommene Figur zu zeichnen wäre eine falsche
         * Aussage über seinen Zustand (ADR-0151 führt drei Werte, nicht
         * zwei). Deshalb `=== "hidden"` und nicht `!visible`.
         */
        dimmed={(figure.catalogStatus ?? (visible ? "public" : "hidden")) === "hidden"}
        priceSlot={
          <InlinePrice
            skyId={figure.skyId}
            name={figure.displayName}
            /* DER GESPEICHERTE WERT. Der Zuschlag wird daneben gerechnet und
               nie zurückgeschrieben — siehe `inline-price.tsx`. */
            marketPrice={figure.marketPrice}
            marketBoostPercent={marketBoostPercent}
            dimmed={(figure.catalogStatus ?? (visible ? "public" : "hidden")) === "hidden"}
          />
        }
        adminSlot={
          <AdminTileActions
            skyId={figure.skyId}
            name={figure.displayName}
            /* Der redaktionelle Status, wie die Datenbank ihn führt. Die
               Kachel kennt `catalogVisible`; `draft` kommt aus dem
               Katalogstatus, den `0152` eingeführt hat. */
            status={figure.catalogStatus ?? (visible ? "public" : "hidden")}
            onEdit={() => onEdit?.(figure)}
          />
        }
        /*
         * CAT-10 — DAS BANNER-DROPDOWN STEHT, WO DER SAMMLER DAS ANGEBOT
         * SIEHT.
         *
         * `trade` ist der vorhandene Slot am rechten Rand der zweiten Zeile.
         * Ein Administrator braucht dort keine Angebotszeile — er sieht die
         * Angebote im Betriebsbereich —, und der Betreiber hat genau diese
         * Stelle verlangt. Keine neue Kachel, kein neuer Slot, keine
         * geänderte Geometrie.
         *
         * ES WÄHLT NUR AUS DER HINTERLEGTEN MENGE. Zuordnen geht im
         * Bearbeiten-Dialog; dieses Feld entscheidet ausschließlich, welcher
         * der zugeordneten Types als Banner erscheint.
         */
        trade={
          <TypeSelect
            skyId={figure.skyId}
            name={figure.displayName}
            types={figure.types ?? []}
            visibleType={figure.visibleType ?? null}
            decided={figure.visibleTypeDecided ?? false}
          />
        }
      />
    );
  }

  /**
   * The trade row, and the whole of it (V3.2).
   *
   * The silver plate is painted into both templates, so it is always there
   * and `OfferLink` decides what stands on it: an offer, or the quiet
   * sentence that there is none.
   *
   * The "Info" link is gone. The card body already leads to the detail page,
   * and a second link to the same destination was the one element on the tile
   * that said nothing. Whatever the visitor taps — picture, name, offer —
   * they arrive at the figure, and the offer row arrives at its offers.
   */
  /*
   * The quick view is offered only when it would have something to sell.
   *
   * It trades loose copies alone (`QUICK_VIEW_CONDITION`), so a figure whose
   * only listing is boxed gets no dialog — and `OfferLink` then does what it
   * did before: it is a link, and it leads to the figure page where that
   * boxed offer is. A dialog that opened to say "nothing here" would be a
   * worse answer than the page that has the answer.
   */
  const quickBuy = hasQuickViewOffer(offers);

  /**
   * Das Herz — oder nichts.
   *
   * KEIN HERZ FUER DEN ADMINISTRATOR, und das steht nicht hier: der
   * Admin-Zweig oben kehrt schon zurueck, bevor diese Zeile laeuft. Ein
   * Betriebs- oder Adminkonto sammelt nicht im eigenen Katalog (ADR-0042),
   * und `0145` weist es ueber `is_collector_account()` ohnehin ab — ein Herz
   * dort waere ein Knopf, der nur scheitern kann.
   *
   * `favorites` AUS heisst wirklich nichts: eine Flaeche, die den
   * Favoritenstand nicht kennt, zeigt kein Herz, statt ein leeres zu zeigen.
   * Ein leeres Herz ist eine Aussage („nicht vorgemerkt"), und sie waere
   * dort falsch.
   */
  const favorite = favorites && accountType === "user" ? (
    <FavoriteHeart
      skyId={figure.skyId}
      initialFavorited={initialFavorited}
      signInHref={signInHref}
      onFavoritedChange={onFavoritedChange}
    />
  ) : null;

  /**
   * Die Handelszeile — einmal gebaut, von beiden Darstellungen benutzt.
   *
   * `compact` ist das Einzige, worin sich die beiden unterscheiden, und die
   * Entscheidung gehoert hierher, weil nur diese Stelle `layout` kennt
   * (UX-01D). Auf der Karte spannt der Link die ganze Silberplatte des
   * Artworks und hat den Platz fuer „Angebote ab"; auf der Zeile steht er
   * neben dem Marktwert, und dort kostet das Wort 54 px, die der Serienname
   * braucht. Ab `sm:` steht auch auf der Zeile wieder die lange Fassung —
   * das entscheidet CSS, nicht dieser Zweig.
   *
   * An den Angeboten selbst aendert das nichts: dieselben `offers`, dasselbe
   * Ziel, derselbe zugaengliche Name, dieselbe Quick-View-Abfangung.
   */
  /**
   * Die vorbereitete Glocke — sichtbar, deaktiviert, und nur auf der Kachel.
   *
   * SIE WIRD BEDINGUNGSLOS ÜBERGEBEN UND BEDINGT GEZEIGT (UX-01E). Ob eine
   * Glocke erscheint, entscheidet `FigureRow` an `!offered` — eine Figur mit
   * Angebot braucht keine Erinnerung. Diese Stelle entscheidet nur, DASS es
   * eine gibt, und `FigureCard` bekommt sie nicht: die klassische Karte
   * bleibt unverändert.
   *
   * Sie ist nicht funktionsfähig und tut auch nicht so: ein `disabled`
   * Knopf, kein Alarm-RPC, keine Abfrage, kein Zustand. `0150` ist nirgends
   * angewandt, und UX-02 ist ein entferntes `disabled` — keine
   * Layoutänderung, weil der 44-px-Platz schon jetzt der endgültige ist.
   */
  /*
   * UX-01G: NUR EIN SAMMLERKONTO BEKOMMT SIE. „Benachrichtige mich, wenn es
   * wieder da ist" ist eine Frage des Sammlers; ein Betriebskonto stellt sie
   * nicht, und ein Adminkonto hat die Leiste schon voll.
   */
  const bell = accountType === "user" ? <AvailabilityBell /> : null;

  const trade = (
    <OfferLink
      offers={offers}
      slug={figure.slug}
      name={figure.displayName}
      onOpen={quickBuy ? onOpenOffers : undefined}
      compact={layout === "row"}
    />
  );

  /**
   * A collect that did not stick has to say so on the card it failed on.
   *
   * Over the foot of the window, where it covers artwork rather than
   * information — and where it cannot change the card's height.
   */
  const notice = failed ? (
    <span
      role="alert"
      className="absolute inset-x-1 bottom-1 rounded bg-danger/90 px-1 py-0.5 text-center text-[9px] leading-tight font-semibold text-[#2a0f0d]"
    >
      {de.catalog.collectFailed}
    </span>
  ) : null;

  // Signed out the body is a link rather than a toggle: there is nothing to
  // toggle yet, and the same tap should lead where the visitor needs to go.
  if (signInHref) {
    return layout === "row" ? (
      /* The same props, and `failed` instead of `notice`: where a failure
         message is placed is a property of the presentation, not of this
         caller — see `figure-row.tsx`. */
      <FigureRow
        figure={figure}
        marketBoostPercent={marketBoostPercent}
        ownership="catalog"
        href={signInHref}
        highlighted={highlighted}
        showSeries={showSeries}
        trade={trade}
        offered={quickBuy}
        favoriteSlot={favorite}
        bellSlot={bell}
        failed={failed}
      />
    ) : (
      <FigureCard
        figure={figure}
        marketBoostPercent={marketBoostPercent}
        ownership="catalog"
        href={signInHref}
        highlighted={highlighted}
        showSeries={showSeries}
        trade={trade}
        favoriteSlot={favorite}
        notice={notice}
      />
    );
  }

  /*
   * UX-01G — EIN BETRIEBSKONTO SAMMELT NICHT, UND DER KÖRPER SAGT DAS.
   *
   * Bis hierher kam bisher jedes Konto, das nicht `admin` war — auch ein
   * Betriebskonto. Es bekam damit einen Sammelknopf, den die Datenbank
   * ablehnt: `collection_items` gehört Sammlern, und `0145` weist ein
   * Betriebskonto über `is_collector_account()` ab. Ein Knopf, der nur
   * scheitern kann, ist schlimmer als keiner.
   *
   * Statt zu sammeln führt der Körper zur Figur — dorthin, wo ein
   * Betriebskonto ohnehin hinwill, und wohin die Info-Marke daneben auch
   * führt.
   */
  const sammelt = accountType === "user";
  if (!sammelt) {
    return (
      <FigureRow
        figure={figure}
        marketBoostPercent={marketBoostPercent}
        ownership="catalog"
        highlighted={highlighted}
        showSeries={showSeries}
        href={`/skylanders/${figure.slug}`}
        trade={trade}
        offered={quickBuy}
      />
    );
  }

  return layout === "row" ? (
    <FigureRow
      figure={figure}
      marketBoostPercent={marketBoostPercent}
      ownership="catalog"
      collected={collected}
      /* The same ranking rule as the card below, through the same prop and
         the same function (`understatesCard`) — on a row it is carried by the
         ground rather than by a desaturated shell, because a row has no
         artwork to take the colour out of. */
      knowsCollection
      onToggle={onToggle}
      toggleLabel={collected ? de.catalog.collectedHint : de.catalog.collect}
      highlighted={highlighted}
      showSeries={showSeries}
      trade={trade}
      /*
       * Whether the offer's pill is dressed as an action (UX-01C). The same
       * `hasQuickViewOffer()` the quick view already hangs on — no second
       * buyability rule, and no new call: `quickBuy` is computed once above.
       *
       * NO `bellSlot` IS PASSED, AND THAT IS THE POINT. The row supports a
       * second position in its action column, but the availability bell is
       * UX-02 and its migrations are not applied anywhere. A bell on a
       * production route would look like a working feature and be none.
       */
      offered={quickBuy}
      favoriteSlot={favorite}
      bellSlot={bell}
      failed={failed}
    />
  ) : (
    <FigureCard
      figure={figure}
      marketBoostPercent={marketBoostPercent}
      ownership="catalog"
      collected={collected}
      /*
       * THE ONE SURFACE THAT RANKS ITS CARDS (V4.6).
       *
       * Signed in, in the catalog, the collection is known for every card on
       * the page — so a figure the collector does not have is drawn a hair
       * smaller on a shell with the colour taken out of it.
       *
       * Not passed on the two branches above. Signed out there is no
       * collection to compare against, and an administrator does not collect
       * from the catalog they manage (ADR-0042); in both cases every card
       * would be understated, which says nothing about ownership and merely
       * makes the grid look faded.
       */
      knowsCollection
      onToggle={onToggle}
      toggleLabel={collected ? de.catalog.collectedHint : de.catalog.collect}
      highlighted={highlighted}
      showSeries={showSeries}
      trade={trade}
      favoriteSlot={favorite}
      notice={notice}
    />
  );
}
