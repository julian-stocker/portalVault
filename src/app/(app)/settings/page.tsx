import { permanentRedirect } from "next/navigation";

/**
 * The account area moved.
 *
 * `/settings` held a username field, a password field and a sign-out button
 * in one column, and there was nowhere to see an order or keep a delivery
 * address. It is now four named destinations under `/account` (ADR-0061).
 *
 * Kept as a redirect rather than deleted: the path is in the navigation model
 * (`activeSection`), in bookmarks and in the onboarding flow, and a 404 for a
 * page somebody used yesterday is a worse answer than a redirect.
 */
export default function SettingsPage(): never {
  permanentRedirect("/account");
}
