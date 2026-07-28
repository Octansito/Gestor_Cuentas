/**
 * Vista "Cartera": inversiones (MyInvestor u otra).
 *
 * Sección aparte del día a día. Muestra aportado / ganado / valor total y una
 * gráfica de puntos de cómo ha ido subiendo o bajando.
 */

import { h, modal, toast, confirmDialog, readNumber, markInvalid, svgIcon, ICONS } from '../ui.js';
import { money, percent, fmtDate, fmtDateRelative, todayISO } from '../format.js';
import { investmentSummary, investmentSeries, valuationValue } from '../investments.js';
import { lineChart } from '../charts.js';
import {
  getState, setInvestmentName,
  addContribution, updateContribution, deleteContribution,
  addValuation, updateValuation, deleteValuation,
} from '../state.js';
import { empty } from './shared.js';

let metrica = 'valor';   // 'valor' | 'ganancia'
let rango = 'semana';    // 'semana' | 'mes'

export function render(rerender) {
  const state = getState();
  const s = investmentSummary(state);
  const root = h('div.stack');

  const vacio = !s.nAportaciones && !s.nValoraciones;
  if (vacio) {
    root.append(empty({
      icon: '📈',
      title: 'Aún no hay inversiones',
      text: 'Registra lo que tienes metido y ve anotando cada par de días el valor que te '
          + 'marca MyInvestor. La app te dirá cuánto has ganado y te dibujará la evolución.',
      action: h('button.btn.btn--primary', { onclick: () => contributionForm() }, 'Añadir aportación'),
    }));
    return root;
  }

  /* ------------------------------------------------------- cabecera ----- */
  root.append(h('div.hero',
    h('div.hero__label', s.nombre),
    h('div.hero__value', money(s.valorActual)),
    h('div.hero__sub', { class: s.ganancia >= 0 ? 'pos' : 'neg' },
      `${s.ganancia >= 0 ? '▲' : '▼'} ${money(Math.abs(s.ganancia))} `
      + `(${s.ganancia >= 0 ? '+' : '−'}${percent(Math.abs(s.rentabilidad), 1)})`),
  ));

  root.append(h('div.duo',
    h('div.stat',
      h('div.stat__label', 'Aportado por ti'),
      h('div.stat__value', money(s.aportado)),
    ),
    h('div.stat',
      h('div.stat__label', s.ganancia >= 0 ? 'Ganado en bolsa' : 'Perdido en bolsa'),
      h('div.stat__value', { class: s.ganancia >= 0 ? 'pos' : 'neg' }, money(s.ganancia)),
    ),
  ));

  if (s.variacion != null && s.ultima) {
    root.append(h('div.card',
      h('div.kv',
        h('span.kv__k', `Desde tu última anotación (${fmtDateRelative(s.ultima.date)})`),
        h('span.kv__v', { class: s.variacion >= 0 ? 'pos' : 'neg' },
          `${s.variacion >= 0 ? '+' : ''}${money(s.variacion)}`),
      ),
    ));
  }

  /* Botones de añadir ARRIBA, para que nunca queden bajo el menú inferior. */
  root.append(h('div.row-actions', { style: { marginTop: '14px' } },
    h('button.btn.btn--primary', { onclick: () => valuationForm() },
      svgIcon(ICONS.plus), 'Anotar valor de hoy'),
    h('button.btn', { onclick: () => contributionForm() },
      svgIcon(ICONS.plus), 'Aportar / retirar'),
  ));

  /* -------------------------------------------------------- gráfica ----- */
  root.append(h('h2.section-title', 'Evolución'));

  root.append(h('div.segmented', { style: { marginBottom: '10px' } },
    ...[['valor', 'Valor total'], ['ganancia', 'Ganancia']].map(([m, label]) =>
      h('button', {
        type: 'button', 'aria-pressed': String(metrica === m),
        onclick: () => { metrica = m; rerender(); },
      }, label)),
  ));

  const serie = investmentSeries(state, rango);
  const puntos = serie.map((p) => ({ label: p.label, value: p[metrica] }));

  root.append(h('div.card',
    h('div.segmented', { style: { marginBottom: '12px' } },
      ...[['semana', 'Por semanas'], ['mes', 'Por meses']].map(([r, label]) =>
        h('button', {
          type: 'button', 'aria-pressed': String(rango === r),
          onclick: () => { rango = r; rerender(); },
        }, label)),
    ),
    lineChart(puntos, {
      height: 210,
      dots: true,
      emptyText: 'Anota al menos dos valoraciones para ver la gráfica',
    }),
    h('div.small.faint.center', { style: { marginTop: '6px' } },
      metrica === 'valor'
        ? 'Valor total de la cartera. Sube cuando aportas y cuando el mercado sube.'
        : 'Solo la ganancia (sin contar lo que aportas). Esto es lo que de verdad sube o baja.'),
  ));

  /* ---------------------------------------------------- valoraciones --- */
  if (s.valuations.length) {
    root.append(h('h2.section-title', 'Valoraciones anotadas'));
    root.append(h('div.list', ...[...s.valuations].reverse().slice(0, 8).map((v) => {
      const aportadoAqui = s.contributions
        .filter((c) => c.date <= v.date).reduce((a, c) => a + c.amount, 0);
      const valor = valuationValue(state.investment, v);
      const gan = Math.round((valor - aportadoAqui) * 100) / 100;
      return h('button.row', { type: 'button', onclick: () => valuationForm(v) },
        h('div.row__icon', '📊'),
        h('div.row__main',
          h('div.row__title', money(valor)),
          h('div.row__sub', `${fmtDateRelative(v.date)}${v.mode === 'ganancia' ? ' · anotaste la ganancia' : ''}`),
        ),
        h('div', { style: { textAlign: 'right' } },
          h('div.row__amount', { class: gan >= 0 ? 'pos' : 'neg' },
            `${gan >= 0 ? '+' : ''}${money(gan)}`),
          h('div.small.faint', { style: { fontSize: '10.5px' } }, 'ganancia'),
        ),
      );
    })));
  }

  /* ---------------------------------------------------- aportaciones --- */
  if (s.contributions.length) {
    root.append(h('h2.section-title', 'Aportaciones'));
    root.append(h('div.list', ...[...s.contributions].reverse().slice(0, 8).map((c) =>
      h('button.row', { type: 'button', onclick: () => contributionForm(c) },
        h('div.row__icon', c.amount >= 0 ? '💶' : '↩️'),
        h('div.row__main',
          h('div.row__title', c.note || (c.amount >= 0 ? 'Aportación' : 'Retirada')),
          h('div.row__sub', fmtDateRelative(c.date)),
        ),
        h('div.row__amount', { class: c.amount >= 0 ? 'pos' : 'neg' },
          `${c.amount >= 0 ? '+' : ''}${money(c.amount)}`),
      ))));
  }

  /* ------------------------------------------------------- renombrar --- */
  root.append(h('button.btn.btn--ghost.btn--block', {
    style: { marginTop: '18px' },
    onclick: () => renameForm(rerender),
  }, 'Cambiar nombre de la cartera'));

  return root;
}

