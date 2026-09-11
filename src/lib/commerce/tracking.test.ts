import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { hasTrackingLink, TRACKED_CARRIERS, trackingUrl } from "./tracking";
import { SHIPPING_METHODS } from "./shipping";

const REF = "H1234567890";

describe("the carriers SkyIsles actually offers get a link", () => {
  it("Hermes points at Hermes", () => {
    const url = trackingUrl("hermes", REF);
    expect(url).toBe(
      `https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation/#${REF}`,
    );
    expect(new URL(url!).hostname).toBe("www.myhermes.de");
  });

  it("DHL points at DHL", () => {
    const url = trackingUrl("dhl", REF);
    expect(url).toBe(
      `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${REF}`,
    );
    expect(new URL(url!).searchParams.get("piececode")).toBe(REF);
  });

  it("covers every method the shipping catalogue offers", () => {
    // If a third carrier is ever added, this fails until it has a link or is
    // deliberately listed as one without.
    expect(new Set(TRACKED_CARRIERS)).toEqual(new Set(SHIPPING_METHODS));
  });

  it("is case- and whitespace-tolerant about the code", () => {
    expect(trackingUrl(" Hermes ", REF)).toBe(trackingUrl("hermes", REF));
    expect(trackingUrl("DHL", REF)).toBe(trackingUrl("dhl", REF));
  });

  it("always uses https", () => {
    for (const carrier of TRACKED_CARRIERS) {
      expect(new URL(trackingUrl(carrier, REF)!).protocol, carrier).toBe("https:");
    }
  });
});

describe("nothing is invented", () => {
  it("an unknown carrier gets no link", () => {
    // A wrong link sends somebody to a page that says their parcel does not
    // exist. The number is still shown; only the link is withheld.
    for (const carrier of ["ups", "dpd", "", "Hermes Paket", "post"]) {
      expect(trackingUrl(carrier, REF), carrier).toBeNull();
    }
  });

  it("no carrier and no number get no link", () => {
    expect(trackingUrl(null, REF)).toBeNull();
    expect(trackingUrl(undefined, REF)).toBeNull();
    expect(trackingUrl("hermes", null)).toBeNull();
    expect(trackingUrl("hermes", undefined)).toBeNull();
    expect(trackingUrl("hermes", "")).toBeNull();
    expect(trackingUrl("hermes", "   ")).toBeNull();
  });

  it("says so with a predicate too", () => {
    expect(hasTrackingLink("hermes", REF)).toBe(true);
    expect(hasTrackingLink("ups", REF)).toBe(false);
  });
});

describe("a reference never escapes into the URL", () => {
  /**
   * The database stores the number raw and makes no claim about its shape
   * (0018). Anything that is not plainly a carrier reference is shown as text
   * and gets no link at all.
   */
  const HOSTILE = [
    'x" onclick="alert(1)',
    "../../evil",
    "a b",
    "a?b=c",
    "a#b",
    "javascript:alert(1)",
    "<script>",
    "a%2Fb",
    "'",
    "a\nb",
  ];

  it.each(HOSTILE)("refuses to build a link from %j", (reference) => {
    expect(trackingUrl("hermes", reference)).toBeNull();
    expect(trackingUrl("dhl", reference)).toBeNull();
  });

  it("keeps the host it meant even if the pattern were ever loosened", () => {
    // The encode is the belt behind the pattern's braces: whatever gets past
    // the test above still cannot leave the carrier's own origin.
    const url = trackingUrl("dhl", "ABC-123")!;
    expect(new URL(url).hostname).toBe("www.dhl.de");
  });

  it("accepts what carriers really issue", () => {
    for (const reference of ["H1234567890", "00340434161094042557", "ABC-123456", "1Z999AA10123456784"]) {
      expect(trackingUrl("dhl", reference), reference).not.toBeNull();
    }
  });

  it("refuses something too short to be a reference, and something too long", () => {
    expect(trackingUrl("dhl", "ab")).toBeNull();
    expect(trackingUrl("dhl", "A".repeat(65))).toBeNull();
    expect(trackingUrl("dhl", "A".repeat(64))).not.toBeNull();
  });
});

describe("the parcel this release was tested with", () => {
  /**
   * `SI-2026-001045` on staging: Hermes, reference `123456789`. Pinned so the
   * URL a person is asked to click is the one this code produces, and so a
   * later change to either half is visible as a diff rather than as a
   * customer complaint.
   */
  it("renders the Hermes link the staging order carries", () => {
    expect(trackingUrl("hermes", "123456789")).toBe(
      "https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation/#123456789",
    );
  });

  it("and the component links rather than prints when it can", () => {
    const component = readFileSync("src/components/commerce/tracking-link.tsx", "utf8");
    // The two branches: a link when there is a URL, a plain span when not.
    expect(component).toContain("if (url === null)");
    expect(component).toContain("<span");
    expect(component).toContain('rel="noreferrer"');
    expect(component).toContain('target="_blank"');
    // And it builds none of its own.
    expect(component).toContain("trackingUrl(");
    expect(component).not.toContain("https://");
  });
});

describe("there is one builder, not one per page", () => {
  const SOURCES = [
    "src/app/(admin)/admin/orders/[orderNumber]/page.tsx",
    "src/app/(app)/account/orders/[orderNumber]/page.tsx",
    "src/components/admin/tracking-form.tsx",
  ];

  it.each(SOURCES)("%s builds no URL of its own", (path) => {
    const source = readFileSync(path, "utf8");
    expect(source).not.toContain("myhermes.de");
    expect(source).not.toContain("dhl.de");
    expect(source).not.toContain("piececode");
  });
});
