/**
 * Vista "Recurrentes": todo lo que se repite, con su coste real a lo largo
 * del tiempo. Incluye el cuadro de amortización de los préstamos.
 */

import { h, modal, svgIcon, ICONS } from '../ui.js';
import { money, percent, fmtDate, fmtDuration, fmtMonth } from '../format.js';
import {
  FREQUENCIES, monthlyEquivalent, recurringLifetime, recurringEndDate, loanSchedule,
} from '../finance.js';
import { getState, categoryById } from '../state.js';
import { recurringForm } from '../forms.js';
import { empty, fab } from './shared.js';
import { lineChart } from '../charts.js';

export function render() {
  const state = getState();
  const recs = state.recurrings.filter((r) => !r.archived);
  const root = h('div.stack');

  if (!recs.length) {
    root.append(empty({
      icon: '🔁',
      title: 'Sin movimientos recurrentes',
      text: 'Aquí van tu nómina, el alquiler, las suscripciones y los préstamos. '
          + 'La app calcula solo lo que suponen al mes, al año y en total, con intereses incluidos.',
      action: h('button.btn.btn--primary', { onclick: () => recurringForm() }, 'Crear el primero'),
    }));
    root.append(fab(() => recurringForm(), 'Nuevo recurrente'));
    return root;
  }

  /* ------------------------------------------------------- cabecera ----- */
  const incomeMo = recs.filter((r) => r.kind === 'ingreso')
    .reduce((s, r) => s + monthlyEquivalent(r), 0);
  const expenseMo = recs.filter((r) => r.kind !== 'ingreso')
    .reduce((s, r) => s + monthlyEquivalent(r), 0);
  const net = incomeMo - expenseMo;

  root.append(h('div.hero',
    h('div.hero__label', 'Saldo recurrente mensual'),
    h('div.hero__value', { class: net >= 0 ? 'pos' : 'neg' }, money(net)),
    h('div.hero__sub', `${money(incomeMo)} de ingresos − ${money(expenseMo)} de gastos, al mes`),
  ));

  root.append(h('div.card',
    h('div.kv',
      h('span.kv__k', 'Comprometido al año'),
      h('span.kv__v', { class: net >= 0 ? 'pos' : 'neg' }, money(net * 12)),
    ),
    h('div.kv',
      h('span.kv__k', 'Gastos fijos al año'),
      h('span.kv__v.neg', money(expenseMo * 12)),
    ),
  ));

  /* --------------------------------------------------------- listas ----- */
  const groups = [
    ['Ingresos', recs.filter((r) => r.kind === 'ingreso')],
    ['Gastos fijos', recs.filter((r) => r.kind !== 'ingreso' && r.type !== 'prestamo')],
    ['Préstamos y financiación', recs.filter((r) => r.type === 'prestamo')],
  ];

  for (const [label, items] of groups) {
    if (!items.length) continue;
    root.append(h('h2.section-title', label));
    root.append(h('div.list',
      ...items
        .sort((a, b) => monthlyEquivalent(b) - monthlyEquivalent(a))
        .map((r) => recRow(r)),
    ));
  }

  root.append(fab(() => recurringForm(), 'Nuevo recurrente'));
  return root;
}

/* ---------------------------------------------------------------- fila -- */

function recRow(rec) {
  const cat = rec.categoryId ? categoryById(rec.categoryId) : null;
  const isIncome = rec.kind === 'ingreso';
  const mo = monthlyEquivalent(rec);
  const end = recurringEndDate(rec);

  const sub = [];
  if (rec.type === 'prestamo') {
    sub.push(`${rec.months} cuotas · TIN ${percent(rec.annualRate, 2)}`);
  } else {
    sub.push(FREQUENCIES[rec.frequency]?.label ?? 'Mensual');
    if (rec.annualIncrease) sub.push(`+${rec.annualIncrease} %/año`);
  }
  if (end) sub.push(`hasta ${fmtDate(end)}`);

  return h('button.row', { type: 'button', onclick: () => detail(rec) },
    h('div.row__icon', cat?.icon ?? (rec.type === 'prestamo' ? '🏦' : isIncome ? '💰' : '🔁')),
    h('div.row__main',
      h('div.row__title', rec.name),
      h('div.row__sub', sub.join(' · ')),
    ),
    h('div', { style: { textAlign: 'right' } },
      h('div.row__amount', { class: isIncome ? 'pos' : 'neg' }, money(isIncome ? mo : -mo)),
      h('div.small.faint', { style: { fontSize: '10.5px' } }, 'al mes'),
    ),
  );
}

