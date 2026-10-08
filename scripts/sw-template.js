/* DGK Clock service worker (D34). Built by scripts/sw.mjs into out/sw.js for the Pages export.
 * - The app's own files are cached so DGK Clock opens with no signal.
 * - Supabase (data, sign-in, selfies) is never cached: it isn't same-origin, so this worker ignores it.
 * - Pages are network-first (fresh when online), falling back to the saved copy offline.
 * ponytail: hand-written instead of Serwist to avoid @swc/core + esbuild for one file; upgrade path is
 * @serwist/turbopack if routing rules grow.
 */
const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const BASE = "__BASE__";
const CACHE = `dgk-clock-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("dgk-clock-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// The page shows "New version ready"; tapping Reload activates this worker.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;

  // Content-hashed build files never change: cache first.
  if (url.pathname.startsWith(`${BASE}_next/static/`)) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
    return;
  }

  // Pages and their data: network first, the saved copy when offline.
  event.respondWith(
    fetch(request).catch(async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(request, { ignoreSearch: true });
      if (hit) return hit;
      if (request.mode === "navigate") return (await cache.match(BASE)) || Response.error();
      return Response.error();
    }),
  );
});

// Push reminders (D36): show the notification; a tap opens or focuses DGK Clock on its page.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "DGK Clock", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "DGK Clock", {
      body: data.body || "",
      icon: `${BASE}icons/icon-192.png`,
      badge: `${BASE}icons/icon-192.png`,
      data: { link: data.link || "/notifications" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/notifications";
  // Only paths inside the app: the link comes from our own notification table.
  const target = new URL(BASE.replace(/\/$/, "") + (link.startsWith("/") ? link : "/notifications"), self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url.startsWith(self.location.origin + BASE));
      if (open) return open.focus().then((client) => client.navigate(target));
      return self.clients.openWindow(target);
    }),
  );
});
