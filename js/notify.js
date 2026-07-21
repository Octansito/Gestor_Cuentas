/**
 * Notificaciones al abrir la app.
 *
 * LÍMITE IMPORTANTE, y conviene tenerlo claro antes de tocar esto:
 * una PWA NO puede programar una notificación para una fecha futura en local.
 * La API que lo permitía (Notification Triggers / TimestampTrigger) se quedó en
 * experimento y nunca llegó a producción. Sin un servidor push, el navegador
 * solo puede notificar mientras hay código ejecutándose.
 *
 * Consecuencia práctica: esto avisa cuando ABRES la app. Si no la abres, no te
 * enteras. Para avisos con la app cerrada está la exportación al calendario
 * (js/calendar.js), que es la única vía sin servidor que lo consigue.
 */

import { pendingCharges } from './finance.js';
import { money, fmtDate } from './format.js';

/**
 * Cuánto tiene que haber estado la app en segundo plano para que volver a ella
 * cuente como "abrirla".
 *
 * En Android una PWA casi nunca se recarga: la abres desde el icono y vuelve del
 * segundo plano, así que sin esto no avisaría casi nunca. Pero `visibilitychange`
 * también salta al cambiar de pestaña dos segundos, y eso no es abrir la app.
 */
const MINUTOS_EN_SEGUNDO_PLANO = 20;

/**
 * Ventana anti-duplicado. NO es un límite de frecuencia: existe solo porque el
 * `load` y el `visibilitychange` pueden dispararse casi a la vez en la misma
 * apertura y notificarías dos veces por lo mismo.
 */
const SEGUNDOS_ANTIDUPLICADO = 10;

let ultimoAviso = 0;
let ocultaDesde = 0;

export function notificationsSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator;
}

export function notificationPermission() {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

export async function requestNotificationPermission() {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.requestPermission();
}

/**
 * Avisa de los cobros próximos y de los vencidos sin confirmar.
 * Se llama en cada apertura de la app; si no hay nada que decir, calla.
 */
export async function notifyOnOpen(state) {
  if (notificationPermission() !== 'granted') return { shown: false, reason: 'sin-permiso' };
  if (state.settings.notifyEnabled === false) return { shown: false, reason: 'desactivado' };

  if (Date.now() - ultimoAviso < SEGUNDOS_ANTIDUPLICADO * 1000) {
    return { shown: false, reason: 'duplicado' };
  }

  const { vencidos, proximos } = pendingCharges(state, state.settings.notifyDaysBefore ?? 3);
  if (!vencidos.length && !proximos.length) return { shown: false, reason: 'nada-que-avisar' };

  const partes = [];
  if (proximos.length) {
    const total = proximos.reduce((s, o) => s + (o.kind === 'gasto' ? o.amount : 0), 0);
    partes.push(proximos.length === 1
      ? `${proximos[0].name}: ${money(proximos[0].amount)} el ${fmtDate(proximos[0].date)}`
      : `${proximos.length} cobros por ${money(total)}`);
  }
  if (vencidos.length) {
    partes.push(`${vencidos.length} sin confirmar`);
  }

  const reg = await navigator.serviceWorker.getRegistration();
  const opciones = {
    body: partes.join(' · '),
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: 'cobros-proximos',          // reemplaza la anterior en vez de apilarlas
    renotify: true,                  // pero vibra igualmente: es un aviso nuevo
    lang: 'es',
    data: { url: './index.html#/resumen' },
  };

  // showNotification() del service worker permite que al pulsar se abra la app;
  // new Notification() no, y además Android lo bloquea.
  if (reg) await reg.showNotification('Cobros a la vista', opciones);
  else new Notification('Cobros a la vista', opciones);

  ultimoAviso = Date.now();
  setBadge(vencidos.length + proximos.length);
  return { shown: true, vencidos: vencidos.length, proximos: proximos.length };
}

/**
 * Engancha el aviso a cada apertura de la app: la carga inicial y la vuelta
 * desde el segundo plano.
 *
 * @param {Function} getState
 */
export function watchAppOpen(getState) {
  notifyOnOpen(getState()).catch((err) => console.warn('Aviso no mostrado:', err));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      ocultaDesde = Date.now();
      return;
    }
    const minutos = (Date.now() - ocultaDesde) / 60000;
    if (ocultaDesde && minutos >= MINUTOS_EN_SEGUNDO_PLANO) {
      notifyOnOpen(getState()).catch((err) => console.warn('Aviso no mostrado:', err));
    }
  });
}

/** Contador en el icono de la app. Silencioso si el navegador no lo soporta. */
export function setBadge(n) {
  try {
    if (n > 0) navigator.setAppBadge?.(n);
    else navigator.clearAppBadge?.();
  } catch { /* no soportado: no pasa nada */ }
}

/** Notificación de prueba, para que el usuario compruebe que llegan. */
export async function testNotification() {
  if (notificationPermission() !== 'granted') {
    const p = await requestNotificationPermission();
    if (p !== 'granted') return false;
  }
  const reg = await navigator.serviceWorker.getRegistration();
  const opts = {
    body: 'Si ves esto, los avisos al abrir la app funcionan.',
    icon: './icons/icon-192.png',
    tag: 'prueba',
    data: { url: './index.html#/resumen' },
  };
  if (reg) await reg.showNotification('Prueba de notificación', opts);
  else new Notification('Prueba de notificación', opts);
  return true;
}
