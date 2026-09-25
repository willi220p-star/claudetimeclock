import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

const previewRequest = vi.fn();
const rpc = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/data", () => ({
  previewRequest: (...args: unknown[]) => previewRequest(...args),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc }),
}));

const { RequestForm } = await import("@/components/request-form");

describe("RequestForm", () => {
  test("disables submit with the preview message while the request is not ok", async () => {
    previewRequest.mockResolvedValue({
      ok: false,
      message: "That day is already full.",
      needs_extra_spot: false,
      dates: [],
      effects: [],
      capacity: [],
    });
    render(
      <RequestForm
        initialType="extra_day"
        initialFields={{ date: "2026-10-16", start: "09:00", end: "17:00" }}
      />,
    );
    await waitFor(() => expect(previewRequest).toHaveBeenCalledWith({
      type: "extra_day",
      payload: { date: "2026-10-16", start: "09:00", end: "17:00" },
      reason: undefined,
    }));
    expect(await screen.findByRole("button", { name: "That day is already full." })).toBeDisabled();
  });
});
