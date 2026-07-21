/**
 * Vista "Proyección": a dónde lleva el ritmo actual.
 * Responde a la pregunta "¿cuánto dinero supone esto a lo largo del tiempo?".
 */

import { h } from '../ui.js';
import { money, percent, fmtMonth, fmtMonthLong, fmtDuration } from '../format.js';
import { project, monthlyEquivalent } from '../finance.js';
import { lineChart } from '../charts.js';
import { getState, updateSettings } from '../state.js';
import { empty } from './shared.js';
import { recurringForm } from '../forms.js';

const HORIZONS = [
  { months: 12, label: '1 año' },
  { months: 24, label: '2 años' },
  { months: 60, label: '5 años' },
  { months: 120, label: '10 años' },
];

let detailed = false;   // tabla mes a mes vs. resumen por años

export function render(rerender) {
  const state = getState();
  const root = h('div.stack');

  if (!state.recurrings.length && !state.transactions.length) {
    root.append(empty({
      icon: '🔮',
      title: 'Nada que proyectar todavía',
      text: 'La proyección se construye con tus movimientos recurrentes: nómina, alquiler, '
          + 'préstamos… Añade al menos uno y aquí verás la evolución de tu saldo.',
      action: h('button.btn.btn--primary', { onclick: () => recurringForm() }, 'Añadir recurrente'),
    }));
    return root;
  }

  const horizon = state.settings.horizonMonths || 60;
  const p = project(state, horizon);

  /* --------------------------------------------------- selector plazo -- */
  root.append(h('div.segmented',
    ...HORIZONS.map(({ months, label }) =>
      h('button', {
        type: 'button', 'aria-pressed': String(horizon === months),
        onclick: () => { updateSettings({ horizonMonths: months }); rerender(); },
      }, label)),
  ));

  /* ---------------------------------------------------------- hero ----- */
  const delta = p.endBalance - p.startBalance;
  root.append(h('div.hero',
    h('div.hero__label', `Saldo estimado en ${fmtDuration(horizon)}`),
    h('div.hero__value', { class: p.endBalance < 0 ? 'neg' : '' }, money(p.endBalance)),
    h('div.hero__sub', { class: delta >= 0 ? 'pos' : 'neg' },
      `${delta >= 0 ? '▲' : '▼'} ${money(Math.abs(delta))} respecto a hoy`),
  ));

  /* --------------------------------------------------------- gráfico --- */
  const points = p.months.map((m) => ({
    label: fmtMonth(m.key).replace(' ', ' '),
    value: m.balance,
  }));
  root.append(h('div.card', lineChart(points, { height: 230 })));

  /* -------------------------------------------------------- avisos ----- */
  if (p.lowest && p.lowest.balance < 0) {
    root.append(h('div.note.note--warn',
      h('strong', '⚠️ El saldo se queda en negativo. '),
      `Según esta previsión, en ${fmtMonthLong(p.lowest.key)} bajarías hasta `,
      h('strong', money(p.lowest.balance)),
      '. Revisa los gastos fijos o los plazos de los préstamos.',
    ));
  }

  /* -------------------------------------------------------- totales ---- */
  root.append(h('h2.section-title', `Acumulado en ${fmtDuration(horizon)}`));
  root.append(h('div.duo',
    h('div.stat',
      h('div.stat__label', h('span.dot.dot--income'), 'Ingresos'),
      h('div.stat__value.pos', money(p.totalIncome)),
    ),
    h('div.stat',
      h('div.stat__label', h('span.dot.dot--expense'), 'Gastos'),
      h('div.stat__value.neg', money(p.totalExpense)),
    ),
  ));

  const saved = p.totalIncome - p.totalExpense;
  root.append(h('div.card',
    h('div.kv',
      h('span.kv__k', saved >= 0 ? 'Ahorrarías' : 'Te faltarían'),
      h('span.kv__v', { class: saved >= 0 ? 'pos' : 'neg' }, money(Math.abs(saved))),
    ),
    h('div.kv',
      h('span.kv__k', 'Media mensual'),
      h('span.kv__v', { class: saved >= 0 ? 'pos' : 'neg' }, money(saved / horizon)),
    ),
    p.totalInterest
      ? h('div.kv',
          h('span.kv__k', 'De eso, intereses de préstamos'),
          h('span.kv__v.neg', money(p.totalInterest)),
        )
      : null,
  ));

  if (p.totalInterest > 0) {
    root.append(h('div.note',
      'En este plazo pagarías ',
      h('strong', { class: 'neg' }, money(p.totalInterest)),
      ' solo en intereses. Es dinero que no compra nada: es el precio de haber pedido prestado.',
    ));
  }

  /* ------------------------------------------------ peso de los fijos -- */
  const fixedMo = state.recurrings
    .filter((r) => !r.archived && r.kind !== 'ingreso')
    .reduce((s, r) => s + monthlyEquivalent(r), 0);
  const incomeMo = state.recurrings
    .filter((r) => !r.archived && r.kind === 'ingreso')
    .reduce((s, r) => s + monthlyEquivalent(r), 0);

  if (incomeMo > 0) {
    const ratio = (fixedMo / incomeMo) * 100;
    root.append(h('h2.section-title', 'Peso de los gastos fijos'));
    root.append(h('div.card',
      h('div.kv',
        h('span.kv__k', 'Se va en gastos fijos'),
        h('span.kv__v', { class: ratio > 70 ? 'neg' : '' }, percent(ratio, 0)),
      ),
      h('div.kv',
        h('span.kv__k', 'Te queda libre al mes'),
        h('span.kv__v', { class: incomeMo - fixedMo >= 0 ? 'pos' : 'neg' }, money(incomeMo - fixedMo)),
      ),
    ));
  }

  /* ---------------------------------------------------------- tabla ---- */
  root.append(h('h2.section-title', 'Detalle'));
  root.append(h('div.segmented', { style: { marginBottom: '12px' } },
    h('button', {
      type: 'button', 'aria-pressed': String(!detailed),
      onclick: () => { detailed = false; rerender(); },
    }, 'Por años'),
    h('button', {
      type: 'button', 'aria-pressed': String(detailed),
      onclick: () => { detailed = true; rerender(); },
    }, 'Mes a mes'),
  ));

  root.append(h('div.card', { style: { padding: '10px' } },
    h('div.table-wrap', detailed ? monthTable(p) : yearTable(p)),
  ));

  return root;
}

