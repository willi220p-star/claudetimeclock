"use client";

import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { PROFILE_COLUMNS, type Consent, type Profile } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";

// One cached load per sign-in, so `use()` in the desk gates gets a stable promise.
let generation = 0;
const profiles = new Map<number, Promise<Profile | null>>();
const consents = new Map<number, Promise<Consent>>();

export function clearSessionCache() {
  generation += 1;
  profiles.clear();
  consents.clear();
  writeOfflineCopy(null);
}

// The last profile and consent on this phone, so Home opens with no signal (D35). Cleared on sign-out.
const OFFLINE_KEY = "dgk-offline-session";
type OfflineCopy = { profile?: Profile; consent?: Consent };

function readOfflineCopy(): OfflineCopy {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_KEY) ?? "{}") as OfflineCopy;
  } catch {
    return {};
  }
}

function writeOfflineCopy(copy: OfflineCopy | null) {
  try {
    if (copy) localStorage.setItem(OFFLINE_KEY, JSON.stringify({ ...readOfflineCopy(), ...copy }));
    else localStorage.removeItem(OFFLINE_KEY);
  } catch {
    // Storage blocked: offline opening just isn't available.
  }
}

function offline(error: unknown) {
  return !navigator.onLine || isAuthRetryableFetchError(error) || /failed to fetch|load failed|network/i.test(String((error as Error)?.message));
}

export function sessionProfile() {
  const current = generation;
  const existing = profiles.get(current);
  if (existing) return existing;
  const pending = fetchProfile();
  profiles.set(current, pending);
  pending.catch(() => profiles.delete(current));
  return pending;
}

/** The signed-in intern's consent state. Rejects on a network or database error. */
export function sessionConsent() {
  const current = generation;
  const existing = consents.get(current);
  if (existing) return existing;
  const pending = fetchConsent();
  consents.set(current, pending);
  pending.catch(() => consents.delete(current));
  return pending;
}

const NOTICE_KEY = "dgk-sign-out-notice";

/** A line for the sign-in page after an automatic sign-out (this tab only). */
export function leaveSignOutNotice(text: string | null) {
  try {
    if (text) sessionStorage.setItem(NOTICE_KEY, text);
    else sessionStorage.removeItem(NOTICE_KEY);
  } catch {
    // Storage blocked: the sign-in page just shows no notice.
  }
}

export function readSignOutNotice() {
  try {
    return sessionStorage.getItem(NOTICE_KEY);
  } catch {
    return null;
  }
}

/** After recording a consent decision, keep the fresh state for the gates. */
export function rememberConsent(consent: Consent) {
  consents.set(generation, Promise.resolve(consent));
  writeOfflineCopy({ consent });
}

async function fetchProfile(): Promise<Profile | null> {
  try {
    const profile = await fetchProfileOnline();
    writeOfflineCopy(profile ? { profile } : null);
    return profile;
  } catch (error) {
    const copy = readOfflineCopy().profile;
    if (copy && offline(error)) return copy;
    throw error;
  }
}

async function fetchProfileOnline(): Promise<Profile | null> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getClaims();
  // Offline is not signed out: surface it so the page can offer "Try again".
  if (error && isAuthRetryableFetchError(error)) throw error;
  const userId = data?.claims?.sub;
  if (error || !userId) return null;

  const { data: profile, error: profileError } = await supabase
    .from("daymark_profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw profileError;

  // A paused login is treated as signed out; its sessions end when it is paused.
  if (!profile || !profile.active) return null;
  return profile;
}

async function fetchConsent(): Promise<Consent> {
  const { data, error } = await createClient().rpc("my_consent");
  if (error) {
    const copy = readOfflineCopy().consent;
    if (copy && offline(error)) return copy;
    throw error;
  }
  writeOfflineCopy({ consent: data as Consent });
  return data as Consent;
}
