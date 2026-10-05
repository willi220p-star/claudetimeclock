import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Consent, Profile } from "@/lib/daymark";

const rpc = vi.fn();
const upload = vi.fn();
const push = vi.fn();
const loadPunches = vi.fn();
let consent: Consent;

function extraRpc(name: string, fallback: { data: unknown; error: unknown }) {
  if (name === "clock_status") {
    return Promise.resolve({
      data: { next_event: "shift_in", blocked: null, block_code: null, scheduled: null, placement: { id: intern.id, read_only: false } },
      error: null,
    });
  }
  if (name === "kpi_intern") {
    return Promise.resolve({
      data: {
        placement_id: intern.id,
        days_late: 0,
        week_no: 1,
        total_weeks: 13,
        owed: 0,
        this_week: { counted: 0, scheduled: 450 },
      },
      error: null,
    });
  }
  if (name === "today_board") {
    return Promise.resolve({ data: { label: "1/3", people: [] }, error: null });
  }
  return Promise.resolve(fallback);
}

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc, storage: { from: () => ({ upload }) } }),
}));
vi.mock("@/lib/punches", () => ({ loadPunches: (...args: unknown[]) => loadPunches(...args), selfieUrl: vi.fn() }));
const loadClockStatus = vi.fn();
vi.mock("@/lib/data", () => ({
  loadClockStatus: (...args: unknown[]) => loadClockStatus(...args),
  loadInternKpi: vi.fn().mockResolvedValue(null),
  loadTodayBoard: vi.fn().mockResolvedValue(null),
  loadNotifications: vi.fn().mockResolvedValue([]),
  loadScheduledDays: vi.fn().mockResolvedValue([]),
}));
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

const site = { name: "Regus Palmerston", latitude: -12.4785082, longitude: 130.9854825, radius_m: 200 };
const placement = { id: "33333333-3333-3333-3333-333333333333", read_only: false };

