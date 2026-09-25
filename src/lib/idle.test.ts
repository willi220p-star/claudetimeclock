import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { idleMessage, startIdleTimer } from "@/lib/idle";

const MIN = 60_000;

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("idle sign-out timer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  test("fires once after the limit with no activity", () => {
    const onIdle = vi.fn();
    startIdleTimer(30 * MIN, onIdle);
    vi.advanceTimersByTime(30 * MIN - 1);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60 * MIN);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  test("pointer, key and touch activity push the limit back", () => {
    const onIdle = vi.fn();
    startIdleTimer(30 * MIN, onIdle);
    vi.advanceTimersByTime(20 * MIN);
    document.dispatchEvent(new Event("pointerdown"));
    vi.advanceTimersByTime(20 * MIN);
    document.dispatchEvent(new Event("keydown"));
    vi.advanceTimersByTime(29 * MIN);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1 * MIN);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  test("a phone that slept past the limit signs out when the page is shown again", () => {
    const onIdle = vi.fn();
    startIdleTimer(30 * MIN, onIdle);
    setVisibility("hidden");
    vi.setSystemTime(Date.now() + 45 * MIN); // the clock moved but paused timers did not run
    expect(onIdle).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  test("showing the page before the limit counts as activity", () => {
    const onIdle = vi.fn();
    startIdleTimer(30 * MIN, onIdle);
    vi.advanceTimersByTime(25 * MIN);
    setVisibility("visible");
    vi.advanceTimersByTime(25 * MIN);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5 * MIN);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  test("stop removes the timer and listeners", () => {
    const onIdle = vi.fn();
    const stop = startIdleTimer(30 * MIN, onIdle);
    stop();
    vi.advanceTimersByTime(60 * MIN);
    setVisibility("visible");
    expect(onIdle).not.toHaveBeenCalled();
  });

  test("message names the minutes", () => {
    expect(idleMessage(30)).toBe("You were signed out after 30 minutes of inactivity.");
  });
});
