/* ================================================================
   DATACAMP — SERVICE WORKER v6 (Vercel)
   BASE: arrel '/' — Vercel serveix des de l'arrel, no /DataCamp/
   ================================================================ */

const CACHE_NAME    = 'datacamp-v7';
const BASE          = '/';
const OFFLINE_URL   = BASE + 'offline.html';

const APP_SHELL = [
    /* ── Fitxers principals ──────────────────────────── */
    BASE + 'index.html',
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

    /* ── pdf-lib (fitxa oficial d'animals) ───────────── */
    BASE + 'lib/pdflib/pdf-lib.min.js',
    BASE + 'assets/plantilles/incidencia_animal_oficial.pdf',

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

/* Fitxers "shell" que SEMPRE s'han de comprovar contra la xarxa abans
   que contra la cache (perquè és on viu el codi de l'app: si es
   serveixen en Cache First, un usuari pot quedar-se dies veient una
   versió vella encara que ja hagis pujat una de nova al servidor). */
const NETWORK_FIRST_PATHS = [
    BASE,
    BASE + 'index.html',
    BASE + 'manifest.json',
];

/* ── INSTALL ─────────────────────────────────────────────────── */
self.addEventListener('install', event => {
    console.log('[SW] install v6');
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
    console.log('[SW] activate v6');
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

    /* Navegació (l'HTML principal) i el "shell" de l'app — sempre Network First.
       Així, cada cop que obris l'app amb connexió, es demana la versió nova al
       servidor abans que res; si estàs offline, cau a la còpia en cache. */
    const isAppShellDoc = request.mode === 'navigate'
        || request.destination === 'document'
        || NETWORK_FIRST_PATHS.includes(url.pathname);
    if (isAppShellDoc && url.hostname === self.location.hostname) {
        event.respondWith(networkFirstForShell(request));
        return;
    }

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

async function networkFirstForShell(request) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const networkResponse = await fetch(request, { signal: AbortSignal.timeout(5000) });
        if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (err) {
        console.warn('[SW] Xarxa no disponible per al shell, servint cache:', request.url);
        const cached = await cache.match(request);
        if (cached) return cached;
        const offlinePage = await cache.match(OFFLINE_URL);
        if (offlinePage) return offlinePage;
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
