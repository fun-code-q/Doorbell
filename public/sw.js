// QR Doorbell — Service Worker (v3 guest-only)
//
// Design notes:
//   * CACHE_VERSION is rewritten by `scripts/bump-sw-version.mjs` to a content
//     hash of the public/ tree on each `npm run build`. No more "I forgot to
//     bump v3.2.8".
//   * APP_SHELL contains ONLY guest assets. The owner web SPA has been
//     archived; pre-caching it on the guest URL would have leaked admin UI
//     to shared-device visitors.
//   * `self.skipWaiting()` is NOT called on install. The page receives a
//     `controllerchange` event and shows an "Update available — Reload" toast;
//     the user controls when to swap. This avoids torn states (old tab loaded
//     old JS, new SW serves new HTML, hashed assets 404).
//   * `config.js` is served network-first so a deploy that changes the
//     Supabase URL is picked up immediately instead of being locked in a stale
//     cache for everyone.

const CACHE_VERSION = "v3.0.0";
const CACHE_NAME    = `qr-doorbell-${CACHE_VERSION}`;
const CACHE_PREFIX  = "qr-doorbell-";
const OFFLINE_URL   = "offline.html";

const APP_SHELL = [
    "./",
    "index.html",
    OFFLINE_URL,
    "manifest.json",
    "css/main.css",
    "css/components.css",
    "js/utils.js",
    "js/i18n.js",
    "js/crypto.js",
    "js/guest.js",
    "icons/icon-192x192.png",
    "icons/icon-512x512.png",
    "icons/icon-maskable-192x192.png",
    "icons/icon-maskable-512x512.png",
    "favicon.ico",
    "favicon.svg",
];

// Allow CDN assets to be cached if hit at runtime, but never as part of the
// install step (offline-first must not require network on first run).
const CDN_RUNTIME_PREFIXES = [
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@",
    "https://cdn.jsdelivr.net/gh/jedisct1/libsodium.js@",
    "https://fonts.googleapis.com/",
    "https://fonts.gstatic.com/",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            cache.addAll(APP_SHELL).catch((err) => {
                console.warn("[sw] precache partial failure", err);
            })
        )
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            const keys = await caches.keys();
            await Promise.all(
                keys
                    .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
                    .map((k) => caches.delete(k))
            );
            await self.clients.claim();
        })()
    );
});

function isApiRequest(url) {
    return (
        url.hostname.endsWith(".supabase.co") ||
        url.hostname.endsWith(".functions.supabase.co") ||
        url.hostname === "challenges.cloudflare.com"
    );
}

function isCdnAsset(url) {
    return CDN_RUNTIME_PREFIXES.some((p) => url.href.startsWith(p));
}

self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;

    const url = new URL(req.url);

    // Network-first for live data + Turnstile + config.
    if (isApiRequest(url) || url.pathname.endsWith("/config.js")) {
        event.respondWith(
            fetch(req).catch(() => caches.match(req))
        );
        return;
    }

    // Navigations: network first, fall back to cached index, then offline page.
    if (req.mode === "navigate") {
        event.respondWith(
            (async () => {
                try {
                    const fresh = await fetch(req);
                    return fresh;
                } catch (_) {
                    const cached = await caches.match("index.html");
                    return cached || (await caches.match(OFFLINE_URL));
                }
            })()
        );
        return;
    }

    // CDN assets: stale-while-revalidate.
    if (isCdnAsset(url)) {
        event.respondWith(
            (async () => {
                const cache = await caches.open(CACHE_NAME);
                const cached = await cache.match(req);
                const networkPromise = fetch(req)
                    .then((res) => {
                        if (res && res.ok) cache.put(req, res.clone());
                        return res;
                    })
                    .catch(() => null);
                return cached || (await networkPromise) || new Response("", { status: 504 });
            })()
        );
        return;
    }

    // Same-origin: cache-first with background refresh.
    event.respondWith(
        (async () => {
            const cached = await caches.match(req);
            if (cached) {
                fetch(req).then((res) => {
                    if (res && res.ok && res.type === "basic") {
                        caches.open(CACHE_NAME).then((c) => c.put(req, res.clone()));
                    }
                }).catch(() => {});
                return cached;
            }
            try {
                const res = await fetch(req);
                if (res.ok && res.type === "basic") {
                    const cache = await caches.open(CACHE_NAME);
                    cache.put(req, res.clone());
                }
                return res;
            } catch (_) {
                return (await caches.match(OFFLINE_URL)) || new Response("", { status: 504 });
            }
        })()
    );
});

self.addEventListener("message", (event) => {
    if (event.data === "SKIP_WAITING") self.skipWaiting();
});
