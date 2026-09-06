/**
 * What survives a failed submission, and what must not.
 *
 * React resets an uncontrolled form once its action returns — that is the
 * documented behaviour of `<form action={serverAction}>`, and it is right for
 * the success case. On an error it emptied both fields, so a mistyped
 * password also cost the visitor their e-mail address.
 *
 * The rule is about what the value *is*, not about convenience:
 *
 *   identifier (e-mail, username) → kept, so a wrong password costs one field
 *   secret (password)             → cleared, always
 *
 * The kept value lives in React state for as long as the form is on screen.
 * Nothing is written to `localStorage`, `sessionStorage` or a cookie: this is
 * the current form's state, not a remembered login.
 */
export type AuthFieldName = "email" | "password" | "username";

/** Field names whose value is an identifier rather than a secret. */
const IDENTIFIERS: ReadonlySet<AuthFieldName> = new Set(["email", "username"]);

export function survivesError(field: AuthFieldName): boolean {
  return IDENTIFIERS.has(field);
}
