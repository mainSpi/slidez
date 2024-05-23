// Files to cache
const cacheName = 'slidez-v2';
const appShellFiles = [
    '/',
    // '/images/',
    // '/styles/',
    // '/scripts/',

    '/scripts/bootstrap.min.js',
    '/scripts/script.js',
    '/scripts/pdf-lib.js',
    '/scripts/pdf-download.js',
    '/scripts/pdf.mjs',
    '/scripts/pdf.worker.mjs',
    '/scripts/fast-average-color.min.js',

    '/styles/bootstrap.min.css',
    '/styles/bootstrap-icons.css',
    '/styles/bootstrap-icons.woff2',
    '/styles/style.css',

    '/images/logo.png',
    '/images/favicon-16x16.png',
    '/images/favicon-32x32.png',

    '/index.html',
    '/favicon.png'
];

// Installing Service Worker
self.addEventListener('install', (e) => {
    console.log('[Service Worker] Install');
    e.waitUntil((async () => {
        const cache = await caches.open(cacheName);
        console.log('[Service Worker] Caching all: app shell and content');
        await cache.addAll(appShellFiles);
    })());
});

// Fetching content using Service Worker
self.addEventListener('fetch', (e) => {
    // Cache http and https only, skip unsupported chrome-extension:// and file://...
    if (!(
        e.request.url.startsWith('http:') || e.request.url.startsWith('https:')
    )) {
        return;
    }

    e.respondWith((async () => {
        const r = await caches.match(e.request);
        console.log(`[Service Worker] Fetching resource: ${e.request.url}`);
        if (r) return r;
        const response = await fetch(e.request);
        const cache = await caches.open(cacheName);
        console.log(`[Service Worker] Caching new resource: ${e.request.url}`);
        await cache.put(e.request, response.clone());
        return response;
    })());
});