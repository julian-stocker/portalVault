/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FigureGrid } from "@/components/catalog/figure-grid";
import {
  GRID_GAP_X,
  PAGE_MAX,
  PAGE_PAD,
  TILE_COLUMNS_MAX,
  TILE_MAX,
  TILE_MIN,
  containerWidth,
  tileColumns,
  tileWidth,
  trackWidth,
} from "@/lib/catalog/row-template";

/**
 * THE TILE GRID'S LAYOUT HIERARCHY — the regression test for the bug the
 * desktop review of UX-01E found.
 *
 * WHAT WENT WRONG, AND WHY ARITHMETIC ALONE DID NOT CATCH IT. The grid asked
 * for `repeat(auto-fill, minmax(min(360px,100%), 520px))`, which reads as
 * "tiles between 360 and 520 px wide, as many as fit". But `auto-fill`
 * computes its repetition count from the track's MAXIMUM sizing function
 * whenever that maximum is definite — so the browser asked how many 520 px
 * tiles fit, not how many 360 px ones:
 *
 *     container 1120 → floor((1120+12) / (520+12)) = 2
 *     container  968 → floor(( 968+12) / 532)      = 1
 *
 * Three columns would have needed 1584 px of container, which the page's
 * `max-w-6xl` never gives. On a normal laptop window the catalogue therefore
 * drew ONE tile of 520 px, centred by `justify-center`, with the page empty
 * either side. And the module that was supposed to prevent exactly this
 * divided by the MINIMUM — so it confirmed the design instead of catching it.
 *
 * TWO THINGS ARE THEREFORE HELD HERE, because either alone would have missed
 * it:
 *
 *   1. THE TRACK'S MAXIMUM STAYS INDEFINITE (`1fr`). That is what makes the
 *      count come from the minimum, which is the number the design reasons
 *      about. The 520 px ceiling lives on the tile.
 *   2. THE HIERARCHY RELEASES THE WIDTH. Even a correct formula collapses to
 *      one track if an ancestor makes the available width indefinite — a
 *      `w-fit`, an `items-center` on a column flex, an `inline-flex`, a
 *      stray `max-w-`. `auto-fill` against an indefinite width resolves to
 *      ONE repetition, which looks exactly like the bug above.
 *
 * THE LIMIT, NAMED PLAINLY: jsdom has no layout engine. `getBoundingClientRect`
 * returns zeros here, so this file cannot MEASURE that three tiles are 365 px
 * wide — no browser is available in this environment, and installing one is a
 * change of tech stack that needs its own approval. What it can do, and does,
 * is check the real rendered DOM structure and the real class names along the
 * chain against the properties the layout depends on, plus the arithmetic
 * against the CSS spec's counting rule. The pixels are judged on the
 * operator's own laptop.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const GRID_SRC = read("src/components/catalog/figure-grid.tsx");
const PAGE_SRC = read("src/app/(public)/(catalog)/page.tsx");
const VIEW_SRC = read("src/components/catalog/catalog-view.tsx");

/**
 * The chain as it really renders, read off the running staging server on
 * 2026-10-27 with an HTML parser:
 *
 *   body.relative.min-h-screen.antialiased
 *     div                                    (no class)
 *       main.mx-auto.w-full.max-w-6xl.px-4…
 *         div.flex.flex-col.gap-7            CatalogView's outer stack
 *           div[the grid]
 *
 * Recorded here so the test models what the browser actually got, not what
 * the source looked like to whoever wrote the test.
 */
const MEASURED_CHAIN = [
  "relative min-h-screen antialiased",
  "",
  "mx-auto w-full max-w-6xl px-4 pt-8 pb-6 md:pt-12 md:pb-10",
  /* `gap-5` since the UX-01F header was flattened (was `gap-7`). Reviewed
     deliberately, which is what this constant is for: still a plain column
     flex with the default `align-items: stretch`, so it takes no width. */
  "flex flex-col gap-5",
] as const;

/**
 * Classes that would take the width away, and what each one does.
 *
 * Every one of these makes the grid's available width either indefinite or
 * smaller than the page allows — and `auto-fill` against an indefinite width
 * is one repetition, which is the bug wearing a different hat.
 */
const WIDTH_TAKERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bw-fit\b/, "shrink-to-fit: the width becomes indefinite"],
  [/\bw-max\b/, "max-content: the grid sizes to its tiles, not the page"],
  [/\bw-min\b/, "min-content"],
  [/\binline-(?:flex|grid|block)\b/, "inline formatting: shrink-to-fit again"],
  [/\bfloat-/, "floated boxes are shrink-to-fit"],
  [/\bitems-(?:center|start|end)\b/, "on a column flex this is a cross-axis "
    + "alignment, and it makes the child shrink-to-fit instead of stretching"],
  [/\bjustify-(?:center|end|between|around|evenly)\b/, "distributes leftover "
    + "space — which a 1fr grid must never have, and which hid the bug"],
  [/\bmax-w-(?!6xl\b)/, "a second width ceiling below the page's own"],
  [/\bw-\[/, "a hard-coded width"],
];

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
});

