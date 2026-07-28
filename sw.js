/**
 * Service worker: cachea el "app shell" para que la app arranque sin conexión.
 *
 * No toca los datos: esos viven en localStorage y nunca pasan por aquí.
 *
 * Al cambiar cualquier archivo de PRECACHE hay que subir VERSION, o los
 * navegadores que ya tengan la app instalada seguirán sirviendo la copia vieja.
 */

const VERSION = 'v6';
const CACHE = `gestor-cuentas-${VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/state.js',
  './js/finance.js',
  './js/format.js',
  './js/ui.js',
  './js/charts.js',
  './js/forms.js',
  './js/advice.js',
  './js/calendar.js',
  './js/notify.js',
  './js/investments.js',
  './js/views/shared.js',
  './js/views/inversiones.js',
  './js/views/historico.js',
  './js/views/resumen.js',
  './js/views/movimientos.js',
  './js/views/recurrentes.js',
  './js/views/proyeccion.js',
  './js/views/ajustes.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // addAll es atómico: si un archivo falla, no se instala nada. Preferimos
    // tolerar ausencias (p. ej. un icono que aún no se ha generado).
    await Promise.all(PRECACHE.map((url) =>
      cache.add(new Request(url, { cache: 'reload' }))
        .catch((err) => console.warn('[sw] no se pudo precachear', url, err))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('gestor-cuentas-') && k !== CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  /* Navegaciones: red primero para recoger versiones nuevas; si no hay
     conexión, se sirve el index cacheado y la app arranca igual. */
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('./index.html')) ?? Response.error();
      }
    })());
    return;
  }

  /* Resto de recursos: se sirve la copia cacheada al instante y se refresca
     por detrás (stale-while-revalidate), así el arranque offline es inmediato
     y la siguiente carga ya trae los cambios. */
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);

    const network = fetch(request).then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    }).catch(() => null);

    return cached ?? (await network) ?? Response.error();
  })());
});

/* ------------------------------------------------------- notificaciones -- */

/** Al pulsar la notificación: enfocar la pestaña abierta o abrir la app. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? './index.html#/resumen';

  event.waitUntil((async () => {
    const clientes = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clientes) {
      if (c.url.includes(self.location.origin)) {
        await c.focus();
        // La app ya está abierta: la llevamos a la vista, sin recargar.
        if ('navigate' in c) await c.navigate(url).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

/*
 * No hay listener de 'push' a propósito: no hay servidor que lo dispare. Las
 * notificaciones las lanza la propia página al abrirse (js/notify.js), y llegan
 * aquí solo para el clic de arriba.
 */