/* ============================================================ formularios */

function valuationForm(existing = null) {
  let mode = existing?.mode ?? 'total';

  const amountInput = h('input.input.input--amount', {
    type: 'text', inputmode: 'decimal', placeholder: '0,00',
    value: existing?.amount != null ? String(existing.amount).replace('.', ',') : '',
    'aria-label': 'Importe',
  });
  const dateInput = h('input.input', { type: 'date', value: existing?.date ?? todayISO() });
  const hint = h('div.field__hint', { style: { marginBottom: '10px' } });

  const seg = h('div.segmented', { style: { marginBottom: '12px' } });
  const renderSeg = () => {
    seg.replaceChildren(...[['total', 'Valor total'], ['ganancia', 'Ganancia']].map(([m, label]) =>
      h('button', {
        type: 'button', 'aria-pressed': String(mode === m),
        onclick: () => { mode = m; renderSeg(); },
      }, label)));
    hint.textContent = mode === 'total'
      ? 'El número grande de MyInvestor: lo que vale toda tu cartera ahora mismo.'
      : 'Solo lo ganado (la plusvalía). Puede ser negativo si estás en pérdidas. '
        + 'La app le suma lo que has aportado para saber el total.';
  };
  renderSeg();

  modal({
    title: existing ? 'Editar valoración' : 'Anotar valor',
    render: (close) => {
      const submit = () => {
        const amount = readNumber(amountInput);
        // El valor total no puede ser negativo; la ganancia sí (pérdidas).
        if (!Number.isFinite(amount) || (mode === 'total' && amount < 0)) {
          return markInvalid(amountInput, mode === 'total'
            ? 'Escribe el valor total (no puede ser negativo).'
            : 'Escribe cuánto has ganado (o perdido, en negativo).');
        }
        if (!dateInput.value) return markInvalid(dateInput, 'Elige la fecha.');
        const data = { date: dateInput.value, mode, amount };
        if (existing) { updateValuation(existing.id, data); toast('Valoración actualizada'); }
        else { addValuation(data); toast('Valor anotado'); }
        close();
      };

      return h('form', { onsubmit: (e) => { e.preventDefault(); submit(); } },
        h('span.field__label', { style: { display: 'block', marginBottom: '6px' } }, '¿Qué número vas a anotar?'),
        seg,
        hint,
        h('div', { style: { margin: '4px 0 14px' } }, amountInput),
        h('label.field', h('span.field__label', 'Fecha'), dateInput),
        h('div.row-actions',
          existing
            ? h('button.btn.btn--danger', {
                type: 'button',
                onclick: async () => {
                  if (await confirmDialog({ title: '¿Borrar valoración?', message: 'No se puede deshacer.', confirmText: 'Borrar', danger: true })) {
                    deleteValuation(existing.id); toast('Borrada'); close();
                  }
                },
              }, svgIcon(ICONS.trash), 'Borrar')
            : null,
          h('button.btn.btn--primary', { type: 'submit' }, 'Guardar'),
        ),
      );
    },
  });
  setTimeout(() => amountInput.focus(), 60);
}

