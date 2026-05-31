/* ================================================================
   DATACAMP — SERVICE WORKER v2.0
   Estratègia: Cache-First amb Network Fallback
   
   FLUX DE FUNCIONAMENT:
   1. install  → pre-cacheja tots els recursos crítics (APP SHELL)
   2. activate → neteja caches antics
   3. fetch    → serveix des de cache si existeix; si no, xarxa;
                 si tampoc hi ha xarxa, fallback offline.html
   ================================================================ */

const CACHE_NAME    = 'datacamp-v2';
const BASE          = '/DataCamp/';        // GitHub Pages subfolder — no canviar
const OFFLINE_URL   = BASE + 'offline.html';

/* ────────────────────────────────────────────────────────────────
   APP SHELL — recursos a pre-cachear en el primer install.
   Rutes absolutes amb el prefix /DataCamp/ per a GitHub Pages.
   ──────────────────────────────────────────────────────────────── */
const APP_SHELL = [
    /* ── Fitxers principals ──────────────────────────── */
    BASE + 'datacamp.html',
    BASE + 'manifest.json',
    BASE + 'offline.html',
    BASE,                                  // captura també la URL arrel del subfolder

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

/* ────────────────────────────────────────────────────────────────
   INSTALL — pre-cacheja l'App Shell
   Si un recurs falla, la instal·lació continua igualment
   (skipWaiting per activar immediatament).
   ──────────────────────────────────────────────────────────────── */
self.addEventListener('install', event => {
    console.log('[SW] install');
    event.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
            /* addAll és tot-o-res: preferim instal·lar un a un per
               no fallar si algun recurs opcional no existeix encara. */
            const results = await Promise.allSettled(
                APP_SHELL.map(url =>
                    cache.add(url).catch(err =>
                        console.warn(`[SW] No s'ha pogut pre-cachear: ${url}`, err)
                    )
                )
            );
            const ok  = results.filter(r => r.status === 'fulfilled').length;
            const ko  = results.filter(r => r.status === 'rejected').length;
            console.log(`[SW] Pre-cache: ${ok} OK, ${ko} errors`);
        })
    );
    self.skipWaiting(); // activa immediatament sense esperar tabs tancades
});

/* ────────────────────────────────────────────────────────────────
   ACTIVATE — neteja caches obsolets d'versions anteriors
   ──────────────────────────────────────────────────────────────── */
self.addEventListener('activate', event => {
    console.log('[SW] activate');
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
        ).then(() => self.clients.claim()) // pren el control de totes les tabs obertes
    );
});

/* ────────────────────────────────────────────────────────────────
   FETCH — intercepta totes les peticions de xarxa
   
   Estratègia per tipus de recurs:
   ┌──────────────────────────────────────┬──────────────────────┐
   │ Recurs                               │ Estratègia           │
   ├──────────────────────────────────────┼──────────────────────┤
   │ App Shell (HTML, JS, CSS, fonts)     │ Cache First          │
   │ Tiles OSM (mapa)                     │ Network First + Cache│
   │ ArcGIS API (PKs)                     │ Network Only         │
   │ Altres (analytics, external APIs)   │ Network Only         │
   └──────────────────────────────────────┴──────────────────────┘
   ──────────────────────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    /* ── Ignora peticions no-GET (POST per formularis, etc.) ── */
    if (request.method !== 'GET') return;

    /* ── Ignora peticions chrome-extension i similars ── */
    if (!url.protocol.startsWith('http')) return;

    /* ── ArcGIS API — sempre xarxa, mai cachear ──────────────── */
    if (url.hostname.includes('arcgis.com')) {
        event.respondWith(fetch(request).catch(() => {
            return new Response(JSON.stringify({ features: [], error: { message: 'Offline' } }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            });
        }));
        return;
    }

    /* ── Tiles OpenStreetMap — Network First amb cache ───────── */
    if (url.hostname.includes('tile.openstreetmap.org')) {
        event.respondWith(networkFirstWithCache(request, 'osm-tiles-v1'));
        return;
    }

    /* ── Peticions externes que no volem cachear ─────────────── */
    if (!url.pathname.startsWith('/DataCamp/')) return;

    /* ── App Shell i recursos locals — Cache First ───────────── */
    event.respondWith(cacheFirstWithNetworkFallback(request));
});

/* ────────────────────────────────────────────────────────────────
   ESTRATÈGIA: Cache First amb Network Fallback
   1. Comprova si existeix al cache → retorna immediatament
   2. Si no hi és → intenta xarxa → guarda al cache → retorna
   3. Si tampoc xarxa → retorna offline.html (per HTML) o error
   ──────────────────────────────────────────────────────────────── */
async function cacheFirstWithNetworkFallback(request) {
    const cache    = await caches.open(CACHE_NAME);
    const cached   = await cache.match(request);

    if (cached) {
        /* Retorna des de cache i actualitza en background (Stale-While-Revalidate) */
        revalidateInBackground(request, cache);
        return cached;
    }

    /* No estava al cache — intentem xarxa */
    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.status === 200) {
            /* Guardem al cache per la propera vegada (clona per poder retornar i guardar) */
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (err) {
        /* Sense xarxa i sense cache → fallback */
        console.warn('[SW] Offline i sense cache per:', request.url);

        /* Per peticions de documents HTML, retorna la pàgina offline */
        if (request.destination === 'document') {
            const offlinePage = await cache.match(OFFLINE_URL);
            if (offlinePage) return offlinePage;
        }

        /* Per la resta (imatges, fonts, etc.) retornem un 503 mínim */
        return new Response('Recurs no disponible offline', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' }
        });
    }
}

/* ────────────────────────────────────────────────────────────────
   ESTRATÈGIA: Network First amb cache de suport (tiles OSM)
   Ideal per contingut que canvia amb freqüència però tolera stale.
   ──────────────────────────────────────────────────────────────── */
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
        /* Tile no disponible: retorna un PNG transparent 256x256 */
        return emptyTileResponse();
    }
}

/* ────────────────────────────────────────────────────────────────
   Revalidació en background (sense bloquejar la resposta)
   ──────────────────────────────────────────────────────────────── */
async function revalidateInBackground(request, cache) {
    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
        }
    } catch {
        /* Silent — no cal fer res si falla la revalidació */
    }
}

/* ────────────────────────────────────────────────────────────────
   Tile transparent 256x256 per usar quan no hi ha tiles OSM
   (PNG mínim en base64 — 1x1 transparent escalat per Leaflet)
   ──────────────────────────────────────────────────────────────── */
function emptyTileResponse() {
    /* PNG 1x1 transparent */
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const bytes  = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    return new Response(bytes.buffer, {
        status: 200,
        headers: { 'Content-Type': 'image/png' }
    });
}

/* ────────────────────────────────────────────────────────────────
   MISSATGES DES DE LA APP
   Permet que l'app li demani al SW que actualitzi la cache.
   Ús: navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' })
   ──────────────────────────────────────────────────────────────── */
self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