/* -------------------------------------------------------------- detalle -- */

function detail(rec) {
  // El botón de editar se construye antes de que exista el modal, así que
  // guardamos su `close` en cuanto modal() lo devuelve.
  let close = () => {};
  const editBtn = h('button.btn.btn--ghost', {
    onclick: () => { close(); recurringForm(rec); },
    'aria-label': 'Editar',
    title: 'Editar',
  }, svgIcon(ICONS.edit));

  ({ close } = modal({
    title: rec.name,
    actions: editBtn,
    render: () => rec.type === 'prestamo' ? loanDetail(rec) : simpleDetail(rec),
  }));
}

function simpleDetail(rec) {
  const isIncome = rec.kind === 'ingreso';
  const cls = isIncome ? 'pos' : 'neg';
  const f = FREQUENCIES[rec.frequency] ?? FREQUENCIES.mensual;
  const mo = monthlyEquivalent(rec);
  const life = recurringLifetime(rec, 120);
  const end = recurringEndDate(rec);
  const cat = rec.categoryId ? categoryById(rec.categoryId) : null;

  return h('div',
    h('div.hero', { style: { marginBottom: '14px' } },
      h('div.hero__label', 'Equivale al mes'),
      h('div.hero__value', { class: cls }, money(isIncome ? mo : -mo)),
      h('div.hero__sub', `${money(rec.amount)} · ${f.label.toLowerCase()}`),
    ),

    h('div.card',
      h('div.kv', h('span.kv__k', 'Importe por pago'), h('span.kv__v', money(rec.amount))),
      h('div.kv', h('span.kv__k', 'Frecuencia'), h('span.kv__v', f.label)),
      h('div.kv', h('span.kv__k', 'Al año'), h('span.kv__v', { class: cls }, money(mo * 12))),
      cat ? h('div.kv', h('span.kv__k', 'Categoría'), h('span.kv__v', `${cat.icon} ${cat.name}`)) : null,
      h('div.kv', h('span.kv__k', 'Primer pago'), h('span.kv__v', fmtDate(rec.startDate))),
      h('div.kv', h('span.kv__k', 'Último pago'), h('span.kv__v', end ? fmtDate(end) : 'Indefinido')),
      rec.annualIncrease
        ? h('div.kv', h('span.kv__k', 'Revalorización'), h('span.kv__v', `+${rec.annualIncrease} % cada año`))
        : null,
    ),

    h('h2.section-title', life.bounded ? 'Coste total' : 'Proyección a 10 años'),
    h('div.card',
      h('div.kv',
        h('span.kv__k', life.bounded ? `Total de ${life.count} pagos` : 'Sumará en 10 años'),
        h('span.kv__v', { class: cls }, money(life.total)),
      ),
      !life.bounded
        ? h('div.kv', h('span.kv__k', 'Pagos en 10 años'), h('span.kv__v', String(life.count)))
        : h('div.kv', h('span.kv__k', 'Duración'), h('span.kv__v', fmtDuration(life.count / f.perYear * 12))),
      rec.annualIncrease
        ? h('div.kv',
            h('span.kv__k', 'Último pago costará'),
            h('span.kv__v', { class: cls },
              money(rec.amount * Math.pow(1 + rec.annualIncrease / 100, Math.floor(life.count / f.perYear)))))
        : null,
    ),

    rec.annualIncrease
      ? h('div.note', { style: { marginTop: '12px' } },
          `Con una subida del ${rec.annualIncrease} % anual, lo que hoy son ${money(rec.amount)} `
          + `serán ${money(rec.amount * Math.pow(1 + rec.annualIncrease / 100, 10))} dentro de 10 años. `
          + 'El interés compuesto también funciona en tu contra.')
      : null,
  );
}

