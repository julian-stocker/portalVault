import { redirect } from "next/navigation";

/**
 * Geschäftsdaten & Kontakt now live on "Identität & Dokumente" (ADR-0184,
 * AP3). The old address keeps working: bookmarks and links land on the legal
 * section of the merged page. Nothing is read here — the target page has its
 * own seller gate, and the layout above both answers 404 to anyone without
 * the seller capability.
 */
export default function BusinessLegalPage(): never {
  redirect("/business/profile#betreiber");
}
