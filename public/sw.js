const CACHE_VERSION = "thinkmark-static-v1";
const APP_SHELL_URL = "/offline.html";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  APP_SHELL_URL,
  "/style.css",
  "/app.js",
  "/manifest.webmanifest",
  "/tab_logo.png",
  "/thinkmark_logo.png",
  "/thinkmark_logo_for_dark_theme.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-192.png",
  "/icons/maskable-512.png"
];

const isStaticAsset = (url) => {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;

  return STATIC_ASSETS.includes(url.pathname) || STATIC_ASSETS.includes(`${url.pathname}${url.search}`);
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(
        STATIC_ASSETS.map((asset) => new Request(asset, { cache: "reload" }))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match("/index.html")) || cache.match(APP_SHELL_URL);
      })
    );
    return;
  }

  if (request.method !== "GET" || !isStaticAsset(url)) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
