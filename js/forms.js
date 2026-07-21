/**
 * Formularios modales: movimiento puntual y movimiento recurrente (incluye
 * préstamos con cuadro de amortización y vista previa en vivo).
 */

import {
  h, modal, toast, confirmDialog, readNumber, markInvalid, setChildren, ICONS, svgIcon,
} from './ui.js';
import {
  money, percent, todayISO, fmtDate, fmtDuration, currencySymbol, addMonths,
} from './format.js';
import {
  FREQUENCIES, loanSchedule, recurringEndDate, monthlyEquivalent, occurrencesBetween,
} from './finance.js';
import {
  getState, categoriesFor, categoryById, addTransaction, updateTransaction, deleteTransaction,
  addRecurring, updateRecurring, deleteRecurring,
  getConfirmation, confirmOccurrence, unconfirmOccurrence,
} from './state.js';

/* ============================================ movimiento puntual ======== */

export function transactionForm(existing = null) {
  let kind = existing?.kind ?? 'gasto';
  let categoryId = existing?.categoryId ?? null;

  const amountInput = h('input.input.input--amount', {
    type: 'text', inputmode: 'decimal', placeholder: '0,00',
    value: existing ? String(existing.amount).replace('.', ',') : '',
    'aria-label': 'Importe',
  });
  const dateInput = h('input.input', { type: 'date', value: existing?.date ?? todayISO() });
  const noteInput = h('input.input', {
    type: 'text', placeholder: 'p. ej. Compra semanal', value: existing?.note ?? '',
    maxlength: 80,
  });

  const chipsBox = h('div.chips');

  const renderChips = () => {
    chipsBox.replaceChildren(...categoriesFor(kind).map((c) =>
      h('button.chip', {
        type: 'button',
        'aria-pressed': String(categoryId === c.id),
        onclick: () => { categoryId = categoryId === c.id ? null : c.id; renderChips(); },
      }, `${c.icon} ${c.name}`)));
  };

  const seg = h('div.segmented', { class: kind === 'ingreso' ? 'segmented--income' : 'segmented--expense' });
  const renderSeg = () => {
    seg.className = `segmented segmented--${kind === 'ingreso' ? 'income' : 'expense'}`;
    seg.replaceChildren(
      ...[['gasto', 'Gasto'], ['ingreso', 'Ingreso']].map(([k, label]) =>
        h('button', {
          type: 'button', 'aria-pressed': String(kind === k),
          onclick: () => {
            if (kind === k) return;
            kind = k;
            categoryId = null;     // las categorías no se comparten entre tipos
            renderSeg();
            renderChips();
          },
        }, label)),
    );
  };
  renderSeg();
  renderChips();

  modal({
    title: existing ? 'Editar movimiento' : 'Nuevo movimiento',
    render: (close) => {
      const submit = () => {
        const amount = readNumber(amountInput);
        if (!Number.isFinite(amount) || amount <= 0) {
          return markInvalid(amountInput, 'Introduce un importe mayor que cero.');
        }
        if (!dateInput.value) return markInvalid(dateInput, 'Elige una fecha.');

        const data = {
          kind, amount: Math.abs(amount), date: dateInput.value,
          categoryId, note: noteInput.value.trim(),
        };
        if (existing) { updateTransaction(existing.id, data); toast('Movimiento actualizado'); }
        else { addTransaction(data); toast('Movimiento guardado'); }
        close();
      };

      const form = h('form', {
        onsubmit: (e) => { e.preventDefault(); submit(); },
      },
        seg,
        h('div', { style: { margin: '16px 0' } }, amountInput),
        h('label.field',
          h('span.field__label', 'Fecha'),
          dateInput,
        ),
        h('label.field',
          h('span.field__label', 'Concepto'),
          noteInput,
        ),
        h('div.field',
          h('span.field__label', 'Categoría'),
          chipsBox,
        ),
        h('div.row-actions',
          existing
            ? h('button.btn.btn--danger', {
                type: 'button',
                onclick: async () => {
                  if (await confirmDialog({
                    title: '¿Borrar movimiento?',
                    message: 'Esta acción no se puede deshacer.',
                    confirmText: 'Borrar', danger: true,
                  })) { deleteTransaction(existing.id); toast('Movimiento borrado'); close(); }
                },
              }, svgIcon(ICONS.trash), 'Borrar')
            : null,
          h('button.btn.btn--primary', { type: 'submit' }, 'Guardar'),
        ),
      );
      return form;
    },
  });

  setTimeout(() => amountInput.focus(), 60);
}

