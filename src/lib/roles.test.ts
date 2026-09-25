import { describe, expect, test } from "vitest";
import type { Profile } from "@/lib/daymark";
import { deskRedirect, homeFor, rolesOf } from "@/lib/roles";

function person(flags: Partial<Profile> = {}): Profile {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    login_id: "alex",
    display_name: "Alex Rivera",
    contact_email: "alex@example.com",
    active: true,
    is_intern: false,
    is_supervisor: false,
    is_admin: false,
    must_change_password: false,
    created_at: "2026-09-25T00:00:00Z",
    ...flags,
  };
}

describe("rolesOf", () => {
  test("lists roles admin, supervisor, intern", () => {
    expect(rolesOf(person({ is_intern: true, is_supervisor: true, is_admin: true }))).toEqual([
      "admin",
      "supervisor",
      "intern",
    ]);
  });

  test("a single role", () => {
    expect(rolesOf(person({ is_intern: true }))).toEqual(["intern"]);
  });

  test("no flags means no roles", () => {
    expect(rolesOf(person())).toEqual([]);
  });
});

describe("homeFor", () => {
  test("a password change comes before any desk", () => {
    expect(homeFor(person({ is_admin: true, must_change_password: true }))).toBe("/set-password");
  });

  test("the highest role wins", () => {
    expect(homeFor(person({ is_intern: true, is_supervisor: true }))).toBe("/supervisor");
    expect(homeFor(person({ is_intern: true, is_admin: true }))).toBe("/admin");
    expect(homeFor(person({ is_intern: true }))).toBe("/clock");
  });

  test("no role has no home", () => {
    expect(homeFor(person())).toBeNull();
  });
});

describe("deskRedirect", () => {
  test("signed out goes to sign in", () => {
    expect(deskRedirect(null, "intern")).toBe("/");
  });

  test("a person may use any desk they hold, not only the highest", () => {
    expect(deskRedirect(person({ is_intern: true, is_admin: true }), "intern")).toBeNull();
    expect(deskRedirect(person({ is_intern: true, is_admin: true }), "admin")).toBeNull();
  });

  test("a desk they don't hold sends them home", () => {
    expect(deskRedirect(person({ is_intern: true }), "admin")).toBe("/clock");
  });

  test("must change password blocks every desk", () => {
    expect(deskRedirect(person({ is_intern: true, must_change_password: true }), "intern")).toBe("/set-password");
  });

  test("no role at all", () => {
    expect(deskRedirect(person(), "supervisor")).toBe("none");
  });
});
