/**
 * Arranque y enrutado.
 *
 * Router por hash (#/resumen). No necesita configuración de servidor y
 * funciona igual abriendo la app desde cualquier ruta o subcarpeta.
 */

import { load, subscribe, getState } from './state.js';
import { toast } from './ui.js';
import { watchAppOpen, setBadge } from './notify.js';
import { pendingCharges } from './finance.js';

import * as resumen from './views/resumen.js';
import * as movimientos from './views/movimientos.js';
import * as recurrentes from './views/recurrentes.js';
import * as inversiones from './views/inversiones.js';
import * as historico from './views/historico.js';
import * as proyeccion from './views/proyeccion.js';
import * as ajustes from './views/ajustes.js';

const ROUTES = {
  resumen,
  movimientos,
  recurrentes,
  inversiones,
  historico,
  proyeccion,
  ajustes,
};

const DEFAULT_ROUTE = 'resumen';

const viewEl = document.getElementById('view');
const titleEl = document.getElementById('view-title');

function currentRoute() {
  const name = location.hash.replace(/^#\/?/, '').split('/')[0];
  return ROUTES[name] ? name : DEFAULT_ROUTE;
}

let rendering = false;

function render() {
  // subscribe() dispara render() en cada cambio de estado; si una vista guarda
  // algo mientras se dibuja, esta guarda evita la reentrada.
  if (rendering) return;
  rendering = true;

  const name = currentRoute();
  const view = ROUTES[name];

  try {
    const scrollY = window.scrollY;
    const node = view.render(render);
    viewEl.replaceChildren(node);
    titleEl.textContent = view.title;
    document.title = `${view.title} · Gestor de Cuentas`;

    for (const tab of document.querySelectorAll('.tab')) {
      const active = tab.dataset.tab === name;
      tab.setAttribute('aria-current', active ? 'page' : 'false');
    }
    // Ajustes no es una pestaña: vive en el engranaje de la barra superior.
    document.querySelector('.topbar__settings')
      ?.setAttribute('aria-current', name === 'ajustes' ? 'page' : 'false');

    // Al cambiar de pestaña se sube arriba; al redibujar la misma, se respeta
    // la posición para que guardar algo no te expulse del sitio donde estabas.
    if (name !== render._last) {
      window.scrollTo(0, 0);
      render._last = name;
    } else {
      window.scrollTo(0, scrollY);
    }
  } catch (err) {
    console.error('Error al dibujar la vista', err);
    viewEl.replaceChildren(errorPanel(err));
  } finally {
    rendering = false;
  }
}

function errorPanel(err) {
  const div = document.createElement('div');
  div.className = 'empty';
  div.innerHTML = `
    <div class="empty__icon">💥</div>
    <div class="empty__title">Algo se ha roto al dibujar esta pantalla</div>
    <div class="empty__text">Tus datos siguen guardados. Prueba a recargar; si se repite,
      exporta una copia desde Ajustes.</div>`;
  const pre = document.createElement('pre');
  pre.className = 'small faint mono';
  pre.style.cssText = 'margin-top:16px;text-align:left;white-space:pre-wrap;word-break:break-word';
  pre.textContent = String(err?.stack || err);
  div.append(pre);
  return div;
}

/* ------------------------------------------------------------ arranque -- */

load();
render();

window.addEventListener('hashchange', render);
subscribe(render);

window.addEventListener('storage-error', () => {
  toast('No se pudo guardar: el almacenamiento del navegador está lleno o bloqueado.', 6000);
});

/* Sincroniza entre pestañas del mismo navegador. */
window.addEventListener('storage', (e) => {
  if (e.key === 'gestor-cuentas/v1') { load(); render(); }
});

if (!location.hash) location.replace('#/' + DEFAULT_ROUTE);

/* --------------------------------------------------- service worker ---- */

// Solo en contexto seguro (https o localhost). Con file:// no hay SW y la app
// funciona igual, solo que sin instalación ni caché offline.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('./sw.js');
      await navigator.serviceWorker.ready;

      // Avisa de los cobros próximos en cada apertura de la app. Es lo máximo
      // que se puede hacer sin servidor: no existe forma de programar una
      // notificación local para una fecha futura. Ver js/notify.js.
      watchAppOpen(getState);
    } catch (err) {
      console.warn('No se pudo registrar el service worker:', err.message);
    }
  });
}

/* Mantiene el contador del icono al día con los cobros pendientes. */
function refreshBadge() {
  const { vencidos, proximos } = pendingCharges(getState(), getState().settings.notifyDaysBefore ?? 3);
  setBadge(vencidos.length + proximos.length);
}
subscribe(refreshBadge);
refreshBadge();
