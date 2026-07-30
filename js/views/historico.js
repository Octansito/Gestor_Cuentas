/**
 * Vista "Histórico": qué ha pasado por semanas y por meses, en qué se va el
 * dinero y qué hacer al respecto.
 */

import { h, svgIcon, ICONS } from '../ui.js';
import {
  money, percent, fmtMonth, fmtMonthLong, fmtDate, addMonths, monthKey,
  todayISO, daysInMonth, parseISO, toISO,
} from '../format.js';
import { weeksOfMonth, monthsOfYear, byCategory, monthBudget } from '../finance.js';
import { barChart, categoryBars } from '../charts.js';
import { generateAdvice } from '../advice.js';
import { getState, categoryById } from '../state.js';
import { flowRow, empty } from './shared.js';

let modo = 'semanas';   // 'semanas' | 'meses'
let cursorMes = null;   // "YYYY-MM"
let cursorAnio = null;
let semanaAbierta = null;

export function render(rerender) {
  const state = getState();
  const today = todayISO();
  if (!cursorMes) cursorMes = monthKey(today);
  if (!cursorAnio) cursorAnio = Number(today.slice(0, 4));

  const root = h('div.stack');

  if (!state.transactions.length && !state.recurrings.length) {
    root.append(empty({
      icon: '📊',
      title: 'Todavía no hay histórico',
      text: 'Cuando lleves unas semanas registrando gastos, aquí verás cuánto se te va por '
          + 'semana y por mes, en qué, y qué puedes recortar.',
    }));
    return root;
  }

  root.append(h('div.segmented',
    ...[['semanas', 'Por semanas'], ['meses', 'Por meses']].map(([m, label]) =>
      h('button', {
        type: 'button', 'aria-pressed': String(modo === m),
        onclick: () => { modo = m; rerender(); },
      }, label)),
  ));

  if (modo === 'semanas') semanas(root, state, rerender);
  else meses(root, state, rerender);

  consejos(root, state);

  return root;
}

/* ====================================================== por semanas ==== */

