/**
 * Bloqueo por PIN y almacenamiento persistente.
 *
 * QUÉ ES Y QUÉ NO ES, para no dar falsa sensación de seguridad:
 *  - El PIN es una BARRERA en la interfaz: frena a quien coja tu móvil
 *    desbloqueado y abra la app. Es la amenaza real del día a día.
 *  - NO cifra los datos. Siguen en localStorage en claro. Alguien con acceso
 *    técnico al almacenamiento del navegador podría leerlos igual. Contra eso,
 *    la protección de verdad es el bloqueo de pantalla del propio móvil.
 *
 * Guardamos solo el HASH del PIN (SHA-256), no el PIN, para que no se lea a
 * simple vista en el almacenamiento.
 */

import { getState, updateSettings } from './state.js';

const REBLOQUEO_MIN = 3;   // minutos en segundo plano tras los que se vuelve a pedir el PIN

let desbloqueado = false;
let ocultaDesde = 0;

/* -------------------------------------------------------------- hash -- */

export async function hashPin(pin) {
  const data = new TextEncoder().encode('gc-pin:' + pin);
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Reserva si crypto.subtle no está (contexto no seguro): hash simple. Peor,
  // pero el PIN sigue sin guardarse en claro.
  let h = 0;
  for (const b of data) h = (h * 31 + b) >>> 0;
  return 'x' + h.toString(16);
}

export function tienePin() {
  return Boolean(getState().settings.pinHash);
}

export async function setPin(pin) {
  updateSettings({ pinHash: await hashPin(pin) });
  desbloqueado = true;
}

export function quitarPin() {
  updateSettings({ pinHash: null });
  desbloqueado = true;
}

export async function comprobarPin(pin) {
  const actual = getState().settings.pinHash;
  return actual && (await hashPin(pin)) === actual;
}

/* ------------------------------------------------ almacenamiento --- */

/** Pide al navegador que no borre los datos por su cuenta (falta de espacio). */
export async function pedirPersistencia() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch { /* no soportado: da igual */ }
}

/* --------------------------------------------------------- bloqueo -- */

/** ¿Hay que mostrar la pantalla de bloqueo ahora mismo? */
export function bloqueada() {
  return tienePin() && !desbloqueado;
}

/**
 * Vuelve a bloquear si la app estuvo un rato en segundo plano. Se engancha una
 * sola vez desde app.js.
 */
export function vigilarReBloqueo(onLock) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { ocultaDesde = Date.now(); return; }
    if (!tienePin() || !desbloqueado) return;
    const min = (Date.now() - ocultaDesde) / 60000;
    if (ocultaDesde && min >= REBLOQUEO_MIN) { desbloqueado = false; onLock(); }
  });
}

/**
 * Pinta la pantalla de bloqueo a pantalla completa. Llama a onUnlock() al
 * acertar el PIN.
 */
export function mostrarBloqueo(onUnlock) {
  // Evita duplicados.
  document.getElementById('lock-screen')?.remove();

  let entrada = '';
  const puntos = crear('div', 'lock__dots');
  const err = crear('div', 'lock__err');

  const pintarPuntos = () => {
    puntos.replaceChildren();
    for (let i = 0; i < 4; i++) {
      const d = crear('span', 'lock__dot' + (i < entrada.length ? ' on' : ''));
      puntos.append(d);
    }
  };
  pintarPuntos();

  const pulsar = async (n) => {
    if (entrada.length >= 4) return;
    entrada += n;
    pintarPuntos();
    if (entrada.length === 4) {
      if (await comprobarPin(entrada)) {
        desbloqueado = true;
        screen.remove();
        document.body.style.overflow = '';
        onUnlock();
      } else {
        err.textContent = 'PIN incorrecto';
        puntos.classList.add('shake');
        setTimeout(() => { entrada = ''; pintarPuntos(); puntos.classList.remove('shake'); }, 500);
      }
    }
  };

  const borrar = () => { entrada = entrada.slice(0, -1); pintarPuntos(); err.textContent = ''; };

  const teclado = crear('div', 'lock__pad');
  for (const t of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']) {
    if (t === '') { teclado.append(crear('div')); continue; }
    const b = crear('button', 'lock__key', t);
    b.type = 'button';
    b.addEventListener('click', () => (t === '⌫' ? borrar() : pulsar(t)));
    teclado.append(b);
  }

  const screen = crear('div', 'lock');
  screen.id = 'lock-screen';
  const logo = crear('div', 'lock__logo', '🔒');
  const titulo = crear('div', 'lock__title', 'Introduce tu PIN');
  screen.append(logo, titulo, puntos, err, teclado);

  document.body.append(screen);
  document.body.style.overflow = 'hidden';
}

function crear(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}