function monthTable(p) {
  return h('table.data',
    h('thead', h('tr',
      h('th', 'Mes'), h('th', 'Ingresos'), h('th', 'Gastos'), h('th', 'Neto'), h('th', 'Saldo'),
    )),
    h('tbody', ...p.months.map((m) => h('tr',
      h('td', fmtMonth(m.key)),
      h('td', { class: 'pos' }, money(m.income)),
      h('td', { class: 'neg' }, money(m.expense)),
      h('td', { class: m.net >= 0 ? 'pos' : 'neg' }, money(m.net)),
      h('td', { class: m.balance < 0 ? 'neg' : '' }, money(m.balance)),
    ))),
  );
}

function yearTable(p) {
  /* Agrupa por año natural; el saldo del año es el del último mes incluido. */
  const years = new Map();
  for (const m of p.months) {
    const y = m.key.slice(0, 4);
    if (!years.has(y)) years.set(y, { y, income: 0, expense: 0, interest: 0, balance: 0 });
    const row = years.get(y);
    row.income += m.income;
    row.expense += m.expense;
    row.interest += m.interest;
    row.balance = m.balance;
  }

  return h('table.data',
    h('thead', h('tr',
      h('th', 'Año'), h('th', 'Ingresos'), h('th', 'Gastos'), h('th', 'Neto'), h('th', 'Saldo final'),
    )),
    h('tbody', ...[...years.values()].map((r) => h('tr',
      h('td', r.y),
      h('td', { class: 'pos' }, money(r.income)),
      h('td', { class: 'neg' }, money(r.expense)),
      h('td', { class: r.income - r.expense >= 0 ? 'pos' : 'neg' }, money(r.income - r.expense)),
      h('td', { class: r.balance < 0 ? 'neg' : '' }, money(r.balance)),
    ))),
  );
}

export const title = 'Proyección';
