/* Manifest version:6929a75044b6432c42fd */
self.importScripts('./service-worker-assets.js?v=6929a75044b6432c42fd');
const version = self.assetsManifest.version;
const baseUrl = new URL(self.registration.scope);
const cacheNamePrefix = `personal-life-planner-${self.registration.scope}-`;
const cacheName = `${cacheNamePrefix}${version}`;
const assetUrls = new Set(self.assetsManifest.assets.map(a => new URL(a.url, baseUrl).href));
const offlineInclude = /\.(?:dll|pdb|wasm|html|js|json|css|woff2?|svg|png|jpe?g|gif|ico|blat|dat)$/;

self.addEventListener('install', event => event.waitUntil(install()));
self.addEventListener('activate', event => event.waitUntil(activate()));
self.addEventListener('fetch', event => event.respondWith(respond(event.request)));
self.addEventListener('message', event => {
    if (event.data?.type === 'GET_VERSION') event.ports[0]?.postMessage({ version });
    if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

async function install() {
    try {
        const cache = await caches.open(cacheName);
        await cache.addAll(self.assetsManifest.assets
            .filter(a => offlineInclude.test(a.url) && a.url !== 'service-worker.js')
            .map(a => new Request(new URL(a.url, baseUrl), { integrity: a.hash, cache: 'no-cache' })));
        // Activate only a complete integrity-checked release. Legacy pages otherwise wait forever.
        await self.skipWaiting();
    } catch (error) {
        // Never remove the active release or any user store after a failed candidate install.
        const activeVersion = self.registration.active;
        if (activeVersion?.scriptURL !== self.location.href || !activeVersion)
            await caches.delete(cacheName);
        throw error;
    }
}

async function activate() {
    await self.clients.claim();
    for (const client of await self.clients.matchAll({ type: 'window' }))
        client.postMessage({ type: 'APP_UPDATED', version });
    // Keep previous resource generations for documents which are still open. Only application
    // resource caches under this exact scope are eligible; IndexedDB/localStorage are untouched.
    const ownCaches = (await caches.keys()).filter(name => name.startsWith(cacheNamePrefix) && name !== cacheName);
    await Promise.all(ownCaches.slice(0, Math.max(0, ownCaches.length - 2)).map(name => caches.delete(name)));
}

async function respond(request) {
    if (request.method !== 'GET') return fetch(request);
    const url = new URL(request.url);
    if (url.origin !== baseUrl.origin || !url.pathname.startsWith(baseUrl.pathname)) return fetch(request);
    const canonical = new URL(url.pathname, baseUrl.origin).href;
    const cache = await caches.open(cacheName);
    if (request.mode === 'navigate')
        return (await cache.match(new URL('index.html', baseUrl).href)) || fetch(request);
    // Version-query boot URLs resolve within the same verified generation, including offline.
    if (assetUrls.has(canonical)) return (await cache.match(canonical)) || fetch(request);
    // Older open documents may still request an immutable fingerprint from their own release.
    if (/\.[a-z0-9]{8,}\.(?:wasm|js|css|dat)$/i.test(url.pathname)) {
        for (const name of await caches.keys()) {
            if (!name.startsWith(cacheNamePrefix) && !name.startsWith('offline-cache-')) continue;
            const previous = await (await caches.open(name)).match(canonical);
            if (previous) return previous;
        }
    }
    return fetch(request);
}
