const CACHE = 'asaar-shell-v4';
const scopeUrl = new URL('./', self.registration.scope);
const assetUrl = (path) => new URL(path, scopeUrl).toString();
const SHELL = [assetUrl('./'), assetUrl('index.html'), assetUrl('manifest.webmanifest'), assetUrl('favicon.svg')];

self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('asaar-shell-') && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (event) => {
	const request = event.request;
	const url = new URL(request.url);
	if (request.method !== 'GET' || url.origin !== self.location.origin) return;
	if (request.mode === 'navigate') {
		event.respondWith(fetch(request).then((response) => { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(assetUrl('./'), copy)); return response }).catch(() => caches.match(assetUrl('./'))));
		return;
	}
	if (!['script', 'style', 'image', 'font', 'manifest'].includes(request.destination)) return;
	event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(request, copy)); return response })));
});
