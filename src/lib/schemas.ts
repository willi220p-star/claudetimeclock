import { z } from "zod";
import { SETTING_FIELDS, type SettingKey } from "@/lib/admin-config";

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

// Admin configuration (Phase 7). Mirrors private.save_site, save_closure_day, publish_notice and
// update_settings; the database has the final say and its messages are shown as they come.

/** A form text box holding a number in [min, max]; whole numbers unless `decimals`. */
function numberText(message: string, min: number, max: number, decimals = false) {
  return z
    .string()
    .trim()
    .regex(decimals ? /^-?\d+(\.\d+)?$/ : /^\d+$/, message)
    .transform(Number)
    .refine((n) => n >= min && n <= max, message);
}

const quarterHour = z.string().regex(/^([01]\d|2[0-3]):(00|15|30|45)$/, "Pick a time in 15-minute steps.");

export const siteSchema = z
  .object({
    name: z.string().trim().min(1, "Give the site a name.").max(80, "Use 80 characters or fewer."),
    address: z.string().trim().min(1, "Enter the site's address.").max(240, "Use 240 characters or fewer."),
    latitude: numberText("Enter a latitude from -90 to 90.", -90, 90, true),
    longitude: numberText("Enter a longitude from -180 to 180.", -180, 180, true),
    radius_m: numberText("Set the radius between 20 and 2,000 metres.", 20, 2000),
    standard_capacity: numberText("Set the standard capacity between 1 and 50.", 1, 50),
    hard_capacity: numberText("Set the hard limit between 1 and 50.", 1, 50),
    window_start: quarterHour,
    window_end: quarterHour,
  })
  .refine((site) => site.hard_capacity >= site.standard_capacity, {
    path: ["hard_capacity"],
    message: "The hard limit can't be below the standard capacity.",
  })
  .refine((site) => site.window_start < site.window_end, {
    path: ["window_end"],
    message: "The window must end after it starts.",
  });

export const closureSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
  name: z.string().trim().min(1, "Give the closure day a name.").max(80, "Use 80 characters or fewer."),
  kind: z.enum(["public_holiday", "office_closure"]),
  site_id: z.string(),
});

export const noticeSchema = z.object({
  version: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z][0-9A-Za-z.-]{0,19}$/, "Use a version like 1.1: letters, numbers, dots and dashes, up to 20 characters."),
  title: z.string().trim().min(1, "Give the notice a title.").max(120, "Use 120 characters or fewer."),
  body: z.string().trim().min(50, "Write the full notice, at least 50 characters.").max(20000, "Use 20,000 characters or fewer."),
});

export const settingsSchema = z
  .object({
    ...(Object.fromEntries(
      SETTING_FIELDS.map((f) => [f.key, numberText(`Use a whole number from ${f.min} to ${f.max}.`, f.min, f.max)]),
    ) as Record<SettingKey, ReturnType<typeof numberText>>),
    fortnight_anchor: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a Monday.")
      .refine((day) => new Date(`${day}T00:00:00Z`).getUTCDay() === 1, "The fortnight anchor must be a Monday."),
  })
  .refine((s) => s.cert_retention_days <= s.retention_days, {
    path: ["cert_retention_days"],
    message: "Medical certificates can't be kept longer than the other records.",
  });

/** Zod issues as { field: first message }, for FormField errors. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    out[key] ??= issue.message;
  }
  return out;
}
