import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Consent, Profile } from "@/lib/daymark";

const rpc = vi.fn();
const upload = vi.fn();
const push = vi.fn();
const loadPunches = vi.fn();
let consent: Consent;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc, storage: { from: () => ({ upload }) } }),
}));
vi.mock("@/lib/punches", () => ({ loadPunches: (...args: unknown[]) => loadPunches(...args), selfieUrl: vi.fn() }));
vi.mock("@/lib/browser-session", () => ({
  // A settled thenable, so React's use() reads it without suspending.
  sessionConsent: () => Object.assign(Promise.resolve(consent), { status: "fulfilled", value: consent }),
  rememberConsent: vi.fn(),
}));

const { ClockDesk } = await import("@/app/clock/clock-desk");

const intern: Profile = {
  id: "11111111-1111-1111-1111-111111111111",
  login_id: "maya",
  display_name: "Maya Chen",
  contact_email: "maya@dgk.test",
  active: true,
  is_intern: true,
  is_supervisor: false,
  is_admin: false,
  must_change_password: false,
  created_at: "2026-09-25T00:00:00Z",
};

const challenge = {
  challenge_id: "22222222-2222-2222-2222-222222222222",
  event_type: "shift_in",
  gesture: "Hold up three fingers",
  expires_at: "2026-10-14T00:01:30Z",
  photo_path: `${intern.id}/22222222-2222-2222-2222-222222222222.jpg`,
};

const getCurrentPosition = vi.fn();
const getUserMedia = vi.fn();

beforeEach(() => {
  consent = { notice_version: "1.0", notice_acknowledged: true, location: "granted", selfie: "granted" };
  loadPunches.mockResolvedValue([]);
  upload.mockResolvedValue({ error: null });
  getCurrentPosition.mockImplementation((success: PositionCallback) =>
    success({ coords: { latitude: -12.4785, longitude: 130.9855, accuracy: 12 } } as GeolocationPosition),
  );
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
  Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(480);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((done) => done(new Blob(["jpeg"], { type: "image/jpeg" })));
  URL.createObjectURL = vi.fn(() => "blob:selfie");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  rpc.mockReset();
  push.mockReset();
});

describe("ClockDesk", () => {
  test("clock in: challenge, live selfie with the gesture, one location read, upload, punch", async () => {
    rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === "start_clock"
          ? { data: challenge, error: null }
          : { data: { occurred_at: "2026-10-13T23:30:00Z" }, error: null },
      ),
    );
    render(<ClockDesk profile={intern} />);

    expect(await screen.findByText("We'll ask for camera and location for this clock-in only.")).toBeInTheDocument();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Clock in" }));

    expect(rpc).toHaveBeenCalledWith("start_clock", { event_type: "shift_in" });
    expect(await screen.findByRole("heading", { name: "Hold up three fingers" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Take photo" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use photo" }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("clock_punch", expect.anything()));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: true });
    expect(upload).toHaveBeenCalledWith(challenge.photo_path, expect.any(Blob), {
      contentType: "image/jpeg",
      upsert: false,
    });
    expect(rpc).toHaveBeenCalledWith("clock_punch", {
      challenge_id: challenge.challenge_id,
      latitude: -12.4785,
      longitude: 130.9855,
      accuracy_m: 12,
      client_reported_at: expect.any(String),
    });
    await waitFor(() => expect(loadPunches).toHaveBeenCalledTimes(2));
  });

  test("a blocked clock-in shows the database's reason", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "The office is closed on weekends." } });
    render(<ClockDesk profile={intern} />);
    fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The office is closed on weekends.");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  test("missing consent goes to the consent screen", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Choose how you'll clock in first.", hint: "consent" } });
    render(<ClockDesk profile={intern} />);
    fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/consent"));
  });

  test("saying no to location or selfie offers supervisor confirmation instead of the camera", async () => {
    consent = { ...consent, selfie: "refused" };
    render(<ClockDesk profile={intern} />);
    expect(await screen.findByText("Your supervisor confirms you're here")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clock in" })).toBeNull();
  });

  test("offline: a banner, and the button waits for a connection", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<ClockDesk profile={intern} />);
    expect(await screen.findByText("You're offline — clocking needs a connection")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Clock in" })).toBeDisabled();
  });
});
