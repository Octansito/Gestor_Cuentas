/**
 * Vista "Hucha": dinero que apartas (lo guardas por otro lado). Meter baja tu
 * saldo del día a día; sacar lo sube. No cuenta como gasto/ingreso del mes.
 */

import { h, svgIcon, ICONS, modal, toast, confirmDialog, readNumber, markInvalid } from '../ui.js';
import { money, todayISO, fmtDateRelative, fmtDate } from '../format.js';
import { huchaBalance } from '../finance.js';
import { getState, addHucha, updateHucha, deleteHucha } from '../state.js';
import { empty } from './shared.js';

export function render(rerender) {
  const state = getState();
  const saldo = huchaBalance(state);
  const movimientos = [...state.hucha].sort((a, b) => b.date.localeCompare(a.date) || (b.id > a.id ? 1 : -1));
  const root = h('div.stack');

  root.append(h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' } },
    h('a.btn.btn--ghost', { href: '#/resumen', 'aria-label': 'Volver', style: { padding: '6px' } },
      svgIcon('M15 6l-6 6 6 6', { stroke: true, size: 18 })),
    h('h2', { style: { fontSize: '18px' } }, '🐷 Hucha'),
  ));

  root.append(h('div.hero',
    h('div.hero__label', 'Guardado en la hucha'),
    h('div.hero__value', money(saldo)),
    h('div.hero__sub', 'Este dinero está apartado: no cuenta en tu "te queda para gastar".'),
  ));

  root.append(h('div.row-actions', { style: { marginTop: '14px' } },
    h('button.btn.btn--primary', { onclick: () => huchaForm(rerender, 'meter') }, svgIcon(ICONS.plus), 'Meter dinero'),
    h('button.btn', { onclick: () => huchaForm(rerender, 'sacar') }, 'Sacar dinero'),
  ));

  root.append(h('div.note', { style: { marginTop: '14px' } },
    'Al meter dinero en la hucha, tu saldo general baja (ya no lo puedes gastar). Al sacarlo, '
    + 'vuelve a tu saldo. Es un traspaso, no un gasto ni un ingreso.'));

  if (!movimientos.length) {
    root.append(empty({ icon: '🐷', title: 'Hucha vacía', text: 'Mete dinero cuando quieras apartar algo para ahorrar.' }));
    return root;
  }

  root.append(h('h2.section-title', 'Movimientos de la hucha'));
  for (const hv of movimientos) {
    const meter = hv.amount >= 0;
    root.append(h('button.row', { type: 'button', onclick: () => huchaForm(rerender, meter ? 'meter' : 'sacar', hv) },
      h('div.row__icon', meter ? '⬇️' : '⬆️'),
      h('div.row__main',
        h('div.row__title', hv.note || (meter ? 'Metido en la hucha' : 'Sacado de la hucha')),
        h('div.row__sub', fmtDateRelative(hv.date)),
      ),
      h('div.row__amount', { class: meter ? 'pos' : 'neg' }, `${meter ? '+' : '−'}${money(Math.abs(hv.amount))}`),
    ));
  }

  return root;
}

function huchaForm(rerender, modo, existing = null) {
  const meter = modo === 'meter';
  const amountInput = h('input.input.input--amount', {
    type: 'text', inputmode: 'decimal', placeholder: '0,00',
    value: existing ? String(Math.abs(existing.amount)).replace('.', ',') : '',
    'aria-label': 'Importe',
  });
  const dateInput = h('input.input', { type: 'date', value: existing?.date ?? todayISO() });
  const noteInput = h('input.input', { type: 'text', placeholder: meter ? 'p. ej. Ahorro del mes' : 'p. ej. Para el viaje', value: existing?.note ?? '', maxlength: 60 });

  modal({
    title: existing ? 'Editar movimiento' : meter ? 'Meter en la hucha' : 'Sacar de la hucha',
    render: (close) => {
      const guardar = () => {
        const v = readNumber(amountInput);
        if (!Number.isFinite(v) || v <= 0) return markInvalid(amountInput, 'Introduce un importe mayor que cero.');
        if (!dateInput.value) return markInvalid(dateInput, 'Elige la fecha.');
        const amount = meter ? Math.abs(v) : -Math.abs(v);
        const data = { amount, date: dateInput.value, note: noteInput.value.trim() };
        if (existing) { updateHucha(existing.id, data); toast('Actualizado'); }
        else { addHucha(data); toast(meter ? 'Guardado en la hucha' : 'Sacado de la hucha'); }
        close(); rerender();
      };
      return h('form', { onsubmit: (e) => { e.preventDefault(); guardar(); } },
        h('div', { style: { margin: '4px 0 14px' } }, amountInput),
        h('label.field', h('span.field__label', 'Fecha'), dateInput),
        h('label.field', h('span.field__label', 'Concepto'), noteInput),
        h('div.row-actions',
          existing
            ? h('button.btn.btn--danger', {
                type: 'button',
                onclick: async () => { if (await confirmDialog({ title: '¿Borrar movimiento?', message: 'No se puede deshacer.', confirmText: 'Borrar', danger: true })) { deleteHucha(existing.id); toast('Borrado'); close(); rerender(); } },
              }, svgIcon(ICONS.trash), 'Borrar')
            : null,
          h('button.btn.btn--primary', { type: 'submit' }, 'Guardar'),
        ),
      );
    },
  });
  setTimeout(() => amountInput.focus(), 60);
}

export const title = 'Hucha';
