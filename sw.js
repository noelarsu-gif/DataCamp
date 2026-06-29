/* ================================================================
   DATACAMP — SERVICE WORKER v4 (Vercel)
   BASE: arrel '/' — Vercel serveix des de l'arrel, no /DataCamp/
   ================================================================ */

const CACHE_NAME    = 'datacamp-v5';
const BASE          = '/';
const OFFLINE_URL   = BASE + 'offline.html';

const APP_SHELL = [
    /* ── Fitxers principals ──────────────────────────── */
    BASE + 'datacamp.html',
    BASE + 'manifest.json',
    BASE + 'offline.html',
    BASE,

    /* ── Seed PKs offline ────────────────────────────── */
    BASE + 'pk_seed.js',

    /* ── Icones PWA ──────────────────────────────────── */
    BASE + 'icon-192.png',
    BASE + 'icon-512.png',

    /* ── Leaflet (CSS + JS) ──────────────────────────── */
    BASE + 'lib/leaflet/leaflet.css',
    BASE + 'lib/leaflet/leaflet.js',
    BASE + 'lib/leaflet/images/marker-icon.png',
    BASE + 'lib/leaflet/images/marker-icon-2x.png',
    BASE + 'lib/leaflet/images/marker-shadow.png',

    /* ── MarkerCluster ───────────────────────────────── */
    BASE + 'lib/leaflet/MarkerCluster.css',
    BASE + 'lib/leaflet/MarkerCluster.Default.css',
    BASE + 'lib/leaflet/leaflet.markercluster.js',

    /* ── jsPDF + autotable ───────────────────────────── */
    BASE + 'lib/jspdf/jspdf.umd.min.js',
    BASE + 'lib/jspdf/jspdf.plugin.autotable.min.js',

    /* ── SheetJS (xlsx) ──────────────────────────────── */
    BASE + 'lib/xlsx/xlsx.full.min.js',

    /* ── JSZip ───────────────────────────────────────── */
    BASE + 'lib/jszip/jszip.min.js',

    /* ── SortableJS ──────────────────────────────────── */
    BASE + 'lib/sortable/Sortable.min.js',

    /* ── Logo Generalitat (GitHub raw — precachejat per offline) ── */
    'https://raw.githubusercontent.com/noelarsu-gif/DataCamp/main/territori_h3.png',

    /* ── Fonts locals ────────────────────────────────── */
    BASE + 'fonts/barlow.css',
    BASE + 'fonts/barlow-condensed.css',
    BASE + 'fonts/Barlow-Light.woff2',
    BASE + 'fonts/Barlow-Regular.woff2',
    BASE + 'fonts/Barlow-Italic.woff2',
    BASE + 'fonts/Barlow-Medium.woff2',
    BASE + 'fonts/Barlow-SemiBold.woff2',
    BASE + 'fonts/Barlow-Bold.woff2',
    BASE + 'fonts/Barlow-Black.woff2',
    BASE + 'fonts/BarlowCondensed-SemiBold.woff2',
    BASE + 'fonts/BarlowCondensed-Bold.woff2',
    BASE + 'fonts/BarlowCondensed-Black.woff2',
];

/* ── INSTALL ─────────────────────────────────────────────────── */
self.addEventListener('install', event => {
    console.log('[SW] install v4');
    event.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
            const results = await Promise.allSettled(
                APP_SHELL.map(url =>
                    cache.add(url).catch(err =>
                        console.warn(`[SW] No s'ha pogut pre-cachear: ${url}`, err)
                    )
                )
            );
            const ok = results.filter(r => r.status === 'fulfilled').length;
            const ko = results.filter(r => r.status === 'rejected').length;
            console.log(`[SW] Pre-cache: ${ok} OK, ${ko} errors`);
        })
    );
    self.skipWaiting();
});

/* ── ACTIVATE ────────────────────────────────────────────────── */
self.addEventListener('activate', event => {
    console.log('[SW] activate v4');
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => {
                        console.log('[SW] Eliminant cache antic:', key);
                        return caches.delete(key);
                    })
            )
        ).then(() => self.clients.claim())
    );
});

/* ── FETCH ───────────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    if (request.method !== 'GET') return;
    if (!url.protocol.startsWith('http')) return;

    /* ArcGIS — sempre xarxa */
    if (url.hostname.includes('arcgis.com')) {
        event.respondWith(fetch(request).catch(() =>
            new Response(JSON.stringify({ features: [], error: { message: 'Offline' } }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            })
        ));
        return;
    }

    /* Tiles OSM — Network First */
    if (url.hostname.includes('tile.openstreetmap.org')) {
        event.respondWith(networkFirstWithCache(request, 'osm-tiles-v1'));
        return;
    }

    /* GitHub raw (logo Generalitat i altres assets externs precachejats) — Cache First */
    if (url.hostname === 'raw.githubusercontent.com') {
        event.respondWith(cacheFirstWithNetworkFallback(request));
        return;
    }

    /* Recursos externs (altres dominis) — ignora */
    if (url.hostname !== self.location.hostname) return;

    /* Tot el reste del mateix domini (Vercel) — Cache First */
    event.respondWith(cacheFirstWithNetworkFallback(request));
});

/* ── ESTRATÈGIES ─────────────────────────────────────────────── */
async function cacheFirstWithNetworkFallback(request) {
    const cache  = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);

    if (cached) {
        revalidateInBackground(request, cache);
        return cached;
    }

    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (err) {
        console.warn('[SW] Offline i sense cache per:', request.url);
        if (request.destination === 'document') {
            const offlinePage = await cache.match(OFFLINE_URL);
            if (offlinePage) return offlinePage;
        }
        return new Response('Recurs no disponible offline', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' }
        });
    }
}

async function networkFirstWithCache(request, cacheName) {
    const cache = await caches.open(cacheName);
    try {
        const networkResponse = await fetch(request, { signal: AbortSignal.timeout(5000) });
        if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        return emptyTileResponse();
    }
}

async function revalidateInBackground(request, cache) {
    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
        }
    } catch { /* silenciós */ }
}

function emptyTileResponse() {
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const bytes  = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    return new Response(bytes.buffer, {
        status: 200,
        headers: { 'Content-Type': 'image/png' }
    });
}

/* ── MISSATGES ───────────────────────────────────────────────── */
self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