function loanDetail(rec) {
  const s = loanSchedule({
    principal: rec.principal,
    annualRate: rec.annualRate,
    months: rec.months,
    insuranceMonthly: rec.insuranceMonthly,
    openingFee: rec.openingFee,
    startDate: rec.startDate,
  });

  const pctExtra = rec.principal ? (s.totalCost / rec.principal) * 100 : 0;

  /* Curva del capital pendiente: enseña de un vistazo por qué al principio
     casi todo lo que pagas son intereses. */
  const nth = Math.max(1, Math.ceil(s.rows.length / 60));
  const points = s.rows
    .filter((_, i) => i % nth === 0 || i === s.rows.length - 1)
    .map((r) => ({ label: fmtMonth(r.date.slice(0, 7)), value: r.balance }));

  return h('div',
    h('div.hero', { style: { marginBottom: '14px' } },
      h('div.hero__label', 'Cuota mensual'),
      h('div.hero__value.neg', money(-s.monthlyOutflow)),
      h('div.hero__sub', `${rec.months} cuotas · ${fmtDuration(rec.months)}`),
    ),

    h('h2.section-title', 'Lo que te cuesta el dinero'),
    h('div.card',
      h('div.kv', h('span.kv__k', 'Capital prestado'), h('span.kv__v', money(s.totalPrincipal))),
      h('div.kv', h('span.kv__k', 'Intereses'), h('span.kv__v.neg', money(s.totalInterest))),
      s.totalInsurance ? h('div.kv', h('span.kv__k', 'Seguro'), h('span.kv__v.neg', money(s.totalInsurance))) : null,
      s.openingFee ? h('div.kv', h('span.kv__k', 'Comisión de apertura'), h('span.kv__v.neg', money(s.openingFee))) : null,
      h('div.kv',
        h('span.kv__k', { style: { fontWeight: '650', color: 'var(--text)' } }, 'Total a devolver'),
        h('span.kv__v', money(s.totalPaid)),
      ),
      h('div.kv',
        h('span.kv__k', 'Sobrecoste'),
        h('span.kv__v.neg', `${money(s.totalCost)} · ${percent(pctExtra, 1)} del capital`),
      ),
    ),

    h('div.note', {
      class: pctExtra > 30 ? 'note--warn' : '',
      style: { marginTop: '12px' },
    },
      `Por cada ${money(100)} que te prestan, devuelves ${money(100 + pctExtra)}. `,
      s.apr != null
        ? h('span', `La TAE estimada es del ${percent(s.apr)}, frente a un TIN del ${percent(rec.annualRate)}`
            + `${s.openingFee || s.totalInsurance ? ': la diferencia son la comisión y el seguro.' : '.'}`)
        : null,
    ),

    h('h2.section-title', 'Capital pendiente'),
    h('div.card',
      lineChart(points, { height: 170 }),
      h('div.small.faint.center', { style: { marginTop: '4px' } },
        'Al principio la mayor parte de la cuota son intereses, no amortización.'),
    ),

    h('h2.section-title', 'Cuadro de amortización'),
    h('div.card', { style: { padding: '10px' } },
      h('div.table-wrap',
        h('table.data',
          h('thead', h('tr',
            h('th', 'Nº'),
            h('th', 'Fecha'),
            h('th', 'Cuota'),
            h('th', 'Interés'),
            h('th', 'Capital'),
            h('th', 'Pendiente'),
          )),
          h('tbody', ...s.rows.map((r) => h('tr', { class: r.k % 12 === 0 ? 'year-end' : '' },
            h('td', String(r.k)),
            h('td', fmtDate(r.date)),
            h('td', money(r.payment)),
            h('td', { class: 'neg' }, money(r.interest)),
            h('td', money(r.principal)),
            h('td', money(r.balance)),
          ))),
        ),
      ),
    ),
    h('div.small.faint.center', { style: { marginTop: '8px' } },
      'Sistema francés de cuota constante. Desliza la tabla para ver todas las columnas.'),
  );
}

export const title = 'Recurrentes';
