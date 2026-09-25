import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { DayStatusBadge } from "@/components/day-status-badge";
import { DgkLogo } from "@/components/dgk-logo";
import { EffectPreview } from "@/components/effect-preview";
import { EmptyState } from "@/components/empty-state";
import { MetricCard, sparklinePoints } from "@/components/metric-card";
import { MinutesText } from "@/components/minutes-text";
import { bellBadge, NotificationBell } from "@/components/notification-bell";
import { PaceChip, paceOf } from "@/components/pace-chip";
import { ProgressRing, ringPercent } from "@/components/progress-ring";
import { RoleSwitcher } from "@/components/role-switcher";
import { StatusChip } from "@/components/status-chip";
import type { Profile } from "@/lib/daymark";

function person(flags: Partial<Profile>): Profile {
  return {
    id: "p1",
    login_id: "sam",
    display_name: "Sam Lee",
    contact_email: "sam@dgk.test",
    active: true,
    is_intern: false,
    is_supervisor: false,
    is_admin: false,
    must_change_password: false,
    created_at: "2026-09-25T00:00:00Z",
    ...flags,
  };
}

describe("DgkLogo", () => {
  // The logo is the one component allowed raw hex; it must match the brand tokens in globals.css.
  const css = readFileSync("src/app/globals.css", "utf8");
  const token = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`))?.[1];

  test("is an image named for the business, in the brand colours", () => {
    const { container } = render(<DgkLogo />);
    expect(screen.getByRole("img", { name: "DGK Business Consultancy" })).toBeInTheDocument();
    const fills = [...container.querySelectorAll("tspan")].map((letter) => [letter.textContent, letter.getAttribute("fill")]);
    expect(fills).toEqual([
      ["D", token("teal")],
      ["G", token("brand-orange")],
      ["K", token("brand-green")],
    ]);
    expect(container.querySelector("circle")?.getAttribute("stroke")).toBe(token("teal"));
  });
});

describe("StatusChip", () => {
  test.each(["ok", "warn", "bad", "info", "neutral"] as const)("%s has an icon and a label", (tone) => {
    const { container } = render(<StatusChip tone={tone} label="Late" />);
    expect(screen.getByText("Late")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("MetricCard", () => {
  test("shows label, value and sub-line", () => {
    render(<MetricCard label="This week" value="15h" sub="of 22h 30m" tone="warn" />);
    const card = screen.getByRole("heading", { name: "This week" }).closest("section")!;
    expect(within(card).getByText("15h")).toBeInTheDocument();
    expect(within(card).getByText("of 22h 30m")).toHaveClass("text-warn");
  });

  test("sparkline points span the box, highest value at the top", () => {
    expect(sparklinePoints([0, 5, 10], 80, 24)).toBe("0,24 40,12 80,0");
    expect(sparklinePoints([3, 3], 80, 24)).toBe("0,12 80,12");
  });
});

describe("EmptyState", () => {
  test("one sentence and one action", () => {
    render(<EmptyState action={<button type="button">New request</button>}>No requests yet.</EmptyState>);
    expect(screen.getByText("No requests yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New request" })).toBeInTheDocument();
  });
});

describe("ProgressRing", () => {
  test("clamps to 0–100%", () => {
    expect(ringPercent(50, 200)).toBe(25);
    expect(ringPercent(500, 200)).toBe(100);
    expect(ringPercent(-10, 200)).toBe(0);
    expect(ringPercent(10, 0)).toBe(0);
  });

  test("describes its progress", () => {
    render(<ProgressRing counted={120} target={480} />);
    expect(screen.getByRole("img", { name: "25% of target" })).toBeInTheDocument();
  });
});

describe("PaceChip", () => {
  test.each([
    [0, "ok", "On pace"],
    [-2, "ahead", "2 days ahead"],
    [1, "warn", "1 day behind"],
    [5, "warn", "5 days behind"],
    [6, "bad", "6 days behind"],
    [null, "bad", "Can't forecast"],
  ] as const)("%s days late → %s %s", (daysLate, tone, label) => {
    expect(paceOf(daysLate)).toEqual({ tone, label });
  });

  test("renders the label", () => {
    render(<PaceChip daysLate={3} />);
    expect(screen.getByText("3 days behind")).toBeInTheDocument();
  });
});

describe("MinutesText", () => {
  test("owed minutes read plainly", () => {
    render(<MinutesText minutes={450} />);
    expect(screen.getByText("7h 30m")).not.toHaveClass("text-teal-ink");
  });

  test("ahead reads in teal", () => {
    render(<MinutesText minutes={-90} />);
    expect(screen.getByText("1h 30m ahead")).toHaveClass("text-teal-ink");
  });
});

describe("DayStatusBadge", () => {
  test.each([
    ["worked", "Worked"],
    ["no_show", "No-show"],
    ["closure", "Office closed"],
    ["leave", "Leave"],
  ] as const)("%s shows %s with an icon", (status, label) => {
    const { container } = render(<DayStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("EffectPreview", () => {
  test("lists each before → after line", () => {
    render(<EffectPreview effects={[{ label: "Owed", before: "2h 30m", after: "0h" }]} />);
    const line = screen.getByRole("listitem");
    expect(line).toHaveTextContent("Owed2h 30mbecomes0h");
  });
});

describe("RoleSwitcher", () => {
  test("lists only the roles held, linking to each home", () => {
    render(<RoleSwitcher profile={person({ is_intern: true, is_admin: true })} current="admin" />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Admin", "/admin"],
      ["Intern", "/clock"],
    ]);
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Supervisor" })).toBeNull();
  });

  test("renders nothing for a single role", () => {
    const { container } = render(<RoleSwitcher profile={person({ is_intern: true })} current="intern" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("NotificationBell", () => {
  test("names the unread count", () => {
    render(<NotificationBell count={3} />);
    expect(screen.getByRole("img", { name: "Notifications, 3 unread" })).toHaveTextContent("3");
  });

  test("no badge at zero", () => {
    render(<NotificationBell count={0} href="/notifications" />);
    expect(screen.getByRole("link", { name: "Notifications, none unread" })).toHaveTextContent("");
  });

  test("caps the badge at 99+", () => {
    expect(bellBadge(99)).toBe("99");
    expect(bellBadge(150)).toBe("99+");
  });
});