beforeEach(() => {
  consent = { notice_version: "1.2", notice_acknowledged: true, location: "granted", selfie: "granted" };
  loadPunches.mockResolvedValue([]);
  loadClockStatus.mockResolvedValue({ state: "out", actions: { shift_in: null }, blocked: null, site, placement });
  rpc.mockImplementation((name: string) => extraRpc(name, { data: null, error: null }));
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

async function openSheet(button: string) {
  fireEvent.click(await screen.findByRole("button", { name: button }));
  return within(await screen.findByRole("dialog"));
}

describe("ClockDesk", () => {
  test("clock in: the sheet reads the location once, then challenge, live selfie with the gesture, upload, punch", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "start_clock") return Promise.resolve({ data: challenge, error: null });
      if (name === "clock_punch") return Promise.resolve({ data: { occurred_at: "2026-10-13T23:30:00Z" }, error: null });
      return extraRpc(name, { data: null, error: null });
    });
    render(<ClockDesk profile={intern} />);

    expect(await screen.findByText("You're not clocked in.")).toBeInTheDocument();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    const sheet = await openSheet("Clock in");
    expect(await sheet.findByText(/from Regus Palmerston/)).toBeInTheDocument();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: true });
    expect(sheet.getByRole("radio", { name: "Start" })).toHaveAttribute("aria-checked", "true");
    expect(sheet.getByRole("radio", { name: "Break" })).toBeDisabled();

    await waitFor(() => expect(sheet.getByRole("button", { name: "Clock in" })).toBeEnabled());
    fireEvent.click(sheet.getByRole("button", { name: "Clock in" }));
    expect(rpc).toHaveBeenCalledWith("start_clock", { event_type: "shift_in" });
    expect(await sheet.findByText("Hold up three fingers")).toBeInTheDocument();
    fireEvent.click(await sheet.findByRole("button", { name: "Take photo" }));
    fireEvent.click(await sheet.findByRole("button", { name: "Use photo" }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("clock_punch", expect.anything()));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
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
    rpc.mockImplementation((name: string) => {
      if (name === "start_clock") {
        return Promise.resolve({
          data: null,
          error: { message: "You've reached your target hours. Your supervisor will confirm what happens next." },
        });
      }
      return extraRpc(name, { data: null, error: null });
    });
    render(<ClockDesk profile={intern} />);
    const sheet = await openSheet("Clock in");
    await waitFor(() => expect(sheet.getByRole("button", { name: "Clock in" })).toBeEnabled());
    fireEvent.click(sheet.getByRole("button", { name: "Clock in" }));
    expect(await sheet.findByRole("alert")).toHaveTextContent(
      "You've reached your target hours. Your supervisor will confirm what happens next.",
    );
  });

  test("missing consent goes to the consent screen", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "start_clock") {
        return Promise.resolve({ data: null, error: { message: "Allow location and selfie to clock in.", hint: "consent" } });
      }
      return extraRpc(name, { data: null, error: null });
    });
    render(<ClockDesk profile={intern} />);
    const sheet = await openSheet("Clock in");
    await waitFor(() => expect(sheet.getByRole("button", { name: "Clock in" })).toBeEnabled());
    fireEvent.click(sheet.getByRole("button", { name: "Clock in" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/consent"));
  });

  test("saying no to location or selfie means no clocking, and points back to the consent screen", async () => {
    consent = { ...consent, selfie: "refused" };
    render(<ClockDesk profile={intern} />);
    expect(await screen.findByText("Allow location and selfie to clock in")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review and allow" })).toHaveAttribute("href", "/consent");
    expect(screen.queryByRole("button", { name: "Clock in" })).toBeNull();
    expect(screen.queryByText(/supervisor/i)).toBeNull();
  });

  test("clocked in at break time: Start break and Clock out", async () => {
    loadPunches.mockResolvedValue([
      { id: "p1", event_type: "shift_in", occurred_at: new Date(Date.now() - 3_600_000).toISOString(), is_break: false, photoUrl: null, flags: [] },
    ]);
    loadClockStatus.mockResolvedValue({ state: "in", actions: { break_start: null, shift_out: null }, blocked: null, site, placement });
    render(<ClockDesk profile={intern} />);
    expect(await screen.findByRole("button", { name: "Start break" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clock out" })).toBeInTheDocument();
  });

  test("Finish asks for the day's work log first, then clocks out", async () => {
    loadPunches.mockResolvedValue([
      { id: "p1", event_type: "shift_in", occurred_at: new Date(Date.now() - 3_600_000).toISOString(), is_break: false, photoUrl: null, flags: [] },
    ]);
    loadClockStatus.mockResolvedValue({
      state: "in",
      actions: { break_start: "Breaks start between 10 am and 2 pm.", shift_out: "Write your work log for Mon 12 Oct to clock out." },
      open_work_date: "2026-10-12",
      blocked: null,
      site,
      placement,
    });
    rpc.mockImplementation((name: string) => {
      if (name === "start_clock") return Promise.resolve({ data: { ...challenge, event_type: "shift_out" }, error: null });
      return extraRpc(name, { data: {}, error: null });
    });
    render(<ClockDesk profile={intern} />);
    expect(screen.queryByRole("button", { name: "Start break" })).toBeNull();
    const sheet = await openSheet("Clock out");
    expect(sheet.getByRole("radio", { name: "Break" })).toBeDisabled();
    expect(sheet.getByText("Breaks start between 10 am and 2 pm.")).toBeInTheDocument();
    await waitFor(() => expect(sheet.getByRole("button", { name: "Clock out" })).toBeEnabled());
    fireEvent.click(sheet.getByRole("button", { name: "Clock out" }));
    fireEvent.change(await sheet.findByLabelText("Work log for Mon 12 Oct"), {
      target: { value: "Built the weekly enquiries dashboard." },
    });
    fireEvent.click(sheet.getByRole("button", { name: "Save log and clock out" }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("save_work_log", { work_date: "2026-10-12", summary: "Built the weekly enquiries dashboard." }),
    );
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("start_clock", { event_type: "shift_out" }));
  });

  test("offline: a banner, and the button waits for a connection", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<ClockDesk profile={intern} />);
    expect(await screen.findByText("You're offline — clocking needs a connection")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Clock in" })).toBeDisabled();
  });
});
