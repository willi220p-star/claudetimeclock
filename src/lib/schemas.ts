import { z } from "zod";

// Client checks for quick feedback. They mirror private.clean_email, private.check_password
// and private.create_person; the database re-validates everything.

const email = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Enter a real email address.");

/** D11: 12–72 characters, as private.check_password and minimum_password_length. */
export const password = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(72, "Use 72 characters or fewer.");

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
});

export const resetRequestSchema = z.object({ email });

export const newPasswordSchema = z
  .object({ password, confirm: z.string() })
  .refine((value) => value.password === value.confirm, {
    path: ["confirm"],
    message: "Type the same password in both boxes.",
  });

export const setPasswordSchema = z.object({ password });

export const emailSchema = z.object({ email });

export const personSchema = z
  .object({
    display_name: z.string().trim().min(1, "Enter their name.").max(80, "Use 80 characters or fewer."),
    email,
    password,
    is_intern: z.boolean(),
    is_supervisor: z.boolean(),
    is_admin: z.boolean(),
  })
  .refine((value) => value.is_intern || value.is_supervisor || value.is_admin, {
    path: ["is_intern"],
    message: "Give them at least one role.",
  });
