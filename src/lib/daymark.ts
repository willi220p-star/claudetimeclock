import type { Tables } from "@/lib/database.types";

export type EventType = "shift_in" | "shift_out";

export type Profile = Pick<
  Tables<"daymark_profiles">,
  | "id"
  | "login_id"
  | "display_name"
  | "contact_email"
  | "active"
  | "is_intern"
  | "is_supervisor"
  | "is_admin"
  | "must_change_password"
  | "created_at"
>;

export const PROFILE_COLUMNS =
  "id, login_id, display_name, contact_email, active, is_intern, is_supervisor, is_admin, must_change_password, created_at";

export type Punch = Pick<
  Tables<"daymark_punches">,
  "id" | "user_id" | "occurred_at" | "photo_path" | "place_name" | "source" | "flags" | "distance_m" | "accuracy_m"
> & { event_type: EventType };

export const PUNCH_COLUMNS =
  "id, user_id, event_type, occurred_at, photo_path, place_name, source, flags, distance_m, accuracy_m";

/** Old break_in/break_out rows stay in the table and are ignored everywhere in the UI. */
export const SHIFT_EVENTS: EventType[] = ["shift_in", "shift_out"];

export const EVENT_LABEL: Record<EventType, string> = {
  shift_in: "Clock in",
  shift_out: "Clock out",
};

/** Fraud signals stored on a punch: they flag, they don't block. */
export const FLAG_LABEL: Record<string, string> = {
  low_accuracy: "Rough location",
  suspicious_accuracy: "Unusually exact location",
  repeat_coords: "Same spot as another day",
  desktop_ua: "Desktop browser",
  new_device: "New device",
};

export const SOURCE_LABEL: Record<string, string> = {
  auto_close: "Auto-closed",
  punch_fix: "Punch fix",
  supervisor: "Supervisor confirmed",
};

export type ConsentDecision ="granted" | "refused" | "withdrawn";

/** `rpc('my_consent')`. */
export type Consent = {
  notice_version: string;
  notice_acknowledged: boolean;
  location: ConsentDecision | null;
  selfie: ConsentDecision | null;
};

/** `rpc('start_clock')`. */
export type ClockChallenge = {
  challenge_id: string;
  event_type: EventType;
  gesture: string;
  expires_at: string;
  photo_path: string;
};

export const PHOTO_BUCKET = "daymark-photos";
/** §14: signed photo URLs live for 60 seconds. */
export const SIGNED_URL_SECONDS = 60;

export function formatDistance(metres: number) {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

export function errorText(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message
  ) {
    return error.message;
  }
  return fallback;
}
