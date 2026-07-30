/** Vista "Resumen": cuánto te queda, qué te van a cobrar y qué ha pasado. */

import { h, svgIcon, ICONS, toast } from '../ui.js';
import {
  money, percent, fmtMonthLong, fmtDate, fmtDateRelative, todayISO,
} from '../format.js';
import {
  monthBudget, project, pendingCharges, byCategory, flowsBetween,
  currentCycle, shiftCycle, huchaBalance,
} from '../finance.js';
import { barChart, categoryBars } from '../charts.js';
import { getState, categoryById, confirmOccurrence } from '../state.js';
import { flowRow, empty, fab, budgetBar } from './shared.js';
import { transactionForm, chargeForm } from '../forms.js';

export function render(rerender) {
  const state = getState();
  const today = todayISO();
  const cycle = currentCycle(state);
  const monthStart = cycle.from;
  const monthEnd = cycle.to;

  const root = h('div.stack');
  const mes = monthBudget(state, cycle);

  /* Si no has puesto tu punto de partida, guíate a hacerlo (no partes de 0). */
  if (!state.settings.initialBalance && !state.transactions.length && !state.recurrings.length) {
    root.append(h('div.alert.alert--info',
      h('div.alert__title', svgIcon(ICONS.edit), 'Empieza por tu punto de partida'),
      h('div.alert__text', 'Di cuánto dinero tienes ahora mismo para que las cuentas partan de '
        + 'ahí, no de cero. Luego mete tu nómina y tus gastos fijos.'),
      h('a.btn.btn--block', { href: '#/ajustes', style: { marginTop: '10px' } }, 'Poner mi saldo inicial'),
    ));
  }

  /* Aviso de copia: si nunca se ha hecho o hace +30 días. Tus datos solo viven
     aquí; una copia es la única red si borras el navegador o cambias de móvil. */
  const last = state.settings.lastBackup;
  const haceMucho = !last || (parseInt(today.replace(/-/g, '')) - parseInt(last.replace(/-/g, ''))) > 30;
  if (haceMucho && (state.transactions.length || state.recurrings.length)) {
    root.append(h('div.alert.alert--warn',
      h('div.alert__title', svgIcon(ICONS.download), 'Haz una copia de seguridad'),
      h('div.alert__text',
        last ? 'Hace más de un mes de tu última copia. ' : 'Aún no has hecho ninguna copia. ',
        'Tus datos viven solo en este móvil: si borras los datos del navegador o cambias de '
        + 'teléfono, se pierden. La copia es tu única red de seguridad.'),
      h('a.btn.btn--block', { href: '#/ajustes', style: { marginTop: '10px' } }, 'Ir a Ajustes y exportar'),
    ));
  }

  /* ============================================ cuánto te queda ======== */
  root.append(h('div.hero',
    h('div.hero__label', 'Te queda para gastar'),
    h('div.hero__value', { class: mes.available < 0 ? 'neg' : '' }, money(mes.available)),
    h('div.hero__sub',
      mes.expensePending > 0
        ? `${money(mes.balance)} en cuenta − ${money(mes.expensePending)} que aún te van a cobrar`
        : `${money(mes.balance)} en cuenta · nada más pendiente este mes`),
    mes.incomePending > 0
      ? h('div.hero__sub', { style: { marginTop: '8px' } },
          h('span.pos', `+${money(mes.incomePending)}`),
          ' que aún tienes que cobrar → ',
          h('strong', { class: mes.endOfMonth < 0 ? 'neg' : '' }, money(mes.endOfMonth)),
          ' a fin de mes')
      : null,
  ));

  /* Barra del sueldo consumido */
  if (mes.income > 0) {
    root.append(h('div.card',
      h('div.bar-legend',
        h('span', `Gastado ${money(mes.expenseSoFar)}`),
        h('span.faint', `de ${money(mes.income)}`),
      ),
      budgetBar(mes.consumido, mes.comprometido),
      h('div.bar-legend',
        h('span', { class: mes.consumido > 1 ? 'neg' : 'muted' },
          `${percent(mes.consumido * 100, 0)} del mes`),
        h('span.faint',
          mes.expensePending > 0
            ? `+${money(mes.expensePending)} comprometido`
            : 'sin cargos pendientes'),
      ),
      h('div.kv', { style: { marginTop: '10px' } },
        h('span.kv__k', mes.net >= 0 ? 'Ahorrarás este mes' : 'Te pasarás este mes'),
        h('span.kv__v', { class: mes.net >= 0 ? 'pos' : 'neg' }, money(Math.abs(mes.net))),
      ),
    ));
  }

  /* ================================================ avisos de cobro ==== */
  const { vencidos, proximos } = pendingCharges(state, state.settings.notifyDaysBefore ?? 3);

  if (vencidos.length) {
    const total = vencidos.reduce((s, o) => s + (o.kind === 'gasto' ? o.amount : 0), 0);
    root.append(h('div.alert.alert--warn',
      h('div.alert__title', svgIcon(ICONS.clock), `${vencidos.length} ${vencidos.length === 1 ? 'cobro' : 'cobros'} sin confirmar`),
      h('div.alert__text',
        `Ya pasó su fecha y se están dando por cobrados (${money(total)} ya restados de tu saldo). `
        + 'Confírmalos para dejarlos cerrados, o corrige el importe si te cobraron otra cosa.'),
      h('div', { style: { marginTop: '10px' } },
        ...vencidos.slice(0, 4).map((o) => flowRow(o, { showDate: true })),
        vencidos.length > 4
          ? h('div.small.faint.center', { style: { marginTop: '8px' } }, `y ${vencidos.length - 4} más`)
          : null,
      ),
      vencidos.length > 1
        ? h('button.btn.btn--block', {
            style: { marginTop: '10px' },
            onclick: () => {
              for (const o of vencidos) {
                confirmOccurrence(o.recurringId, o.dueDate ?? o.date, { paidDate: o.dueDate ?? o.date });
              }
              toast(`${vencidos.length} cobros confirmados`);
            },
          }, svgIcon(ICONS.check), 'Confirmar todos tal cual')
        : null,
    ));
  }

  if (proximos.length) {
    const total = proximos.reduce((s, o) => s + (o.kind === 'gasto' ? o.amount : 0), 0);
    root.append(h('div.alert.alert--info',
      h('div.alert__title', svgIcon(ICONS.bell), 'Te van a cobrar pronto'),
      h('div.alert__text',
        total > 0
          ? `${money(total)} en los próximos ${state.settings.notifyDaysBefore ?? 3} días.`
          : 'Movimientos previstos en los próximos días.'),
      h('div', { style: { marginTop: '10px' } },
        ...proximos.slice(0, 4).map((o) => flowRow(o, { showDate: true })),
      ),
    ));
  }

  /* ============================================ ingresos y gastos ====== */
  root.append(h('div.duo',
    h('div.stat',
      h('div.stat__label', h('span.dot.dot--income'), 'Ingresos del mes'),
      h('div.stat__value.pos', money(mes.income)),
    ),
    h('div.stat',
      h('div.stat__label', h('span.dot.dot--expense'), 'Gastos del mes'),
      h('div.stat__value.neg', money(mes.expense)),
    ),
  ));

  root.append(h('div.card',
    h('div.kv',
      h('span.kv__k', 'Saldo real hoy'),
      h('span.kv__v', { class: mes.balance < 0 ? 'neg' : '' }, money(mes.balance)),
    ),
    h('div.kv',
      h('span.kv__k', 'Tasa de ahorro'),
      h('span.kv__v', { class: mes.net >= 0 ? 'pos' : 'neg' },
        mes.income > 0 ? percent((mes.net / mes.income) * 100, 0) : '—'),
    ),
  ));

  /* ------------------------------------------------------- hucha ------ */
  const enHucha = huchaBalance(state);
  if (enHucha !== 0 || state.hucha.length) {
    root.append(h('a.row', { href: '#/hucha', style: { marginTop: '4px' } },
      h('div.row__icon', '🐷'),
      h('div.row__main',
        h('div.row__title', 'Hucha'),
        h('div.row__sub', 'Dinero apartado, fuera de tu saldo del día a día'),
      ),
      h('div.row__amount', money(enHucha)),
    ));
  } else {
    root.append(h('a.btn.btn--ghost.btn--block', { href: '#/hucha', style: { marginTop: '4px' } },
      '🐷 Abrir la hucha'));
  }

  /* ------------------------------------------- gráfico por ciclos ---- */
  const bars = [];
  for (let i = -5; i <= 6; i++) {
    const c = shiftCycle(state, cycle, i);
    const fl = flowsBetween(state, c.from, c.to).filter((f) => !f.hucha);
    bars.push({
      label: fmtMonthLong(c.labelKey).split(' ')[0].slice(0, 3),
      income: fl.filter((f) => f.kind === 'ingreso').reduce((s, f) => s + f.amount, 0),
      expense: fl.filter((f) => f.kind === 'gasto').reduce((s, f) => s + f.amount, 0),
    });
  }

  root.append(h('h2.section-title', 'Ingresos y gastos'));
  root.append(h('div.card',
    barChart(bars, { height: 190 }),
    h('div.legend',
      h('span', h('span.dot.dot--income'), 'Ingresos'),
      h('span', h('span.dot.dot--expense'), 'Gastos'),
    ),
    h('div.small.faint.center', { style: { marginTop: '6px' } },
      'Meses pasados y previsión de los próximos, incluyendo recurrentes.'),
  ));

  /* --------------------------------------------- gasto por categoría --- */
  const cats = byCategory(state, 'gasto', monthStart, monthEnd);
  if (cats.items.length) {
    root.append(h('h2.section-title', `En qué se te va · ${fmtMonthLong(cycle.labelKey)}`));
    root.append(h('div.card',
      ...categoryBars(cats.items.slice(0, 6).map((it) => {
        const c = it.categoryId === '__none__' ? null : categoryById(it.categoryId);
        return { label: c?.name ?? 'Sin categoría', value: it.value, icon: c?.icon ?? '·' };
      })),
      h('a.btn.btn--ghost.btn--block', { href: '#/historico', style: { marginTop: '10px' } },
        'Ver histórico y consejos'),
    ));
  }

  /* ---------------------------------------------------- movimientos --- */
  const recent = mes.flows.filter((f) => f.date <= today && !f.hucha).slice(-5).reverse();
  if (recent.length) {
    root.append(h('h2.section-title', 'Últimos movimientos'));
    root.append(h('div.list', ...recent.map((f) => flowRow(f, { showDate: true }))));
  } else if (!state.transactions.length && !state.recurrings.length) {
    root.append(empty({
      icon: '🌱',
      title: 'Aún no hay nada registrado',
      text: 'Empieza metiendo tu sueldo y tus gastos fijos en la pestaña Recurrentes, '
          + 'o carga los datos de ejemplo desde Ajustes para ver cómo funciona.',
    }));
  }

  root.append(fab(() => transactionForm(), 'Nuevo movimiento'));
  return root;
}

export const title = 'Resumen';