function semanas(root, state, rerender) {
  const move = (d) => { cursorMes = monthKey(addMonths(cursorMes + '-01', d)); semanaAbierta = null; rerender(); };

  root.append(navegador(fmtMonthLong(cursorMes), move, () => {
    cursorMes = monthKey(todayISO()); semanaAbierta = null; rerender();
  }));

  const ws = weeksOfMonth(state, cursorMes);
  // Los totales del mes salen de las propias semanas (ya sin hucha).
  const mes = {
    income: Math.round(ws.reduce((s, w) => s + w.income, 0) * 100) / 100,
    expense: Math.round(ws.reduce((s, w) => s + w.expense, 0) * 100) / 100,
  };

  root.append(h('div.duo',
    h('div.stat',
      h('div.stat__label', h('span.dot.dot--income'), 'Ganado en el mes'),
      h('div.stat__value.pos', money(mes.income)),
    ),
    h('div.stat',
      h('div.stat__label', h('span.dot.dot--expense'), 'Gastado en el mes'),
      h('div.stat__value.neg', money(mes.expense)),
    ),
  ));

  /* Gráfico por semanas */
  root.append(h('h2.section-title', 'Semana a semana'));
  root.append(h('div.card',
    barChart(ws.map((w) => ({
      label: `S${w.n}`,
      income: w.income,
      expense: w.expense,
    })), { height: 170 }),
    h('div.legend',
      h('span', h('span.dot.dot--income'), 'Ingresos'),
      h('span', h('span.dot.dot--expense'), 'Gastos'),
    ),
  ));

  /* Detalle de cada semana, desplegable */
  const media = ws.length ? ws.reduce((s, w) => s + w.expense, 0) / ws.length : 0;

  for (const w of ws) {
    const abierta = semanaAbierta === w.n;
    const dias = diasDe(w);
    const desviacion = media > 0 ? (w.expense - media) / media : 0;

    root.append(h('button.row', {
      type: 'button',
      style: { marginTop: '8px' },
      onclick: () => { semanaAbierta = abierta ? null : w.n; rerender(); },
    },
      h('div.row__icon', String(w.n)),
      h('div.row__main',
        h('div.row__title', `Semana ${w.n}`),
        h('div.row__sub', `${fmtDate(w.from)} – ${fmtDate(w.to)} · ${dias} ${dias === 1 ? 'día' : 'días'}`),
      ),
      h('div', { style: { textAlign: 'right' } },
        h('div.row__amount.neg', money(-w.expense)),
        w.income
          ? h('div.row__state', { class: 'badge--income' }, `+${money(w.income)}`)
          : Math.abs(desviacion) > 0.35 && media > 0
            ? h('div.row__state', { class: desviacion > 0 ? 'badge--warn' : '' },
                `${desviacion > 0 ? '▲' : '▼'} ${percent(Math.abs(desviacion) * 100, 0)} vs media`)
            : null,
      ),
    ));

    if (abierta) {
      const cats = agrupaPorCategoria(w.flows.filter((f) => f.kind === 'gasto'));
      root.append(h('div.card', { style: { marginTop: '8px' } },
        w.expense > 0
          ? h('div', h('div.small.faint', { style: { marginBottom: '6px' } }, 'En qué se fue'),
              ...categoryBars(cats.slice(0, 5)))
          : h('div.small.faint.center', { style: { padding: '8px' } }, 'Sin gastos esta semana.'),
        h('div', { style: { marginTop: '14px' } },
          h('div.small.faint', { style: { marginBottom: '6px' } }, `${w.flows.length} movimientos`),
          ...w.flows.slice(0, 8).map((f) => flowRow(f, { showDate: true })),
          w.flows.length > 8
            ? h('div.small.faint.center', { style: { marginTop: '8px' } },
                `y ${w.flows.length - 8} más`)
            : null,
        ),
      ));
    }
  }

  root.append(h('div.card', { style: { marginTop: '12px' } },
    h('div.kv',
      h('span.kv__k', 'Gasto medio por semana'),
      h('span.kv__v.neg', money(media)),
    ),
    h('div.kv',
      h('span.kv__k', 'Semana más cara'),
      h('span.kv__v.neg', ws.length
        ? `S${ws.reduce((a, b) => (b.expense > a.expense ? b : a)).n} · `
          + money(Math.max(...ws.map((w) => w.expense)))
        : '—'),
    ),
  ));
}

/* ======================================================== por meses ==== */

function meses(root, state, rerender) {
  const move = (d) => { cursorAnio += d; rerender(); };
  root.append(navegador(String(cursorAnio), move, () => {
    cursorAnio = Number(todayISO().slice(0, 4)); rerender();
  }));

  const ms = monthsOfYear(state, cursorAnio);
  const conDatos = ms.filter((m) => m.income || m.expense);
  const totalIn = conDatos.reduce((s, m) => s + m.income, 0);
  const totalOut = conDatos.reduce((s, m) => s + m.expense, 0);

  root.append(h('div.duo',
    h('div.stat',
      h('div.stat__label', h('span.dot.dot--income'), `Ganado en ${cursorAnio}`),
      h('div.stat__value.pos', money(totalIn)),
    ),
    h('div.stat',
      h('div.stat__label', h('span.dot.dot--expense'), `Gastado en ${cursorAnio}`),
      h('div.stat__value.neg', money(totalOut)),
    ),
  ));

  root.append(h('div.card',
    h('div.kv',
      h('span.kv__k', 'Balance del año'),
      h('span.kv__v', { class: totalIn - totalOut >= 0 ? 'pos' : 'neg' }, money(totalIn - totalOut)),
    ),
    conDatos.length
      ? h('div.kv',
          h('span.kv__k', 'Gasto medio al mes'),
          h('span.kv__v.neg', money(totalOut / conDatos.length)),
        )
      : null,
  ));

  root.append(h('h2.section-title', 'Mes a mes'));
  root.append(h('div.card',
    barChart(ms.map((m) => ({
      label: fmtMonth(m.key).split(' ')[0],
      income: m.income,
      expense: m.expense,
    })), { height: 180 }),
    h('div.legend',
      h('span', h('span.dot.dot--income'), 'Ingresos'),
      h('span', h('span.dot.dot--expense'), 'Gastos'),
    ),
  ));

  root.append(h('div.card', { style: { padding: '10px' } },
    h('div.table-wrap',
      h('table.data',
        h('thead', h('tr',
          h('th', 'Mes'), h('th', 'Ingresos'), h('th', 'Gastos'), h('th', 'Balance'),
        )),
        h('tbody', ...ms.map((m) => h('tr', {
          class: m.key === monthKey(todayISO()) ? 'year-end' : '',
        },
          h('td', fmtMonthLong(m.key).split(' de ')[0]),
          h('td', { class: 'pos' }, m.income ? money(m.income) : '—'),
          h('td', { class: 'neg' }, m.expense ? money(m.expense) : '—'),
          h('td', { class: m.net >= 0 ? 'pos' : 'neg' }, (m.income || m.expense) ? money(m.net) : '—'),
        ))),
      ),
    ),
  ));

  /* Reparto por categoría del año */
  const cats = byCategory(state, 'gasto', `${cursorAnio}-01-01`, `${cursorAnio}-12-31`);
  if (cats.items.length) {
    root.append(h('h2.section-title', `En qué se te fue ${cursorAnio}`));
    root.append(h('div.card', ...categoryBars(cats.items.slice(0, 8).map((it) => {
      const c = it.categoryId === '__none__' ? null : categoryById(it.categoryId);
      return { label: c?.name ?? 'Sin categoría', value: it.value, icon: c?.icon ?? '·' };
    }))));
  }
}

