/**
 * Utilidades de interfaz: creación de nodos, modales, toasts y confirmaciones.
 * Sin framework: `h()` es todo lo que necesitamos para construir árboles DOM.
 */

/**
 * Crea un elemento.
 *   h('div.card', { onclick: fn }, 'texto', h('b', 'negrita'))
 * El selector admite etiqueta, #id y .clases.
 */
export function h(selector, props, ...children) {
  const m = /^([a-zA-Z0-9-]*)(#[^.]+)?((?:\.[^.#]+)*)$/.exec(selector);
  if (!m) throw new Error(`Selector no válido: ${selector}`);
  const [, tag, id, classes] = m;
  const el = document.createElement(tag || 'div');
  if (id) el.id = id.slice(1);
  if (classes) el.className = classes.slice(1).split('.').join(' ');

  // Permite omitir props: h('div', 'hola')
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }

  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }

  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Crea nodos SVG (h() no sirve: los SVG necesitan namespace). */
export function svg(tag, props = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

/**
 * Reemplaza los hijos de `node` filtrando null/undefined/false.
 *
 * `Node.replaceChildren(null)` NO ignora los nulos: los convierte en el texto
 * "null" y lo pinta en pantalla. Como usamos mucho el patrón
 * `cond ? h(...) : null`, esta envoltura es obligatoria.
 */
export function setChildren(node, ...children) {
  node.replaceChildren(
    ...children.flat(Infinity)
      .filter((c) => c != null && c !== false)
      .map((c) => (c instanceof Node ? c : document.createTextNode(String(c)))),
  );
  return node;
}

/* --------------------------------------------------------------- modal -- */

let openModals = 0;

/**
 * Abre una hoja modal. `render(close)` devuelve el contenido.
 * @returns {{close:Function, el:HTMLElement}}
 */
export function modal({ title, render, onClose, actions }) {
  const root = document.getElementById('modal-root');

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    if (--openModals === 0) document.body.style.overflow = '';
    onClose?.();
    lastFocus?.focus?.();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  };

  const lastFocus = document.activeElement;

  const panel = h('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.modal__grip'),
    h('div.modal__header',
      h('h2.modal__title', title),
      h('div', { style: { display: 'flex', gap: '8px' } },
        actions || null,
        h('button.btn.btn--ghost', { onclick: close, 'aria-label': 'Cerrar' },
          svgIcon('M6 6l12 12M18 6L6 18', { stroke: true })),
      ),
    ),
  );

  const backdrop = h('div.modal-backdrop', {
    onclick: (e) => { if (e.target === backdrop) close(); },
  }, panel);

  panel.append(render(close));
  root.append(backdrop);

  if (openModals++ === 0) document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onKey);

  // Enfoca el primer control para que el teclado funcione de inmediato,
  // pero evita abrir el teclado del móvil sin querer con los campos de texto.
  const first = panel.querySelector('input, select, textarea, button:not(.btn--ghost)');
  if (first && !/^(INPUT|TEXTAREA)$/.test(first.tagName)) first.focus();

  return { close, el: panel };
}

/** Confirmación modal. Devuelve una promesa que resuelve a boolean. */
export function confirmDialog({ title, message, confirmText = 'Aceptar', danger = false }) {
  return new Promise((resolve) => {
    let decided = false;
    const done = (v) => { decided = true; resolve(v); };

    const { close } = modal({
      title,
      onClose: () => { if (!decided) resolve(false); },
      render: (close) => h('div',
        h('p.muted', { style: { marginTop: 0, lineHeight: '1.55' } }, message),
        h('div.row-actions',
          h('button.btn', { onclick: () => { done(false); close(); } }, 'Cancelar'),
          h(danger ? 'button.btn.btn--danger' : 'button.btn.btn--primary',
            { onclick: () => { done(true); close(); } }, confirmText),
        ),
      ),
    });
  });
}

/* --------------------------------------------------------------- toast -- */

export function toast(message, ms = 2600) {
  const root = document.getElementById('toast-root');
  const el = h('div.toast', message);
  root.append(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .2s';
    setTimeout(() => el.remove(), 220);
  }, ms);
}

/* --------------------------------------------------------------- icons -- */

export function svgIcon(path, { stroke = false, size = 16 } = {}) {
  return svg('svg', {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    'aria-hidden': 'true',
    style: 'flex:none',
  }, svg('path', stroke
    ? { d: path, stroke: 'currentColor', 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round' }
    : { d: path, fill: 'currentColor' }));
}

export const ICONS = {
  check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 11h-5v-2h3V6h2v7z',
  bell: 'M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6v-5a6 6 0 0 0-5-5.91V4a1 1 0 0 0-2 0v1.09A6 6 0 0 0 6 11v5l-2 2v1h16v-1l-2-2z',
  calendar: 'M17 3h-1V1h-2v2H10V1H8v2H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H7V9h10v10z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z',
  edit: 'M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  trash: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  download: 'M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z',
  upload: 'M5 20h14v-2H5v2zM5 9h4v6h6V9h4l-7-7-7 7z',
  chart: 'M3 3v18h18v-2H5V3H3zm4 12l4-4 3 3 5-6 1.5 1.2-6.5 7.8-3-3-3 3L7 15z',
};

/* --------------------------------------------------- entrada numérica -- */

/**
 * Lee un campo numérico aceptando coma o punto decimal.
 * Devuelve NaN si está vacío o no es un número.
 */
export function readNumber(input) {
  const raw = String(input.value ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (raw === '') return NaN;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

/** Marca un campo como erróneo y devuelve false, para encadenar validaciones. */
export function markInvalid(input, message) {
  input.style.borderColor = 'var(--expense)';
  input.setAttribute('aria-invalid', 'true');
  input.addEventListener('input', () => {
    input.style.borderColor = '';
    input.removeAttribute('aria-invalid');
  }, { once: true });
  if (message) toast(message);
  input.focus();
  return false;
}
