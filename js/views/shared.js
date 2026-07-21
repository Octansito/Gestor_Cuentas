/** Piezas de interfaz reutilizadas por varias vistas. */

import { h, svgIcon, ICONS } from '../ui.js';
import { money, fmtDateRelative } from '../format.js';
import { categoryById, getState } from '../state.js';
import { transactionForm, recurringForm, chargeForm } from '../forms.js';

/** Cómo se pinta cada estado de un vencimiento recurrente. */
const ESTADOS = {
  cobrado:  { marca: '✓',  clase: 'badge--income', texto: 'cobrado' },
  asumido:  { marca: '•',  clase: 'badge--warn',   texto: 'sin confirmar' },
  previsto: { marca: '○',  clase: '',              texto: 'previsto' },
  omitido:  { marca: '✕',  clase: '',              texto: 'no cobrado' },
};

/**
 * Fila de un flujo (movimiento puntual o vencimiento de un recurrente).
 * Al pulsarla abre la hoja que corresponda.
 */
export function flowRow(flow, { showDate = false, showStatus = true } = {}) {
  const cat = flow.categoryId ? categoryById(flow.categoryId) : null;
  const isIncome = flow.kind === 'ingreso';
  const isRec = flow.source === 'rec' || flow.recurringId != null;
  const estado = isRec ? (ESTADOS[flow.status] ?? ESTADOS.previsto) : null;

  const title = flow.name || cat?.name || (isIncome ? 'Ingreso' : 'Gasto');

  const subParts = [];
  if (showDate) subParts.push(fmtDateRelative(flow.date));
  // La categoría solo aporta si dice algo distinto del título ("Nómina · Nómina" sobra).
  if (cat && flow.name && cat.name !== flow.name) subParts.push(cat.name);
  if (flow.interest) subParts.push(`${money(flow.interest)} de intereses`);

  const open = () => {
    const s = getState();
    if (isRec) {
      // Sobre un vencimiento, lo que quieres casi siempre es marcarlo,
      // no reconfigurar el recurrente entero.
      chargeForm(flow);
    } else {
      const tx = s.transactions.find((t) => t.id === flow.id);
      if (tx) transactionForm(tx);
    }
  };

  return h('button.row', { type: 'button', onclick: open },
    h('div.row__icon', {
      class: flow.status === 'omitido' ? 'row__icon--off' : '',
    }, cat?.icon ?? (isIncome ? '💰' : '📦')),
    h('div.row__main',
      h('div.row__title', {
        class: flow.status === 'omitido' ? 'strike' : '',
      }, title),
      subParts.length ? h('div.row__sub', subParts.join(' · ')) : null,
    ),
    h('div', { style: { textAlign: 'right' } },
      h('div.row__amount', {
        class: flow.status === 'omitido' ? 'faint strike' : isIncome ? 'pos' : 'neg',
      }, money(isIncome ? flow.amount : -flow.amount)),
      isRec && showStatus && estado
        ? h('div.row__state', { class: estado.clase },
            `${estado.marca} ${estado.texto}`)
        : null,
    ),
  );
}

/** Estado vacío con llamada a la acción. */
export function empty({ icon, title, text, action }) {
  return h('div.empty',
    h('div.empty__icon', icon),
    h('div.empty__title', title),
    text ? h('div.empty__text', text) : null,
    action ? h('div', { style: { marginTop: '16px' } }, action) : null,
  );
}

/** Botón flotante de "añadir". */
export function fab(onclick, label = 'Añadir') {
  return h('button.fab', { onclick, 'aria-label': label, title: label }, '+');
}

/**
 * Barra de progreso del sueldo consumido.
 * @param {number} consumido 0..1 gastado ya
 * @param {number} comprometido 0..1 gastado + pendiente hasta fin de mes
 */
export function budgetBar(consumido, comprometido) {
  const pct = (v) => `${Math.max(0, Math.min(100, v * 100)).toFixed(1)}%`;
  const excedido = comprometido >= 1;

  return h('div.bar', { role: 'img', 'aria-label': `${(consumido * 100).toFixed(0)} % del sueldo gastado` },
    // Capa de fondo: lo comprometido pero aún no gastado.
    h('div.bar__fill.bar__fill--pending', {
      style: { width: pct(comprometido), background: excedido ? 'var(--expense-soft)' : '' },
    }),
    // Capa delantera: lo que ya se ha ido de verdad.
    h('div.bar__fill.bar__fill--spent', {
      style: { width: pct(consumido), background: excedido ? 'var(--expense)' : '' },
    }),
  );
}