/** Three tiles in the real grid — the subject of the walk below. */
const TILES = (
  <FigureGrid mode="rows">
    <article data-tile="1">Bash</article>
    <article data-tile="2">Bouncer</article>
    <article data-tile="3">Chop Chop</article>
  </FigureGrid>
);

/** Renders the real grid inside the real chain and returns the grid element. */
async function renderInChain(): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  /* The chain from the inside out, so each level wraps the next. */
  await act(async () => {
    root!.render(
      [...MEASURED_CHAIN].reverse().reduce<React.ReactNode>(
        (child, className) => createElement("div", { className }, child),
        /* JSX for the grid itself: its props type requires `children`, which
           `createElement`'s overload does not infer from rest arguments — and
           passing `children` in the props object is what the lint rule
           forbids. JSX satisfies both. */
        TILES,
      ),
    );
  });
  return host.querySelector<HTMLElement>('[class*="grid-cols-["]')!;
}

describe("the grid itself", () => {
  it("is ONE element, with no wrapper left to measure", async () => {
    /*
     * The container-query wrapper existed only so a query had a subject.
     * `auto-fill` measures the grid, so the wrapper went — and a wrapper that
     * came back would be one more box able to take the width away.
     */
    const grid = await renderInChain();
    expect(grid).toBeTruthy();
    expect(grid.parentElement!.className).toBe("flex flex-col gap-5");
    expect(grid.children).toHaveLength(3);
  });

  it("asks for an indefinite maximum, which is what fixes the count", async () => {
    const grid = await renderInChain();
    expect(grid.className).toContain("grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))]");
    /*
     * THE REGRESSION, STATED AS A RULE: no definite length may be the track's
     * maximum. `minmax(min(360px,100%), 520px)` is the exact shape that broke
     * it, and any other `…px)` in that position breaks it the same way.
     */
    expect(grid.className, "a definite track maximum breaks the count")
      .not.toMatch(/minmax\(min\([^)]*\),\s*\d+px\)/);
    expect(grid.className).not.toContain("520px");
  });

  it("and keeps nothing to centre, so leftover space cannot hide a mis-count", async () => {
    /*
     * `1fr` tracks consume the row. The old `justify-center` was what turned
     * "only one track fits" into a tidy centred tile rather than something
     * visibly wrong — it made the bug look deliberate.
     */
    const grid = await renderInChain();
    expect(grid.className).not.toMatch(/\bjustify-/);
    expect(grid.className).toContain("gap-x-3");
    expect(grid.className).toContain("gap-y-2");
  });

  it("the tile carries the ceiling, where it cannot touch the count", () => {
    const row = read("src/components/catalog/figure-row.tsx");
    expect(row).toContain(`max-w-[${TILE_MAX}px]`);
    expect(row).toContain("mx-auto");
    expect(row).toContain("w-full");
    /* And the grid does not, which is the other half of the same statement. */
    expect(GRID_SRC.slice(GRID_SRC.indexOf("const ROWS"), GRID_SRC.indexOf("export function")))
      .not.toContain(`${TILE_MAX}px`);
  });
});