function contributionForm(existing = null) {
  let tipo = existing ? (existing.amount >= 0 ? 'aportar' : 'retirar') : 'aportar';

  const amountInput = h('input.input.input--amount', {
    type: 'text', inputmode: 'decimal', placeholder: '0,00',
    value: existing ? String(Math.abs(existing.amount)).replace('.', ',') : '',
    'aria-label': 'Importe',
  });
  const dateInput = h('input.input', { type: 'date', value: existing?.date ?? todayISO() });
  const noteInput = h('input.input', { type: 'text', placeholder: 'p. ej. Aportación mensual', value: existing?.note ?? '', maxlength: 60 });

  const seg = h('div.segmented');
  const renderSeg = () => {
    seg.replaceChildren(...[['aportar', 'Aportar'], ['retirar', 'Retirar']].map(([t, label]) =>
      h('button', {
        type: 'button', 'aria-pressed': String(tipo === t),
        onclick: () => { tipo = t; renderSeg(); },
      }, label)));
  };
  renderSeg();

  modal({
    title: existing ? 'Editar aportación' : 'Aportar o retirar',
    render: (close) => {
      const submit = () => {
        const raw = readNumber(amountInput);
        if (!Number.isFinite(raw) || raw <= 0) return markInvalid(amountInput, 'Introduce un importe mayor que cero.');
        if (!dateInput.value) return markInvalid(dateInput, 'Elige la fecha.');
        const amount = tipo === 'retirar' ? -Math.abs(raw) : Math.abs(raw);
        const data = { amount, date: dateInput.value, note: noteInput.value.trim() };
        if (existing) { updateContribution(existing.id, data); toast('Actualizado'); }
        else { addContribution(data); toast(tipo === 'retirar' ? 'Retirada registrada' : 'Aportación registrada'); }
        close();
      };

      return h('form', { onsubmit: (e) => { e.preventDefault(); submit(); } },
        seg,
        h('div.field__hint', { style: { margin: '8px 0 4px' } },
          'Aportar = dinero que metes de tu bolsillo. Retirar = dinero que sacas. '
          + 'Esto no cuenta como ganancia ni pérdida, solo mueve lo aportado.'),
        h('div', { style: { margin: '10px 0 14px' } }, amountInput),
        h('label.field', h('span.field__label', 'Fecha'), dateInput),
        h('label.field', h('span.field__label', 'Concepto'), noteInput),
        h('div.row-actions',
          existing
            ? h('button.btn.btn--danger', {
                type: 'button',
                onclick: async () => {
                  if (await confirmDialog({ title: '¿Borrar?', message: 'No se puede deshacer.', confirmText: 'Borrar', danger: true })) {
                    deleteContribution(existing.id); toast('Borrada'); close();
                  }
                },
              }, svgIcon(ICONS.trash), 'Borrar')
            : null,
          h('button.btn.btn--primary', { type: 'submit' }, 'Guardar'),
        ),
      );
    },
  });
  setTimeout(() => amountInput.focus(), 60);
}

function renameForm(rerender) {
  const input = h('input.input', { type: 'text', value: getState().investment.name, maxlength: 40 });
  modal({
    title: 'Nombre de la cartera',
    onClose: rerender,
    render: (close) => h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name) return markInvalid(input, 'Ponle un nombre.');
        setInvestmentName(name); toast('Nombre cambiado'); close();
      },
    },
      h('label.field', h('span.field__label', 'Nombre'), input,
        h('span.field__hint', 'p. ej. MyInvestor, Indexa, Cripto…')),
      h('button.btn.btn--primary.btn--block', { type: 'submit' }, 'Guardar'),
    ),
  });
  setTimeout(() => input.focus(), 60);
}

export const title = 'Inversiones';
