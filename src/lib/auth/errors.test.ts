import { describe, expect, it } from "vitest";

import { profileWriteError, signInError, signUpError, passwordUpdateError } from "./errors.ts";
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

describe("passwordUpdateError", () => {
  it("treats an unusable session as an expired link", () => {
    expect(passwordUpdateError({ message: "Auth session missing" }).message).toBe(
      de.auth.errors.sessionExpired,
    );
  });
});
