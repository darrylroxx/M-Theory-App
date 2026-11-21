// M-Theory service worker: makes the app work offline after the first visit.
const CACHE = "m-theory-v2";
// Instrument recordings (keys/…) live in caches of their own, which an app update leaves alone: the
// piano is about 19 MB and should download once, not again with every new version of the app.
const SAMPLES = "m-theory-samples-v1";
const KEEP = (name) => name === CACHE || name.startsWith("m-theory-samples-");

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "./index.html", "./icon.svg", "./manifest.webmanifest"])));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !KEEP(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

/** Is this a file of an instrument's sample pack? */
const isSample = (url) => url.pathname.includes("/keys/");

/**
 * A pack's manifest: from the network when there is one (so a changed pack is seen), else the copy
 * kept. Each recording is asked for as `file?v=<its hash>`, so a fresh manifest names exactly the
 * recordings it needs: any other kept for that pack is from an older version and is let go.
 */
function manifest(req) {
  return fetch(req)
    .then(async (res) => {
      if (!res.ok) return res;
      const cache = await caches.open(SAMPLES);
      await cache.put(req, res.clone());
      prune(cache, req.url, await res.clone().json()).catch(() => {});
      return res;
    })
    .catch(() => caches.open(SAMPLES).then((c) => c.match(req)).then((hit) => hit || Response.error()));
}

async function prune(cache, manifestUrl, m) {
  const base = manifestUrl.slice(0, manifestUrl.lastIndexOf("/") + 1);
  const want = new Set();
  for (const f of [...(m.samples || []), ...(m.releases || []), m.probe].filter(Boolean)) want.add(base + f.file + (f.sha ? `?v=${f.sha}` : ""));
  for (const f of m.files || []) want.add(base + f.file + (f.sha ? `?v=${f.sha}` : ""));
  for (const req of await cache.keys()) {
    if (req.url.startsWith(base) && req.url !== manifestUrl && !want.has(req.url)) await cache.delete(req);
  }
}

/** A recording: names carry their version, so a kept copy is always right. */
function sample(req) {
  return caches.open(SAMPLES).then((cache) =>
    cache.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          // only whole files (a 206 is part of one)
          if (res.status === 200) cache.put(req, res.clone());
          return res;
        }),
    ),
  );
}

// Network first for pages (so updates arrive), cache first for hashed assets.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (isSample(url)) {
    e.respondWith(url.pathname.endsWith("/manifest.json") ? manifest(req) : sample(req));
    return;
  }
  const isPage = req.mode === "navigate";
  if (isPage) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("./index.html"))),
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
