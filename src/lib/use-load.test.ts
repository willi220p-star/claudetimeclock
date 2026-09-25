import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useLoad, useOnline } from "@/lib/use-load";

describe("useLoad", () => {
  test("loading, then the data", async () => {
    const load = () => Promise.resolve(42);
    const { result } = renderHook(() => useLoad(load));
    expect(result.current[0]).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current[0]).toEqual({ status: "ready", data: 42 }));
  });

  test("a database error shows its own message, and Try again reloads", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ message: "You're 340 m from the office. Move closer to clock in." })
      .mockResolvedValueOnce("ok");
    const { result } = renderHook(() => useLoad(load));
    await waitFor(() =>
      expect(result.current[0]).toEqual({
        status: "error",
        message: "You're 340 m from the office. Move closer to clock in.",
      }),
    );
    act(() => result.current[1]());
    expect(result.current[0]).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current[0]).toEqual({ status: "ready", data: "ok" }));
  });
});

describe("useOnline", () => {
  test("follows the browser's online and offline events", () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(true);
    onLine.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe(false);
    onLine.mockRestore();
  });
});
