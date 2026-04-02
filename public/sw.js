const CACHE_VERSION = "v3.2.2";
const CACHE_NAME = `qr-doorbell-${CACHE_VERSION}`;
const OFFLINE_URL = "offline.html";

const APP_SHELL = [
  "./",
  "index.html",
  "owner.html",
  OFFLINE_URL,
  "config.js",
  "manifest.json",
  "css/main.css",
  "css/components.css",
  "js/utils.js",
  "js/i18n.js",
  "js/crypto.js",
  "js/guest.js",
  "js/auth.js",
  "js/app.js",
  "js/owner-bootstrap.js",
  "icons/icon-192x192.png",
  "icons/icon-512x512.png",
  "icons/icon-maskable-192x192.png",
  "icons/icon-maskable-512x512.png",
  "favicon.ico"
];

const CDN_PREFIXES = [
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
  "https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js",
  "https://fonts.googleapis.com/",
  "https://fonts.gstatic.com/"
];

function isCDNAsset(url) {
  return CDN_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function isCacheableStaticAsset(request) {
  return request.destination === "style" ||
    request.destination === "script" ||
    request.destination === "image" ||
    request.destination === "font" ||
    request.url.endsWith(".json");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  /* Only intercept selected third-party CDN assets */
  if (url.origin !== self.location.origin) {
    if (isCDNAsset(request.url)) {
      event.respondWith(networkFirst(request));
    }
    return;
  }

  /* App navigation: prefer fresh network, fallback to cached page/offline shell */
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match(OFFLINE_URL))
    );
    return;
  }

  /* Static local assets: stale-while-revalidate */
  if (isCacheableStaticAsset(request)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  /* Default: network first with cache fallback */
  event.respondWith(networkFirst(request));
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || networkPromise || new Response("Offline", { status: 503, statusText: "Service Unavailable" });
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      return caches.match(OFFLINE_URL);
    }
    return new Response("Offline", { status: 503, statusText: "Service Unavailable" });
  }
}

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {}

  const title = data.title || "QR Doorbell";
  const options = {
    body: data.body || "New visitor at your door",
    icon: "icons/icon-192x192.png",
    badge: "icons/icon-maskable-192x192.png",
    tag: data.tag || "doorbell-ring",
    renotify: true,
    actions: [
      { action: "view", title: "View" },
      { action: "dismiss", title: "Dismiss" }
    ],
    data: { url: data.url || "owner.html" }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "view" || !event.action) {
    event.waitUntil(clients.openWindow(event.notification.data.url || "owner.html"));
  }
});