/* ================================================ confirmar un cobro ==== */

/**
 * Hoja para marcar un vencimiento como cobrado.
 *
 * @param {object} occ ocurrencia de occurrencesWithStatus() / flowsBetween():
 *                     necesita recurringId, dueDate, amount, name, kind, status.
 */
export function chargeForm(occ) {
  const rec = getState().recurrings.find((r) => r.id === occ.recurringId);
  const prevista = occ.dueDate ?? occ.date;
  const c = getConfirmation(occ.recurringId, prevista);
  const esIngreso = occ.kind === 'ingreso';
  const verbo = esIngreso ? 'ingresado' : 'cobrado';

  const amountInput = h('input.input', {
    type: 'text', inputmode: 'decimal',
    value: String(c?.amount ?? occ.amount).replace('.', ','),
  });
  const dateInput = h('input.input', { type: 'date', value: c?.paidDate ?? prevista });
  const noteInput = h('input.input', {
    type: 'text', placeholder: 'Opcional', value: c?.note ?? '', maxlength: 80,
  });

  const cat = rec?.categoryId ? categoryById(rec.categoryId) : null;

  modal({
    title: rec?.name ?? occ.name ?? 'Cobro',
    render: (close) => {
      const guardar = (skipped) => {
        const amount = readNumber(amountInput);
        if (!skipped && (!Number.isFinite(amount) || amount <= 0)) {
          return markInvalid(amountInput, 'Introduce el importe real.');
        }
        if (!skipped && !dateInput.value) return markInvalid(dateInput, 'Elige la fecha.');

        confirmOccurrence(occ.recurringId, prevista, {
          paidDate: dateInput.value,
          // Guardamos el importe solo si difiere del previsto: así, si luego
          // editas el recurrente, la confirmación sigue el importe nuevo.
          amount: Math.abs(amount) === Math.abs(occ.amount) ? null : Math.abs(amount),
          skipped,
          note: noteInput.value.trim(),
        });
        toast(skipped ? 'Marcado como no cobrado' : `Marcado como ${verbo}`);
        close();
      };

      return h('div',
        h('div.hero', { style: { marginBottom: '16px' } },
          h('div.hero__label', c ? `Ya marcado como ${verbo}` : `Previsto para el ${fmtDate(prevista)}`),
          h('div.hero__value', { class: esIngreso ? 'pos' : 'neg' },
            money(esIngreso ? occ.amount : -occ.amount)),
          cat ? h('div.hero__sub', `${cat.icon} ${cat.name}`) : null,
        ),

        c
          ? h('div.note', { style: { marginBottom: '14px' } },
              c.skipped
                ? 'Marcado como NO cobrado: no cuenta para tu saldo.'
                : `Marcado como ${verbo} el ${fmtDate(c.paidDate)}`
                  + (c.amount != null ? ` por ${money(c.amount)} (en vez de ${money(occ.amount)}).` : '.'))
          : h('div.note', { style: { marginBottom: '14px' } },
              occ.status === 'asumido'
                ? 'Ya pasó la fecha, así que se está dando por cobrado y ya está restado de tu saldo. '
                  + 'Confírmalo para dejarlo cerrado, o corrige el importe si te cobraron otra cosa.'
                : 'Aún no ha vencido. Puedes adelantarte y marcarlo si ya te lo han cobrado.'),

        h('label.field',
          h('span.field__label', `Importe real que te han ${verbo}`),
          amountInput,
          h('span.field__hint', 'Si te cobraron de más o de menos, ponlo aquí: el saldo usará esta cifra.'),
        ),
        h('label.field',
          h('span.field__label', `Fecha en la que te lo han ${verbo}`),
          dateInput,
        ),
        h('label.field',
          h('span.field__label', 'Nota'),
          noteInput,
        ),

        h('div.row-actions',
          h('button.btn.btn--primary', { onclick: () => guardar(false) },
            svgIcon(ICONS.check), c ? 'Actualizar' : `Sí, me lo han ${verbo}`),
        ),
        h('div.row-actions', { style: { marginTop: '8px' } },
          h('button.btn', { onclick: () => guardar(true) }, `No me lo han ${verbo}`),
          c
            ? h('button.btn.btn--danger', {
                onclick: () => {
                  unconfirmOccurrence(occ.recurringId, prevista);
                  toast('Marca deshecha');
                  close();
                },
              }, 'Deshacer marca')
            : null,
        ),

        rec
          ? h('button.btn.btn--ghost.btn--block', {
              style: { marginTop: '14px' },
              onclick: () => { close(); recurringForm(rec); },
            }, 'Editar el recurrente completo')
          : null,
      );
    },
  });
}

