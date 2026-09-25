import { expect, moveTo, OFFICE, test } from "./fixtures";

test("the sign-in page loads with the logo and an Email field, without console errors", async ({
  page,
  consoleErrors,
}) => {
  await page.goto("/");
  await expect(page.getByRole("img", { name: "DGK Business Consultancy" })).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test.describe("device stubs", () => {
  test.beforeEach(async ({ page }) => {
    // A blank page on the app's origin: getUserMedia needs a secure context and the grants are per origin.
    await page.route("**/__e2e_blank", (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><title>blank</title>" }),
    );
    await page.goto("/__e2e_blank");
  });

  test("the fake camera gives a live video track", async ({ page }) => {
    const tracks = await page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const video = stream.getVideoTracks().map((track) => ({ kind: track.kind, state: track.readyState }));
      stream.getTracks().forEach((track) => track.stop());
      return video;
    });
    expect(tracks).toEqual([{ kind: "video", state: "live" }]);
  });

  test("geolocation returns the office, and moveTo moves it north", async ({ page }) => {
    const position = () =>
      page.evaluate(
        () =>
          new Promise<{ latitude: number; longitude: number; accuracy: number }>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(
              ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }),
              reject,
            ),
          ),
      );

    expect(await position()).toEqual(OFFICE);

    await moveTo(page, 200);
    const moved = await position();
    expect(moved.longitude).toBe(OFFICE.longitude);
    // Haversine on the 6,371 km sphere, as the database measures it.
    const metres = 6_371_000 * ((moved.latitude - OFFICE.latitude) * Math.PI) / 180;
    expect(metres).toBeCloseTo(200, 1);
  });
});
