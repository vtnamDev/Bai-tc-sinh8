'use strict';

const SHELL_VERSION = '20261015-cream-cinematic-models-v22-foundation';
const CACHE_NAME = 'biosphere-shell-' + SHELL_VERSION;
const SCOPE_URL = new URL(self.registration.scope);
const SHELL_URLS = [
  './',
  './index.html',
  './styles.css?v=' + SHELL_VERSION,
  './editorial-light.css?v=' + SHELL_VERSION,
  './workspace-polish.css?v=' + SHELL_VERSION,
  './bai32-deck.js?v=' + SHELL_VERSION,
  './model-embed.js?v=' + SHELL_VERSION,
  './app.js?v=' + SHELL_VERSION,
  './assets/mark.svg',
  './assets/team/animal-wolf.svg',
  './assets/team/animal-cat.svg',
  './assets/team/animal-rabbit.svg',
  './assets/team/animal-penguin.svg',
  './assets/team/animal-pink-cat.svg',
  './assets/team/animal-otter.svg',
  './assets/team/animal-fox.svg',
  './assets/team/animal-panda.svg',
];
const SHELL_PATHS = new Set([
  new URL('./', SCOPE_URL).pathname,
  new URL('./index.html', SCOPE_URL).pathname,
  new URL('./styles.css', SCOPE_URL).pathname,
  new URL('./editorial-light.css', SCOPE_URL).pathname,
  new URL('./workspace-polish.css', SCOPE_URL).pathname,
  new URL('./bai32-deck.js', SCOPE_URL).pathname,
  new URL('./model-embed.js', SCOPE_URL).pathname,
  new URL('./app.js', SCOPE_URL).pathname,
  new URL('./assets/mark.svg', SCOPE_URL).pathname,
  new URL('./assets/team/animal-wolf.svg', SCOPE_URL).pathname,
  new URL('./assets/team/animal-cat.svg', SCOPE_URL).pathname,
  new URL('./assets/team/animal-rabbit.svg', SCOPE_URL).pathname,
  new URL('./assets/team/animal-penguin.svg', SCOPE_URL).pathname,
  new URL('./assets/team/animal-pink-cat.svg', SCOPE_URL).pathname,
  new URL('./assets/team/animal-otter.svg', SCOPE_URL).pathname,
  new URL('./assets/team/animal-fox.svg', SCOPE_URL).pathname,
  new URL('./assets/team/animal-panda.svg', SCOPE_URL).pathname,
]);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL_URLS.map(path => new Request(new URL(path, SCOPE_URL).href, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith('biosphere-shell-') && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || (!SHELL_PATHS.has(url.pathname) && request.mode !== 'navigate')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          const keyPath = url.pathname.endsWith('/index.html') ? './index.html' : './';
          await cache.put(new URL(keyPath, SCOPE_URL).href, response.clone());
        }
        return response;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request) ||
          await cache.match(new URL('./', SCOPE_URL).href) ||
          await cache.match(new URL('./index.html', SCOPE_URL).href);
        return cached || new Response(
          'BioSphere is offline and its app shell has not been cached yet.',
          { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;

    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
      return response;
    } catch {
      return new Response(
        'This BioSphere resource is unavailable offline.',
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      );
    }
  })());
});
