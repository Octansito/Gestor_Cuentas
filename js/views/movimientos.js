/** Vista "Movimientos": libro mensual de todo lo que entra y sale. */

import { h, svgIcon } from '../ui.js';
import {
  money, fmtMonthLong, fmtDateLong, addMonths, monthKey, todayISO,
  daysInMonth, parseISO, toISO,
} from '../format.js';
import { flowsBetween } from '../finance.js';
import { getState } from '../state.js';
import { flowRow, empty, fab } from './shared.js';
import { transactionForm } from '../forms.js';

/* Estado local de la vista: se conserva al navegar entre pestañas. */
let cursor = null;          // "YYYY-MM"
let filter = 'todos';       // 'todos' | 'gasto' | 'ingreso'

export function render(rerender) {
  const state = getState();
  if (!cursor) cursor = monthKey(todayISO());

  const [y, m] = cursor.split('-').map(Number);
  const from = toISO(y, m, 1);
  const to = toISO(y, m, daysInMonth(y, m));

  const root = h('div.stack');

  /* -------------------------------------------------- navegador de mes -- */
  const move = (delta) => { cursor = monthKey(addMonths(from, delta)); rerender(); };

  root.append(h('div.card', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px' } },
    h('button.btn.btn--ghost', { onclick: () => move(-1), 'aria-label': 'Mes anterior' },
      svgIcon('M15 6l-6 6 6 6', { stroke: true, size: 18 })),
    h('button.btn.btn--ghost', {
      style: { fontWeight: '650', color: 'var(--text)' },
      onclick: () => { cursor = monthKey(todayISO()); rerender(); },
      title: 'Ir al mes actual',
    }, fmtMonthLong(cursor)),
    h('button.btn.btn--ghost', { onclick: () => move(1), 'aria-label': 'Mes siguiente' },
      svgIcon('M9 6l6 6-6 6', { stroke: true, size: 18 })),
  ));

  /* -------------------------------------------------------- totales ----- */
  const all = flowsBetween(state, from, to);
  const income = all.filter((f) => f.kind === 'ingreso').reduce((s, f) => s + f.amount, 0);
  const expense = all.filter((f) => f.kind === 'gasto').reduce((s, f) => s + f.amount, 0);
  const net = income - expense;

  root.append(h('div.duo',
    h('div.stat',
      h('div.stat__label', h('span.dot.dot--income'), 'Ingresos'),
      h('div.stat__value.pos', money(income)),
    ),
    h('div.stat',
      h('div.stat__label', h('span.dot.dot--expense'), 'Gastos'),
      h('div.stat__value.neg', money(expense)),
    ),
  ));
  root.append(h('div.card',
    h('div.kv',
      h('span.kv__k', 'Resultado del mes'),
      h('span.kv__v', { class: net >= 0 ? 'pos' : 'neg' }, money(net)),
    ),
  ));

  /* --------------------------------------------------------- filtro ----- */
  root.append(h('div.segmented', { style: { marginTop: '12px' } },
    ...[['todos', 'Todos'], ['gasto', 'Gastos'], ['ingreso', 'Ingresos']].map(([f, label]) =>
      h('button', {
        type: 'button', 'aria-pressed': String(filter === f),
        onclick: () => { filter = f; rerender(); },
      }, label)),
  ));

  /* --------------------------------------------------------- listado ---- */
  const flows = filter === 'todos' ? all : all.filter((f) => f.kind === filter);

  if (!flows.length) {
    root.append(empty({
      icon: '📭',
      title: 'Nada este mes',
      text: filter === 'todos'
        ? 'No hay movimientos ni vencimientos en este mes.'
        : `No hay ${filter === 'gasto' ? 'gastos' : 'ingresos'} en este mes.`,
      action: h('button.btn.btn--primary', { onclick: () => transactionForm() }, 'Añadir movimiento'),
    }));
  } else {
    /* Agrupado por día, con el total de cada día a la derecha. */
    const byDay = new Map();
    for (const f of flows) {
      if (!byDay.has(f.date)) byDay.set(f.date, []);
      byDay.get(f.date).push(f);
    }

    for (const [date, items] of [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
      const dayNet = items.reduce((s, f) => s + (f.kind === 'ingreso' ? f.amount : -f.amount), 0);
      root.append(h('div.day-header',
        h('span', fmtDateLong(date)),
        h('span.num', { class: dayNet >= 0 ? 'pos' : 'neg' }, money(dayNet)),
      ));
      root.append(h('div.list', ...items.map((f) => flowRow(f))));
    }
  }

  root.append(fab(() => transactionForm(), 'Nuevo movimiento'));
  return root;
}

export const title = 'Movimientos';