/* ============================================ movimiento recurrente ===== */

export function recurringForm(existing = null) {
  let type = existing?.type ?? 'simple';
  let kind = existing?.kind ?? 'gasto';
  let categoryId = existing?.categoryId ?? null;
  let endMode = existing?.endMode ?? 'nunca';

  const sym = currencySymbol();

  /* --- campos comunes --------------------------------------------------- */
  const nameInput = h('input.input', {
    type: 'text', placeholder: 'p. ej. Alquiler', value: existing?.name ?? '', maxlength: 60,
  });
  const startInput = h('input.input', { type: 'date', value: existing?.startDate ?? todayISO() });

  /* --- campos "simple" -------------------------------------------------- */
  const amountInput = h('input.input', {
    type: 'text', inputmode: 'decimal', placeholder: '0,00',
    value: existing?.amount != null ? String(existing.amount).replace('.', ',') : '',
  });
  const freqSelect = h('select.select', {},
    ...Object.entries(FREQUENCIES).map(([k, f]) =>
      h('option', { value: k, selected: (existing?.frequency ?? 'mensual') === k }, f.label)));
  const endDateInput = h('input.input', { type: 'date', value: existing?.endDate ?? '' });
  const occInput = h('input.input', {
    type: 'number', min: '1', step: '1', placeholder: '12',
    value: existing?.occurrences ?? '',
  });
  const increaseInput = h('input.input', {
    type: 'text', inputmode: 'decimal', placeholder: '0',
    value: existing?.annualIncrease != null ? String(existing.annualIncrease).replace('.', ',') : '',
  });

  /* --- campos "préstamo" ------------------------------------------------ */
  const principalInput = h('input.input', {
    type: 'text', inputmode: 'decimal', placeholder: '15000',
    value: existing?.principal != null ? String(existing.principal).replace('.', ',') : '',
  });
  const rateInput = h('input.input', {
    type: 'text', inputmode: 'decimal', placeholder: '6,5',
    value: existing?.annualRate != null ? String(existing.annualRate).replace('.', ',') : '',
  });
  const monthsInput = h('input.input', {
    type: 'number', min: '1', max: '600', step: '1', placeholder: '60',
    value: existing?.months ?? '',
  });
  const insuranceInput = h('input.input', {
    type: 'text', inputmode: 'decimal', placeholder: '0',
    value: existing?.insuranceMonthly != null ? String(existing.insuranceMonthly).replace('.', ',') : '',
  });
  const feeInput = h('input.input', {
    type: 'text', inputmode: 'decimal', placeholder: '0',
    value: existing?.openingFee != null ? String(existing.openingFee).replace('.', ',') : '',
  });

  /* --- bloques dinámicos ------------------------------------------------ */
  const chipsBox = h('div.chips');
  const renderChips = () => {
    const k = type === 'prestamo' ? 'gasto' : kind;
    chipsBox.replaceChildren(...categoriesFor(k).map((c) =>
      h('button.chip', {
        type: 'button', 'aria-pressed': String(categoryId === c.id),
        onclick: () => { categoryId = categoryId === c.id ? null : c.id; renderChips(); },
      }, `${c.icon} ${c.name}`)));
  };

  const kindSeg = h('div.segmented');
  const renderKindSeg = () => {
    kindSeg.className = `segmented segmented--${kind === 'ingreso' ? 'income' : 'expense'}`;
    kindSeg.replaceChildren(...[['gasto', 'Gasto'], ['ingreso', 'Ingreso']].map(([k, label]) =>
      h('button', {
        type: 'button', 'aria-pressed': String(kind === k),
        onclick: () => { if (kind === k) return; kind = k; categoryId = null; renderKindSeg(); renderChips(); },
      }, label)));
  };

  const endBox = h('div');
  const renderEnd = () => {
    setChildren(endBox,
      h('div.field',
        h('span.field__label', 'Duración'),
        h('div.segmented',
          ...[['nunca', 'Indefinido'], ['repeticiones', 'Nº de veces'], ['fecha', 'Hasta fecha']].map(([m, label]) =>
            h('button', {
              type: 'button', 'aria-pressed': String(endMode === m),
              onclick: () => { endMode = m; renderEnd(); refreshPreview(); },
            }, label)),
        ),
      ),
      endMode === 'repeticiones'
        ? h('label.field',
            h('span.field__label', 'Número de pagos'),
            occInput,
            h('span.field__hint', 'Contando el primero, en la fecha de inicio.'))
        : null,
      endMode === 'fecha'
        ? h('label.field', h('span.field__label', 'Último pago (como muy tarde)'), endDateInput)
        : null,
    );
  };

  const preview = h('div.note');

  const simpleBox = h('div',
    kindSeg,
    h('div', { style: { height: '14px' } }),
    h('label.field',
      h('span.field__label', `Importe por pago (${sym})`),
      amountInput,
    ),
    h('label.field',
      h('span.field__label', 'Frecuencia'),
      freqSelect,
    ),
    // `startField` lo inserta renderType() justo aquí: es el mismo nodo en los
    // dos bloques, así que no puede estar escrito en ambos a la vez.
    endBox,
    h('label.field',
      h('span.field__label', 'Revalorización anual (%)'),
      increaseInput,
      h('span.field__hint', 'Subida automática cada año, para alquileres o cuotas ligadas al IPC. Déjalo en 0 si el importe es fijo.'),
    ),
  );

  const loanBox = h('div',
    h('label.field',
      h('span.field__label', `Capital prestado (${sym})`),
      principalInput,
    ),
    h('div.grid-2',
      h('label.field',
        h('span.field__label', 'Interés TIN anual (%)'),
        rateInput,
      ),
      h('label.field',
        h('span.field__label', 'Plazo (meses)'),
        monthsInput,
      ),
    ),
    h('div.grid-2',
      h('label.field',
        h('span.field__label', `Seguro mensual (${sym})`),
        insuranceInput,
      ),
      h('label.field',
        h('span.field__label', `Comisión apertura (${sym})`),
        feeInput,
      ),
    ),
  );

  /* Campo de fecha compartido: un único `startInput` que renderType() mueve al
     bloque visible, cambiándole solo la etiqueta. */
  const startFieldLabel = h('span.field__label', 'Primer pago');
  const startField = h('label.field', startFieldLabel, startInput);

  const body = h('div');
  const typeSeg = h('div.segmented',
    ...[['simple', 'Fijo / periódico'], ['prestamo', 'Préstamo']].map(([t, label]) =>
      h('button', {
        type: 'button', 'data-type': t, 'aria-pressed': String(type === t),
        onclick: () => { if (type === t) return; type = t; renderType(); },
      }, label)));

  const typeHint = h('span.field__hint');

  function renderType() {
    for (const b of typeSeg.children) {
      b.setAttribute('aria-pressed', String(b.dataset.type === type));
    }
    typeHint.textContent = type === 'prestamo'
      ? 'Calcula la cuota por el sistema francés e imputa los intereses mes a mes.'
      : 'Para nóminas, alquileres, suscripciones o cualquier importe que se repite.';
    if (type === 'simple') {
      startFieldLabel.textContent = 'Primer pago';
      simpleBox.insertBefore(startField, endBox);
      body.replaceChildren(simpleBox);
    } else {
      startFieldLabel.textContent = 'Primera cuota';
      loanBox.append(startField);
      body.replaceChildren(loanBox);
    }
    renderChips();
    refreshPreview();
  }

  /* --- vista previa en vivo -------------------------------------------- */
  function refreshPreview() {
    if (type === 'prestamo') {
      const principal = readNumber(principalInput);
      const rate = readNumber(rateInput) || 0;
      const months = Number(monthsInput.value);
      if (!Number.isFinite(principal) || principal <= 0 || !months || months < 1) {
        preview.className = 'note';
        preview.replaceChildren('Rellena capital y plazo para ver la cuota, los intereses totales y la TAE.');
        return;
      }
      const s = loanSchedule({
        principal, annualRate: rate, months,
        insuranceMonthly: readNumber(insuranceInput) || 0,
        openingFee: readNumber(feeInput) || 0,
        startDate: startInput.value || todayISO(),
      });
      preview.className = 'note';
      setChildren(preview,
        h('div.kv', h('span.kv__k', 'Cuota mensual'), h('span.kv__v', money(s.monthlyOutflow))),
        h('div.kv', h('span.kv__k', 'Intereses totales'), h('span.kv__v.neg', money(s.totalInterest))),
        s.totalInsurance ? h('div.kv', h('span.kv__k', 'Seguro total'), h('span.kv__v.neg', money(s.totalInsurance))) : null,
        h('div.kv', h('span.kv__k', 'Total a devolver'), h('span.kv__v', money(s.totalPaid))),
        h('div.kv',
          h('span.kv__k', 'Te cuesta de más'),
          h('span.kv__v.neg', `${money(s.totalCost)} (${percent(principal ? (s.totalCost / principal) * 100 : 0, 1)})`)),
        s.apr != null ? h('div.kv', h('span.kv__k', 'TAE estimada'), h('span.kv__v', percent(s.apr))) : null,
        h('div.kv', h('span.kv__k', 'Duración'), h('span.kv__v', fmtDuration(months))),
      );
    } else {
      const amount = readNumber(amountInput);
      if (!Number.isFinite(amount) || amount <= 0) {
        preview.className = 'note';
        preview.replaceChildren('Introduce el importe para ver el coste mensual equivalente y el total.');
        return;
      }
      const draft = {
        type: 'simple', kind, amount, frequency: freqSelect.value,
        startDate: startInput.value || todayISO(), endMode,
        endDate: endDateInput.value, occurrences: Number(occInput.value) || 1,
        annualIncrease: readNumber(increaseInput) || 0,
      };
      const eq = monthlyEquivalent(draft);
      const end = recurringEndDate(draft);
      const cls = kind === 'ingreso' ? 'pos' : 'neg';

      let totalRow = null;
      if (endMode !== 'nunca') {
        const life = lifetimeTotal(draft);
        totalRow = h('div.kv',
          h('span.kv__k', `Total (${life.count} pagos)`),
          h('span.kv__v', { class: cls }, money(life.total)));
      } else {
        const life = lifetimeTotal({ ...draft, endMode: 'repeticiones', occurrences: Math.round(FREQUENCIES[draft.frequency].perYear * 10) });
        totalRow = h('div.kv',
          h('span.kv__k', 'En 10 años sumaría'),
          h('span.kv__v', { class: cls }, money(life.total)));
      }

      preview.className = 'note';
      setChildren(preview,
        h('div.kv', h('span.kv__k', 'Equivale al mes'), h('span.kv__v', { class: cls }, money(eq))),
        h('div.kv', h('span.kv__k', 'Equivale al año'), h('span.kv__v', { class: cls }, money(eq * 12))),
        totalRow,
        end ? h('div.kv', h('span.kv__k', 'Último pago'), h('span.kv__v', fmtDate(end))) : null,
        draft.annualIncrease
          ? h('div.small.faint', { style: { marginTop: '6px' } },
              `Incluye la subida del ${draft.annualIncrease} % anual.`)
          : null,
      );
    }
  }

  for (const el of [amountInput, freqSelect, startInput, endDateInput, occInput, increaseInput,
    principalInput, rateInput, monthsInput, insuranceInput, feeInput]) {
    el.addEventListener('input', refreshPreview);
    el.addEventListener('change', refreshPreview);
  }

  renderKindSeg();
  renderEnd();
  renderType();

  modal({
    title: existing ? 'Editar recurrente' : 'Nuevo recurrente',
    render: (close) => {
      const submit = () => {
        const name = nameInput.value.trim();
        if (!name) return markInvalid(nameInput, 'Ponle un nombre.');
        if (!startInput.value) return markInvalid(startInput, 'Elige la fecha del primer pago.');

        let data;
        if (type === 'prestamo') {
          const principal = readNumber(principalInput);
          if (!Number.isFinite(principal) || principal <= 0) {
            return markInvalid(principalInput, 'Introduce el capital del préstamo.');
          }
          const months = Number(monthsInput.value);
          if (!Number.isInteger(months) || months < 1 || months > 600) {
            return markInvalid(monthsInput, 'El plazo debe estar entre 1 y 600 meses.');
          }
          const rate = readNumber(rateInput);
          if (rateInput.value.trim() !== '' && (!Number.isFinite(rate) || rate < 0 || rate > 100)) {
            return markInvalid(rateInput, 'El TIN debe estar entre 0 y 100.');
          }
          data = {
            type: 'prestamo', name, kind: 'gasto', categoryId,
            principal, annualRate: rate || 0, months,
            insuranceMonthly: readNumber(insuranceInput) || 0,
            openingFee: readNumber(feeInput) || 0,
            startDate: startInput.value,
          };
        } else {
          const amount = readNumber(amountInput);
          if (!Number.isFinite(amount) || amount <= 0) {
            return markInvalid(amountInput, 'Introduce un importe mayor que cero.');
          }
          if (endMode === 'fecha' && !endDateInput.value) {
            return markInvalid(endDateInput, 'Indica la fecha final.');
          }
          if (endMode === 'fecha' && endDateInput.value < startInput.value) {
            return markInvalid(endDateInput, 'La fecha final es anterior al primer pago.');
          }
          if (endMode === 'repeticiones') {
            const n = Number(occInput.value);
            if (!Number.isInteger(n) || n < 1 || n > 5000) {
              return markInvalid(occInput, 'Indica cuántos pagos hay (entre 1 y 5000).');
            }
          }
          data = {
            type: 'simple', name, kind, categoryId, amount,
            frequency: freqSelect.value, startDate: startInput.value, endMode,
            endDate: endMode === 'fecha' ? endDateInput.value : null,
            occurrences: endMode === 'repeticiones' ? Number(occInput.value) : null,
            annualIncrease: readNumber(increaseInput) || 0,
          };
        }

        if (existing) { updateRecurring(existing.id, data); toast('Recurrente actualizado'); }
        else { addRecurring(data); toast('Recurrente creado'); }
        close();
      };

      return h('form', { onsubmit: (e) => { e.preventDefault(); submit(); } },
        h('label.field',
          h('span.field__label', 'Nombre'),
          nameInput,
        ),
        h('div.field',
          h('span.field__label', 'Tipo'),
          typeSeg,
          typeHint,
        ),
        body,
        h('div.field',
          h('span.field__label', 'Categoría'),
          chipsBox,
        ),
        h('div.field',
          h('span.field__label', 'Resumen'),
          preview,
        ),
        h('div.row-actions',
          existing
            ? h('button.btn.btn--danger', {
                type: 'button',
                onclick: async () => {
                  if (await confirmDialog({
                    title: `¿Borrar "${existing.name}"?`,
                    message: 'Se eliminará de la proyección y de los próximos vencimientos. No se puede deshacer.',
                    confirmText: 'Borrar', danger: true,
                  })) { deleteRecurring(existing.id); toast('Recurrente borrado'); close(); }
                },
              }, svgIcon(ICONS.trash), 'Borrar')
            : null,
          h('button.btn.btn--primary', { type: 'submit' }, 'Guardar'),
        ),
      );
    },
  });

  refreshPreview();
  setTimeout(() => nameInput.focus(), 60);
}

/**
 * Total acumulado de una recurrencia a lo largo de su vida.
 * Las indefinidas se acotan a 10 años para poder dar una cifra.
 */
function lifetimeTotal(draft) {
  const end = recurringEndDate(draft) ?? addMonths(draft.startDate, 120);
  const list = occurrencesBetween(draft, draft.startDate, end);
  return { total: list.reduce((s, o) => s + o.amount, 0), count: list.length };
}
