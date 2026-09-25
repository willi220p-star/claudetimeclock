import { describe, expect, test } from "vitest";
import { newPasswordSchema, personSchema, signInSchema } from "@/lib/schemas";

describe("form schemas mirror the SQL validators", () => {
  test("sign-in trims and lower-cases the email", () => {
    expect(signInSchema.parse({ email: "  Maya@DGK.test ", password: "x" }).email).toBe("maya@dgk.test");
  });

  test("an email needs a user, an @ and a domain with a dot", () => {
    expect(signInSchema.safeParse({ email: "maya@dgk", password: "x" }).success).toBe(false);
    expect(signInSchema.safeParse({ email: "maya dgk@test.com", password: "x" }).success).toBe(false);
  });

  test("passwords are 12 to 72 characters (D11)", () => {
    const ok = (value: string) => newPasswordSchema.safeParse({ password: value, confirm: value }).success;
    expect(ok("a".repeat(11))).toBe(false);
    expect(ok("a".repeat(12))).toBe(true);
    expect(ok("a".repeat(72))).toBe(true);
    expect(ok("a".repeat(73))).toBe(false);
  });

  test("the confirmation must match", () => {
    const result = newPasswordSchema.safeParse({ password: "a".repeat(12), confirm: "b".repeat(12) });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["confirm"]);
  });

  test("a new person needs a name and at least one role", () => {
    const person = {
      display_name: "Maya Chen",
      email: "maya@dgk.test",
      password: "a".repeat(12),
      is_intern: false,
      is_supervisor: false,
      is_admin: false,
    };
    expect(personSchema.safeParse(person).success).toBe(false);
    expect(personSchema.safeParse({ ...person, is_intern: true }).success).toBe(true);
    expect(personSchema.safeParse({ ...person, is_intern: true, display_name: "  " }).success).toBe(false);
  });
});
