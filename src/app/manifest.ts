import type { MetadataRoute } from "next";
import { BASE_PATH, PAGE_BACKGROUND } from "@/lib/brand";

// Rendered to a file at build time for the static export.
export const dynamic = "force-static";

/** §11.5 PWA: manifest and icons only, no service worker. Icons come from scripts/icons.mjs. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DGK Clock",
    short_name: "DGK Clock",
    description: "Clock in and track your placement hours at DGK Business Consultancy.",
    id: `${BASE_PATH}/`,
    start_url: `${BASE_PATH}/`,
    scope: `${BASE_PATH}/`,
    display: "standalone",
    background_color: PAGE_BACKGROUND,
    theme_color: PAGE_BACKGROUND,
    icons: [
      { src: `${BASE_PATH}/icons/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${BASE_PATH}/icons/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${BASE_PATH}/icons/maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