/* ======================================================== consejos ===== */

function consejos(root, state) {
  const tips = generateAdvice(state);

  root.append(h('h2.section-title', 'Dónde puedes recortar'));

  if (!tips.length) {
    root.append(h('div.card',
      h('div.small.faint.center', { style: { padding: '14px', lineHeight: '1.5' } },
        'Nada que señalar ahora mismo: no hay ninguna partida desproporcionada, '
        + 'ni gastos fijos excesivos, ni el saldo se va a negativo. '
        + 'Cuando algo se desmadre, aparecerá aquí.'),
    ));
    return;
  }

  root.append(h('div.card',
    ...tips.map((t) => h('div.tip', { class: `tip--${t.nivel}` },
      h('div.tip__title', t.titulo),
      h('div.tip__text', t.texto),
      t.ahorroAnual
        ? h('span.tip__saving', `≈ ${money(t.ahorroAnual)} al año`)
        : null,
    )),
  ));

  root.append(h('div.small.faint', { style: { marginTop: '10px', lineHeight: '1.5' } },
    'Los consejos salen de reglas sobre tus propias cifras, no de una IA ni de nada que salga '
    + 'del móvil. Los ahorros son estimaciones y se solapan entre sí, así que no los sumes.'));
}

/* ---------------------------------------------------------- utilidades -- */

function navegador(titulo, move, hoy) {
  return h('div.card', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px' },
  },
    h('button.btn.btn--ghost', { onclick: () => move(-1), 'aria-label': 'Anterior' },
      svgIcon('M15 6l-6 6 6 6', { stroke: true, size: 18 })),
    h('button.btn.btn--ghost', {
      style: { fontWeight: '650', color: 'var(--text)' },
      onclick: hoy,
      title: 'Volver al periodo actual',
    }, titulo),
    h('button.btn.btn--ghost', { onclick: () => move(1), 'aria-label': 'Siguiente' },
      svgIcon('M9 6l6 6-6 6', { stroke: true, size: 18 })),
  );
}

function diasDe(w) {
  const a = parseISO(w.from);
  const b = parseISO(w.to);
  return Math.round((new Date(b.y, b.m - 1, b.d) - new Date(a.y, a.m - 1, a.d)) / 86400000) + 1;
}

function agrupaPorCategoria(flows) {
  const map = new Map();
  for (const f of flows) {
    const id = f.categoryId || '__none__';
    map.set(id, (map.get(id) || 0) + f.amount);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, value]) => {
      const c = id === '__none__' ? null : categoryById(id);
      return { label: c?.name ?? 'Sin categoría', value, icon: c?.icon ?? '·' };
    });
}

export const title = 'Histórico';
