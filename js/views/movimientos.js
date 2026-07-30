/** Vista "Movimientos": libro mensual, en lista o en calendario. */

import { h, svgIcon } from '../ui.js';
import {
  money, fmtMonthLong, fmtDateLong, fmtDateRelative, addMonths, monthKey, todayISO,
  daysInMonth, parseISO, toISO,
} from '../format.js';
import { flowsBetween } from '../finance.js';
import { getState } from '../state.js';
import { flowRow, empty, fab } from './shared.js';
import { transactionForm } from '../forms.js';

/* Estado local de la vista: se conserva al navegar entre pestañas. */
let cursor = null;          // "YYYY-MM"
let filter = 'todos';       // 'todos' | 'gasto' | 'ingreso'
let vista = 'lista';        // 'lista' | 'calendario'
let diaSel = null;          // día elegido en el calendario, "YYYY-MM-DD"

const DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

export function render(rerender) {
  const state = getState();
  if (!cursor) cursor = monthKey(todayISO());

  const [y, m] = cursor.split('-').map(Number);
  const from = toISO(y, m, 1);
  const to = toISO(y, m, daysInMonth(y, m));

  const root = h('div.stack');

  /* -------------------------------------------------- navegador de mes -- */
  const move = (delta) => { cursor = monthKey(addMonths(from, delta)); diaSel = null; rerender(); };

  root.append(h('div.card', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px' } },
    h('button.btn.btn--ghost', { onclick: () => move(-1), 'aria-label': 'Mes anterior' },
      svgIcon('M15 6l-6 6 6 6', { stroke: true, size: 18 })),
    h('button.btn.btn--ghost', {
      style: { fontWeight: '650', color: 'var(--text)' },
      onclick: () => { cursor = monthKey(todayISO()); diaSel = null; rerender(); },
      title: 'Ir al mes actual',
    }, fmtMonthLong(cursor)),
    h('button.btn.btn--ghost', { onclick: () => move(1), 'aria-label': 'Mes siguiente' },
      svgIcon('M9 6l6 6-6 6', { stroke: true, size: 18 })),
  ));

  /* -------------------------------------------------------- totales ----- */
  // La hucha tiene su propia sección; aquí no se mezcla.
  const all = flowsBetween(state, from, to).filter((f) => !f.hucha);
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

  /* ------------------------------------------------ lista / calendario -- */
  root.append(h('div.segmented', { style: { marginTop: '12px' } },
    ...[['lista', 'Lista'], ['calendario', 'Calendario']].map(([v, label]) =>
      h('button', {
        type: 'button', 'aria-pressed': String(vista === v),
        onclick: () => { vista = v; rerender(); },
      }, label)),
  ));

  if (vista === 'calendario') renderCalendario(root, state, y, m, all, rerender);
  else renderLista(root, all);

  root.append(fab(() => transactionForm(diaSel ? { date: diaSel } : undefined), 'Nuevo movimiento'));
  return root;
}

/* ============================================================= lista ==== */

function renderLista(root, all) {
  root.append(h('div.segmented', { style: { marginTop: '12px' } },
    ...[['todos', 'Todos'], ['gasto', 'Gastos'], ['ingreso', 'Ingresos']].map(([f, label]) =>
      h('button', {
        type: 'button', 'aria-pressed': String(filter === f),
        onclick: () => { filter = f; renderRerender(); },
      }, label)),
  ));

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
    return;
  }

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

// El filtro necesita re-render; guardamos la referencia que nos pasa render().
let renderRerender = () => {};

/* ========================================================= calendario === */

function renderCalendario(root, state, y, m, all, rerender) {
  renderRerender = rerender;

  // Agrupa los movimientos del mes por día.
  const porDia = new Map();
  for (const f of all) {
    if (!porDia.has(f.date)) porDia.set(f.date, []);
    porDia.get(f.date).push(f);
  }

  const dias = daysInMonth(y, m);
  const primerDow = (new Date(y, m - 1, 1).getDay() + 6) % 7; // 0 = lunes
  const hoy = todayISO();

  const grid = h('div.cal');
  // Cabecera con las iniciales de los días.
  for (const d of DIAS) grid.append(h('div.cal__head', d));
  // Huecos antes del día 1 para alinear la primera semana.
  for (let i = 0; i < primerDow; i++) grid.append(h('div'));

  for (let d = 1; d <= dias; d++) {
    const date = toISO(y, m, d);
    const items = porDia.get(date) || [];
    const dayNet = items.reduce((s, f) => s + (f.kind === 'ingreso' ? f.amount : -f.amount), 0);
    const tieneIngreso = items.some((f) => f.kind === 'ingreso');
    const tieneGasto = items.some((f) => f.kind === 'gasto');

    const cls = ['cal__cell'];
    if (date === hoy) cls.push('cal__cell--today');
    if (date === diaSel) cls.push('cal__cell--sel');
    if (items.length) cls.push('cal__cell--has');

    grid.append(h('button', {
      class: cls.join(' '),
      type: 'button',
      onclick: () => { diaSel = diaSel === date ? null : date; rerender(); },
      'aria-label': `Día ${d}${items.length ? `, ${money(dayNet)}` : ''}`,
    },
      h('span.cal__day', String(d)),
      h('span.cal__dots',
        tieneIngreso ? h('span.cal__dot', { style: { background: 'var(--income)' } }) : null,
        tieneGasto ? h('span.cal__dot', { style: { background: 'var(--expense)' } }) : null,
      ),
    ));
  }

  root.append(h('div.card', { style: { padding: '12px 10px' } }, grid));

  /* -------------------------------------------- resumen del día elegido -- */
  if (!diaSel) {
    root.append(h('div.small.faint.center', { style: { padding: '8px' } },
      'Toca un día para ver sus ingresos y gastos.'));
    return;
  }

  const items = (porDia.get(diaSel) || []).slice()
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'ingreso' ? -1 : 1));
  const ing = items.filter((f) => f.kind === 'ingreso').reduce((s, f) => s + f.amount, 0);
  const gas = items.filter((f) => f.kind === 'gasto').reduce((s, f) => s + f.amount, 0);

  // "Hoy"/"Mañana"/"Ayer" si aplica; si no, la fecha larga capitalizada.
  const rel = fmtDateRelative(diaSel);
  const titulo = /^(Hoy|Mañana|Ayer)$/.test(rel) ? rel : capitaliza(fmtDateLong(diaSel));
  root.append(h('h2.section-title', titulo));

  if (!items.length) {
    root.append(h('div.card',
      h('div.small.faint.center', { style: { padding: '10px' } }, 'Sin movimientos este día.'),
      h('button.btn.btn--primary.btn--block', {
        style: { marginTop: '8px' },
        onclick: () => transactionForm({ date: diaSel }),
      }, 'Añadir movimiento este día'),
    ));
    return;
  }

  root.append(h('div.duo',
    h('div.stat',
      h('div.stat__label', h('span.dot.dot--income'), 'Ingresos'),
      h('div.stat__value.pos', money(ing)),
    ),
    h('div.stat',
      h('div.stat__label', h('span.dot.dot--expense'), 'Gastos'),
      h('div.stat__value.neg', money(gas)),
    ),
  ));

  // Cada movimiento con su motivo (concepto o categoría). flowRow ya lo enseña.
  root.append(h('div.list', ...items.map((f) => flowRow(f))));
}

function capitaliza(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const title = 'Movimientos';
