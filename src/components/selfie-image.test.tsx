import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { SelfieImage } from "@/components/selfie-image";

const signSelfies = vi.fn();
vi.mock("@/lib/punches", () => ({ signSelfies: (...args: unknown[]) => signSelfies(...args) }));

describe("SelfieImage", () => {
  test("an expired link is re-signed once, then a missing file reads Photo removed", async () => {
    signSelfies.mockResolvedValueOnce(new Map([["a.jpg", "https://fresh"]]));
    const { container } = render(<SelfieImage path="a.jpg" url="https://expired" />);
    fireEvent.error(container.querySelector("img")!);
    await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toBe("https://fresh"));
    expect(signSelfies).toHaveBeenCalledWith(["a.jpg"]);
    fireEvent.error(container.querySelector("img")!);
    expect(screen.getByRole("img", { name: "Photo removed" })).toBeTruthy();
    expect(signSelfies).toHaveBeenCalledTimes(1);
  });

  test("no link at all reads Photo removed", () => {
    render(<SelfieImage path="gone.jpg" url={null} />);
    expect(screen.getByText("Photo removed")).toBeTruthy();
  });
});
