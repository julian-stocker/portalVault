import { describe, expect, it } from "vitest";

import {
  profileWriteError,
  signInError,
  signUpError,
  signUpOutcome,
  passwordUpdateError,
} from "./errors.ts";
import { de } from "@/lib/i18n/de";

describe("profileWriteError", () => {
  it("reads a unique violation as 'name taken'", () => {
    // The only way to learn this: profiles are private, so nothing can be
    // checked in advance (docs/AUTH.md, section 9.5).
    const result = profileWriteError({ code: "23505" }, "julian");
    expect(result).toEqual({ field: "username", message: de.auth.errors.usernameTaken });
  });

  it("distinguishes the reserved-name constraint from the format constraint", () => {
    expect(
      profileWriteError({ code: "23514", message: 'violates "profiles_username_not_reserved"' }, "admin"),
    ).toEqual({ field: "username", message: de.auth.errors.usernameReserved });

    expect(
      profileWriteError({ code: "23514", message: 'violates "profiles_username_format"' }, "a b"),
    ).toEqual({ field: "username", message: de.auth.errors.usernameInvalid });
  });

  it("falls back to a generic form error for anything else", () => {
    expect(profileWriteError({ code: "08006" }, "julian").field).toBe("form");
    expect(profileWriteError(null, "julian").field).toBe("form");
  });
});

describe("signInError", () => {
  it("never reveals whether an account exists", () => {
    const unknown = signInError({ message: "Invalid login credentials" });
    const unconfirmed = signInError({ message: "Email not confirmed" });
    expect(unknown).toEqual(unconfirmed);
    expect(unknown.message).toBe(de.auth.errors.invalidCredentials);
  });

  it("names a rate limit, which is not an account signal", () => {
    expect(signInError({ status: 429 }).message).toBe(de.auth.errors.rateLimited);
  });
});

describe("signUpError", () => {
  it("points at the password field when the password is the problem", () => {
    expect(signUpError({ message: "Password should be at least 6 characters" }).field).toBe("password");
  });

  it("stays generic otherwise", () => {
    expect(signUpError({ message: "something else" }).message).toBe(de.auth.errors.generic);
  });
});

describe("signUpOutcome", () => {
  const newUser = { user: { identities: [{ provider: "email" }] } };

  it("lets a real sign-up through: a user, an identity, and no session", () => {
    // Email confirmation is on, so the missing session is the expected shape
    // of success — it must not be read as a failure.
    expect(signUpOutcome({ ...newUser, session: null }, null)).toBeNull();
  });

  it("refuses to promise a mail when identities came back empty", () => {
    // Supabase answers a sign-up for an existing address without an error and
    // with an empty identities array (docs/AUTH.md, section 9.13).
    const result = signUpOutcome({ user: { identities: [] } }, null);
    expect(result).not.toBeNull();
    expect(result).toEqual({ field: "form", message: de.auth.errors.signUpNotCompleted });
  });

  it("does not confirm that the account exists", () => {
    const message = signUpOutcome({ user: { identities: [] } }, null)!.message;
    expect(message).not.toMatch(/bereits registriert|schon vergeben|existiert bereits/i);
    // The same wording must be usable when the real cause was something else.
    expect(message).toBe(de.auth.errors.signUpNotCompleted);
  });

  it("treats an absent identities field as fine, not as empty", () => {
    // Absent and empty mean different things; conflating them would reject
    // sign-ups that actually worked.
    expect(signUpOutcome({ user: {} }, null)).toBeNull();
    expect(signUpOutcome({ user: { identities: undefined } }, null)).toBeNull();
    expect(signUpOutcome({ user: { identities: null } }, null)).toBeNull();
  });

  it("keeps the rate limit message it had before", () => {
    expect(signUpOutcome(null, { status: 429 })).toEqual({
      field: "form",
      message: de.auth.errors.rateLimited,
    });
  });

  it("still routes a real Supabase error through the safe translation", () => {
    expect(signUpOutcome(null, { message: "Password should be at least 6 characters" })).toEqual(
      signUpError({ message: "Password should be at least 6 characters" }),
    );
    expect(signUpOutcome(null, { message: "some internal detail" })?.message).toBe(
      de.auth.errors.generic,
    );
  });

  it("an error wins even if a user came back with it", () => {
    expect(signUpOutcome(newUser, { status: 429 })?.message).toBe(de.auth.errors.rateLimited);
  });

  it("reports a generic failure for a response with neither error nor user", () => {
    expect(signUpOutcome(null, null)).toEqual({ field: "form", message: de.auth.errors.generic });
    expect(signUpOutcome({ user: null }, null)?.message).toBe(de.auth.errors.generic);
    expect(signUpOutcome(undefined, undefined)?.message).toBe(de.auth.errors.generic);
  });

  it("never leaks the raw Supabase message", () => {
    const raw = "duplicate key value violates unique constraint users_email_key";
    expect(signUpOutcome(null, { message: raw })?.message).not.toContain(raw);
  });
});

describe("passwordUpdateError", () => {
  it("treats an unusable session as an expired link", () => {
    expect(passwordUpdateError({ message: "Auth session missing" }).message).toBe(
      de.auth.errors.sessionExpired,
    );
  });
});