describe("every ancestor releases the width", () => {
  it("the chain is the one that really renders, not one invented here", () => {
    /*
     * The test is only worth as much as its model, so the model is checked
     * against the source. If someone adds a wrapper, this fails first and the
     * walk below is updated deliberately rather than silently bypassed.
     */
    expect(PAGE_SRC).toContain(`<main className="${MEASURED_CHAIN[2]}">`);
    expect(VIEW_SRC).toContain(`<div className="${MEASURED_CHAIN[3]}">`);
    /* And the grid is still rendered inside that stack. */
    expect(VIEW_SRC).toContain("<FigureGrid mode={gridMode}>");
  });

  it("no ancestor takes the width away, measured by walking the real DOM", async () => {
    const grid = await renderInChain();
    const chain: HTMLElement[] = [];
    for (let el = grid.parentElement; el && el !== document.body; el = el.parentElement) {
      chain.push(el);
    }
    expect(chain.length, "the chain rendered").toBeGreaterThanOrEqual(MEASURED_CHAIN.length - 1);

    for (const el of chain) {
      for (const [pattern, why] of WIDTH_TAKERS) {
        /* `max-w-6xl` on the page's own `main` is the ONE allowed ceiling —
           it is the page layout the operator asked to keep. */
        expect(el.className, `<${el.tagName.toLowerCase()} class="${el.className}">: ${why}`)
          .not.toMatch(pattern);
      }
    }
  });

  it("and the page's own ceiling is the only one, with its padding accounted for", () => {
    expect(PAGE_SRC).toContain("max-w-6xl");
    expect(PAGE_MAX).toBe(1152);
    expect(PAGE_PAD).toBe(16);
    /* So the grid never measures more than this, which is why three tiles is
       the ceiling rather than a choice. */
    expect(containerWidth(4000)).toBe(1120);
    expect(tileColumns(1120)).toBe(TILE_COLUMNS_MAX);
  });

  it("a column flex is what the chain uses, and it stretches by default", async () => {
    /*
     * THE QUIET DEPENDENCY. `flex flex-col` gives its children the full cross
     * size because `align-items` defaults to `stretch`. One `items-center`
     * anywhere on this chain would make the grid shrink-to-fit, the available
     * width indefinite, and `auto-fill` resolve to a single repetition — the
     * same symptom as the bug this file is named after, from a different
     * cause. That is why the walk above forbids it rather than trusting it.
     */
    const grid = await renderInChain();
    const stack = grid.parentElement!;
    expect(stack.className).toContain("flex flex-col");
    expect(stack.className).not.toMatch(/\bitems-/);
  });
});

describe("the counts, against the rule the browser really uses", () => {
  it("repetitions come from the MINIMUM now, and the numbers follow", () => {
    /* floor((container + gap) / (TILE_MIN + gap)), never fewer than one. */
    for (const [container, columns] of [
      [328, 1], [358, 1], [382, 1], [600, 1], [731, 1],
      [732, 2], [736, 2], [968, 2], [992, 2], [1103, 2],
      [1104, 3], [1120, 3],
    ] as const) {
      expect(tileColumns(container), `${container} px`).toBe(columns);
      expect(Math.floor((container + GRID_GAP_X) / (TILE_MIN + GRID_GAP_X)) || 1)
        .toBe(columns);
    }
  });

  it("and what the OLD formula would have given, so the bug cannot return quietly", () => {
    /*
     * The same widths counted the way the browser counted them before the
     * fix — by the definite 520 px maximum. One column from 736 to 1051, two
     * above that, three never. Kept as an executable record of the defect.
     */
    const byDefiniteMax = (c: number) =>
      Math.max(1, Math.floor((c + GRID_GAP_X) / (TILE_MAX + GRID_GAP_X)));
    expect(byDefiniteMax(736)).toBe(1);
    expect(byDefiniteMax(968)).toBe(1);
    expect(byDefiniteMax(1120)).toBe(2);
    expect(byDefiniteMax(1583)).toBe(2);
    /* Three would have needed a container the page never provides. */
    expect(3 * TILE_MAX + 2 * GRID_GAP_X).toBe(1584);
    expect(containerWidth(4000)).toBeLessThan(1584);
  });

  it("every named width lands on the right count, tile and track", () => {
    for (const [viewport, columns, tile] of [
      [360, 1, 328], [390, 1, 358], [414, 1, 382],
      [768, 2, 362], [1024, 2, 490], [1280, 3, 365], [1600, 3, 365],
    ] as const) {
      const container = containerWidth(viewport);
      expect(tileColumns(container), `${viewport} px: columns`).toBe(columns);
      expect(Math.round(tileWidth(container)), `${viewport} px: tile`).toBe(tile);
      /* The tile is the track, capped — and the track is never short. */
      expect(tileWidth(container)).toBeLessThanOrEqual(TILE_MAX);
      expect(trackWidth(container)).toBeGreaterThanOrEqual(
        container >= TILE_MIN ? TILE_MIN - 1 : container);
    }
  });

  it("nothing overflows, at any of them", () => {
    for (const viewport of [360, 390, 414, 600, 768, 1024, 1280, 1600, 4000]) {
      const container = containerWidth(viewport);
      const columns = tileColumns(container);
      const used = columns * trackWidth(container) + (columns - 1) * GRID_GAP_X;
      expect(used, `${viewport} px overflows`).toBeLessThanOrEqual(container + 0.5);
    }
  });

  it("and a lone track wider than the ceiling leaves the tile at the ceiling", () => {
    /* The "übermäßig langgezogene Einzelkachel" case: one track of 600, one
       tile of 520, centred in it by `mx-auto`. */
    expect(trackWidth(600)).toBe(600);
    expect(tileWidth(600)).toBe(TILE_MAX);
  });
});
