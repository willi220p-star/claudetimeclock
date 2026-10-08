"use client";

import type { ClockAction } from "@/lib/daymark";

/**
 * Offline clocks (Dilip, 8 Oct; D35). With no signal the phone keeps each clock (its own time, GPS,
 * a selfie with a phone-picked gesture) and sends it when back online; the supervisor confirms it.
 * Items live in IndexedDB on this phone only and are deleted once sent.
 */
export type QueuedClock = {
  id: string; // also the selfie's file name and the server's offline_id
  userId: string;
  kind: "clock";
  action: ClockAction;
  occurredAt: string; // the phone's time
  latitude: number;
  longitude: number;
  accuracy: number;
  gesture: string;
  photo: Blob;
  dayKind: string | null; // the day's Full day / Work-based pick, sent with the first clock-in
};

export type QueuedLog = { id: string; userId: string; kind: "log"; occurredAt: string; workDate: string; summary: string };

/** A time typed in for a missed step ("when did you get here?"), sent as report_missed_time. */
export type QueuedTyped = {
  id: string;
  userId: string;
  kind: "typed";
  occurredAt: string;
  event: "shift_in" | "break_end";
  atTime: string; // HH:MM, Darwin
  note: string | null;
};

export type QueuedItem = QueuedClock | QueuedLog | QueuedTyped;

type ClockState = "out" | "in" | "break";

/** Same list as the server's live challenge (private.start_clock). */
export const GESTURES = [
  "Hold up three fingers",
  "Give a thumbs up",
  "Touch your left ear",
  "Touch your right ear",
  "Hold up two fingers",
  "Put your hand flat under your chin",
  "Point at the camera",
  "Wave with an open hand",
];

export function nextGesture(random = Math.random) {
  return GESTURES[Math.floor(random() * GESTURES.length) % GESTURES.length];
}

/** Home's state after the clocks still waiting on this phone. */
export function applyQueue(state: ClockState, items: QueuedItem[]): ClockState {
  return [...items]
    .sort(byTime)
    .reduce<ClockState>((current, item) => {
      if (item.kind === "log") return current;
      if (item.kind === "typed") return "in";
      return item.action === "break_start" ? "break" : item.action === "shift_out" ? "out" : "in";
    }, state);
}

/** Send in the order they happened; at the same moment a typed time, then a work log, go before the clock. */
const RANK = { typed: 0, log: 1, clock: 2 } as const;
export function byTime(a: QueuedItem, b: QueuedItem) {
  return a.occurredAt.localeCompare(b.occurredAt) || RANK[a.kind] - RANK[b.kind];
}

// ---------------------------------------------------------------------------
// IndexedDB (no library): one store, keyed by id.
// ---------------------------------------------------------------------------
const DB = "dgk-clock";
const STORE = "queue";
const listeners = new Set<() => void>();

function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

function changed() {
  for (const listener of listeners) listener();
}

export async function addToQueue(item: QueuedItem) {
  await run("readwrite", (store) => store.put(item));
  changed();
}

export async function listQueue(userId: string): Promise<QueuedItem[]> {
  if (typeof indexedDB === "undefined") return [];
  const all = await run<QueuedItem[]>("readonly", (store) => store.getAll());
  return all.filter((item) => item.userId === userId).sort(byTime);
}

export async function removeFromQueue(id: string) {
  await run("readwrite", (store) => store.delete(id));
  changed();
}

export function onQueueChange(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
