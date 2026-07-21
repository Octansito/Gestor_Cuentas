/**
 * Motor financiero: recurrencias, amortización de préstamos y proyección.
 *
 * Convenios usados en todo el módulo:
 *  - Los importes se guardan siempre en positivo; el signo lo aporta `kind`
 *    ('ingreso' | 'gasto'). `signed()` es el único sitio que convierte.
 *  - Las fechas son cadenas ISO "YYYY-MM-DD".
 *  - El interés se introduce como TIN anual nominal (%); el tipo mensual es
 *    TIN/12, que es la convención de los préstamos francés en España.
 */

import {
  addDays, addMonths, cmpISO, daysInMonth, monthIndex, monthKey, parseISO, toISO,
} from './format.js';

/** Frecuencias soportadas para los movimientos recurrentes. */
export const FREQUENCIES = {
  semanal:    { label: 'Semanal',     unit: 'day',   step: 7,  perYear: 365.25 / 7 },
  quincenal:  { label: 'Quincenal',   unit: 'day',   step: 14, perYear: 365.25 / 14 },
  mensual:    { label: 'Mensual',     unit: 'month', step: 1,  perYear: 12 },
  bimestral:  { label: 'Bimestral',   unit: 'month', step: 2,  perYear: 6 },
  trimestral: { label: 'Trimestral',  unit: 'month', step: 3,  perYear: 4 },
  semestral:  { label: 'Semestral',   unit: 'month', step: 6,  perYear: 2 },
  anual:      { label: 'Anual',       unit: 'month', step: 12, perYear: 1 },
};

export function signed(kind, amount) {
  return kind === 'ingreso' ? Math.abs(amount) : -Math.abs(amount);
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/* ======================================================================== *
 *  PRÉSTAMOS — sistema francés (cuota constante)
 * ======================================================================== */

/**
 * Cuota mensual constante de un préstamo francés.
 *   cuota = P · i / (1 − (1+i)^−n)
 * con i = tipo mensual y n = número de cuotas.
 */
export function loanPayment(principal, annualRatePct, months) {
  const P = Number(principal) || 0;
  const n = Math.max(1, Math.round(Number(months) || 0));
  const i = (Number(annualRatePct) || 0) / 100 / 12;
  if (P <= 0) return 0;
  if (i === 0) return P / n;               // préstamo sin intereses: reparto lineal
  return (P * i) / (1 - Math.pow(1 + i, -n));
}

/**
 * Cuadro de amortización completo.
 *
 * @returns {{
 *   payment:number, rows:Array, totalInterest:number, totalPrincipal:number,
 *   totalInsurance:number, totalPaid:number, monthlyOutflow:number, apr:number|null
 * }}
 */
export function loanSchedule({ principal, annualRate, months, insuranceMonthly = 0, openingFee = 0, startDate }) {
  const P = Number(principal) || 0;
  const n = Math.max(1, Math.round(Number(months) || 0));
  const i = (Number(annualRate) || 0) / 100 / 12;
  const ins = Number(insuranceMonthly) || 0;
  const fee = Number(openingFee) || 0;

  const payment = round2(loanPayment(P, annualRate, n));

  const rows = [];
  let balance = P;
  let totalInterest = 0;

  for (let k = 1; k <= n; k++) {
    const interest = round2(balance * i);
    // En la última cuota liquidamos el saldo vivo exacto para que no quede
    // un residuo de céntimos por el redondeo acumulado de las anteriores.
    let principalPart = k === n ? round2(balance) : round2(payment - interest);
    let due = k === n ? round2(principalPart + interest) : payment;

    balance = round2(balance - principalPart);
    totalInterest = round2(totalInterest + interest);

    rows.push({
      k,
      date: startDate ? addMonths(startDate, k - 1) : null,
      payment: due,
      interest,
      principal: principalPart,
      insurance: ins,
      outflow: round2(due + ins),
      balance: Math.max(0, balance),
    });
  }

  const totalInsurance = round2(ins * n);
  const totalPaid = round2(rows.reduce((s, r) => s + r.payment, 0) + totalInsurance + fee);

  return {
    payment,
    rows,
    totalInterest,
    totalPrincipal: round2(P),
    totalInsurance,
    openingFee: fee,
    totalPaid,
    totalCost: round2(totalPaid - P),        // lo que te cuesta de más el dinero
    monthlyOutflow: round2(payment + ins),
    apr: loanAPR({ principal: P, payment, months: n, insuranceMonthly: ins, openingFee: fee }),
  };
}

/**
 * TAE (coste efectivo anual) por búsqueda del tipo interno de rentabilidad.
 *
 * Resuelve el tipo mensual `r` que iguala el neto recibido con el valor actual
 * de todos los pagos, incluyendo seguro y comisión de apertura:
 *
 *   P − comisión = Σ (cuota + seguro) / (1+r)^k     para k = 1..n
 *
 * y devuelve TAE = ((1+r)^12 − 1) · 100.
 *
 * El VAN es monótono decreciente en `r`, así que la bisección converge sin
 * los problemas de arranque que tendría Newton-Raphson.
 */
export function loanAPR({ principal, payment, months, insuranceMonthly = 0, openingFee = 0 }) {
  const net = (Number(principal) || 0) - (Number(openingFee) || 0);
  const pmt = (Number(payment) || 0) + (Number(insuranceMonthly) || 0);
  const n = Math.max(1, Math.round(Number(months) || 0));

  if (net <= 0 || pmt <= 0) return null;
  if (pmt * n <= net) return 0;          // no se paga nada de más: TAE 0

  const npv = (r) => {
    if (r === 0) return pmt * n - net;
    return pmt * (1 - Math.pow(1 + r, -n)) / r - net;
  };

  let lo = 0;
  let hi = 1;                            // 100 % mensual: techo absurdamente alto a propósito
  if (npv(hi) > 0) return null;          // fuera de rango razonable

  for (let it = 0; it < 200; it++) {
    const mid = (lo + hi) / 2;
    if (npv(mid) > 0) lo = mid; else hi = mid;
    if (hi - lo < 1e-12) break;
  }

  const r = (lo + hi) / 2;
  return round2((Math.pow(1 + r, 12) - 1) * 100);
}

/* ======================================================================== *
 *  RECURRENTES — generación de vencimientos
 * ======================================================================== */

/** Fecha del último vencimiento, o null si la recurrencia no termina nunca. */
export function recurringEndDate(rec) {
  if (rec.type === 'prestamo') {
    return addMonths(rec.startDate, Math.max(1, rec.months) - 1);
  }
  if (rec.endMode === 'fecha') return rec.endDate || null;
  if (rec.endMode === 'repeticiones') {
    const f = FREQUENCIES[rec.frequency] ?? FREQUENCIES.mensual;
    const k = Math.max(1, Number(rec.occurrences) || 1) - 1;
    return f.unit === 'day'
      ? addDays(rec.startDate, f.step * k)
      : addMonths(rec.startDate, f.step * k);
  }
  return null; // 'nunca'
}

/**
 * Vencimientos de una recurrencia dentro de [from, to], ambos inclusive.
 * @returns {Array<{date:string, amount:number, kind:string, recurringId:string,
 *                  name:string, interest?:number, principal?:number}>}
 */
export function occurrencesBetween(rec, from, to) {
  const out = [];
  if (!rec.startDate || cmpISO(rec.startDate, to) > 0) return out;

  /* --- Préstamo: los vencimientos salen del cuadro de amortización ------- */
  if (rec.type === 'prestamo') {
    const sched = loanSchedule({
      principal: rec.principal,
      annualRate: rec.annualRate,
      months: rec.months,
      insuranceMonthly: rec.insuranceMonthly,
      openingFee: rec.openingFee,
      startDate: rec.startDate,
    });
    for (const r of sched.rows) {
      if (cmpISO(r.date, from) < 0) continue;
      if (cmpISO(r.date, to) > 0) break;
      out.push({
        date: r.date,
        amount: r.outflow,
        kind: 'gasto',
        recurringId: rec.id,
        name: rec.name,
        categoryId: rec.categoryId,
        interest: r.interest,
        principal: r.principal,
        k: r.k,
      });
    }
    return out;
  }

  /* --- Simple: paso fijo con revalorización anual opcional --------------- */
  const f = FREQUENCIES[rec.frequency] ?? FREQUENCIES.mensual;
  const end = recurringEndDate(rec);
  const hardEnd = end && cmpISO(end, to) < 0 ? end : to;
  const growth = (Number(rec.annualIncrease) || 0) / 100;
  const maxOcc = rec.endMode === 'repeticiones'
    ? Math.max(1, Number(rec.occurrences) || 1)
    : Infinity;

  let date = rec.startDate;
  let k = 0;
  // Cota dura: evita un bucle infinito si llegara una configuración corrupta.
  const LIMIT = 20000;

  while (k < LIMIT && k < maxOcc && cmpISO(date, hardEnd) <= 0) {
    if (cmpISO(date, from) >= 0) {
      // La revalorización se aplica por años completos transcurridos desde el inicio.
      const years = Math.floor((monthIndex(date) - monthIndex(rec.startDate)) / 12);
      const amount = growth
        ? round2(rec.amount * Math.pow(1 + growth, Math.max(0, years)))
        : round2(rec.amount);
      out.push({
        date,
        amount,
        kind: rec.kind,
        recurringId: rec.id,
        name: rec.name,
        categoryId: rec.categoryId,
        k: k + 1,
      });
    }
    k++;
    date = f.unit === 'day'
      ? addDays(rec.startDate, f.step * k)
      : addMonths(rec.startDate, f.step * k);
  }

  return out;
}

/** Coste medio mensual equivalente (para comparar recurrencias entre sí). */
export function monthlyEquivalent(rec) {
  if (rec.type === 'prestamo') {
    const p = loanPayment(rec.principal, rec.annualRate, rec.months);
    return round2(p + (Number(rec.insuranceMonthly) || 0));
  }
  const f = FREQUENCIES[rec.frequency] ?? FREQUENCIES.mensual;
  return round2((Number(rec.amount) || 0) * f.perYear / 12);
}

/**
 * Resumen del impacto total de una recurrencia a lo largo de su vida.
 * Para las indefinidas se acota al horizonte indicado (en meses).
 */
export function recurringLifetime(rec, horizonMonths = 120) {
  if (rec.type === 'prestamo') {
    const s = loanSchedule({
      principal: rec.principal,
      annualRate: rec.annualRate,
      months: rec.months,
      insuranceMonthly: rec.insuranceMonthly,
      openingFee: rec.openingFee,
      startDate: rec.startDate,
    });
    return {
      total: s.totalPaid,
      interest: s.totalInterest,
      count: rec.months,
      bounded: true,
      endDate: recurringEndDate(rec),
      schedule: s,
    };
  }

  const end = recurringEndDate(rec);
  const cap = addMonths(rec.startDate, horizonMonths);
  const to = end && cmpISO(end, cap) < 0 ? end : cap;
  const occ = occurrencesBetween(rec, rec.startDate, to);
  return {
    total: round2(occ.reduce((s, o) => s + o.amount, 0)),
    interest: 0,
    count: occ.length,
    bounded: Boolean(end),
    endDate: end,
    schedule: null,
  };
}

/* ======================================================================== *
 *  FLUJOS Y SALDO
 *
 *  Criterio único de toda la app: el saldo en una fecha es
 *
 *      saldo inicial + Σ (movimientos puntuales + vencimientos recurrentes)
 *
 *  de todo lo comprendido entre `settings.trackingStart` y esa fecha.
 *
 *  Es decir: los recurrentes se dan por cobrados/pagados en su fecha (son las
 *  facturas que sabes que van a pasar) y los movimientos puntuales son los
 *  extras que anotas a mano. Así no hay que registrar el alquiler cada mes y
 *  el saldo de hoy y la proyección de mañana salen de la misma fórmula.
 *
 *  `trackingStart` evita que un recurrente con fecha de inicio antigua
 *  ("alquiler desde 2019") arrastre años de histórico al saldo actual.
 * ======================================================================== */

/**
 * Estado de una ocurrencia recurrente:
 *   'cobrado'  → confirmada por el usuario
 *   'omitido'  → confirmada como "no me lo cobraron" (no cuenta para nada)
 *   'asumido'  → ya venció y no la has confirmado; se da por cobrada igualmente
 *   'previsto' → aún no ha vencido
 *
 * Los vencidos se asumen cobrados a propósito: si hiciera falta confirmarlos
 * para que contasen, bastaría no abrir la app un mes para que el saldo mintiera.
 */
export function occurrenceStatus(occ, confirmation, today) {
  if (confirmation?.skipped) return 'omitido';
  if (confirmation) return 'cobrado';
  return cmpISO(occ.date, today) <= 0 ? 'asumido' : 'previsto';
}

/** Índice de confirmaciones por (recurrente, fecha prevista), para no hacer O(n²). */
function confirmationIndex(state) {
  const map = new Map();
  for (const c of state.confirmations ?? []) map.set(`${c.recurringId}@${c.dueDate}`, c);
  return map;
}

/**
 * Todos los flujos entre dos fechas, con las confirmaciones ya aplicadas.
 *
 * Una confirmación puede mover el flujo de fecha (te cobraron otro día) o
 * cambiarle el importe (te cobraron de más). Por eso generamos las ocurrencias
 * en una ventana más ancha que el rango pedido y filtramos después por la fecha
 * efectiva: si no, un cobro previsto el 30 de junio y confirmado el 2 de julio
 * se perdería en los dos meses.
 */
export function flowsBetween(state, from, to) {
  const { transactions, recurrings } = state;
  const today = todayISOLocal();
  const confirmed = confirmationIndex(state);
  const out = [];

  for (const t of transactions) {
    if (cmpISO(t.date, from) >= 0 && cmpISO(t.date, to) <= 0) {
      out.push({
        date: t.date, kind: t.kind, amount: Math.abs(t.amount),
        name: t.note || null, categoryId: t.categoryId, source: 'tx', id: t.id,
        status: 'cobrado',
      });
    }
  }

  const WINDOW = 45; // margen para las confirmaciones que cambian de fecha
  for (const rec of recurrings) {
    if (rec.archived) continue;
    for (const o of occurrencesBetween(rec, addDays(from, -WINDOW), addDays(to, WINDOW))) {
      const c = confirmed.get(`${rec.id}@${o.date}`);
      const status = occurrenceStatus(o, c, today);
      if (status === 'omitido') continue;

      const date = c?.paidDate ?? o.date;
      if (cmpISO(date, from) < 0 || cmpISO(date, to) > 0) continue;

      out.push({
        ...o,
        source: 'rec',
        dueDate: o.date,        // la fecha prevista sigue siendo la identidad
        date,                   // la fecha efectiva es la que mueve el saldo
        amount: c?.amount ?? o.amount,
        status,
        confirmation: c ?? null,
      });
    }
  }

  return out.sort((a, b) => cmpISO(a.date, b.date));
}

function trackingStartOf(settings) {
  return settings.trackingStart || todayFirstOfMonth();
}

/** Saldo en una fecha concreta (inclusive). */
export function balanceAt(state, dateISO) {
  const from = trackingStartOf(state.settings);
  let b = Number(state.settings.initialBalance) || 0;
  if (cmpISO(dateISO, from) < 0) return round2(b);
  for (const f of flowsBetween(state, from, dateISO)) b += signed(f.kind, f.amount);
  return round2(b);
}

/** Saldo a día de hoy. */
export function currentBalance(state) {
  return balanceAt(state, todayISOLocal());
}

/* ======================================================================== *
 *  PROYECCIÓN — evolución del saldo mes a mes
 * ======================================================================== */

/**
 * Proyecta el saldo mes a mes desde el mes actual.
 *
 * @returns {{months:Array<{key,income,expense,net,balance,interest}>,
 *            startBalance:number, endBalance:number, totalIncome:number,
 *            totalExpense:number, totalInterest:number, lowest:object}}
 */
export function project(state, horizonMonths = 60, fromISO) {
  const track = trackingStartOf(state.settings);
  let start = fromISO || todayFirstOfMonth();
  if (cmpISO(start, track) < 0) start = track;

  const startKey = monthKey(start);
  const endDate = addMonths(start, horizonMonths);

  /* Saldo de partida: todo lo ocurrido antes del primer mes proyectado. */
  let balance = balanceAt(state, addDays(start, -1));
  const startBalance = balance;

  /* Esqueleto de meses. */
  const months = [];
  const byKey = new Map();
  for (let m = 0; m < horizonMonths; m++) {
    const key = monthKey(addMonths(start, m));
    const row = { key, income: 0, expense: 0, net: 0, balance: 0, interest: 0, events: [] };
    months.push(row);
    byKey.set(key, row);
  }

  /* Reparto de todos los flujos del horizonte en su mes. */
  for (const f of flowsBetween(state, start, addDays(endDate, -1))) {
    const row = byKey.get(monthKey(f.date));
    if (!row) continue;
    if (f.kind === 'ingreso') row.income = round2(row.income + f.amount);
    else row.expense = round2(row.expense + f.amount);
    if (f.interest) row.interest = round2(row.interest + f.interest);
    if (f.name) row.events.push({ date: f.date, name: f.name, kind: f.kind, amount: f.amount });
  }

  /* Acumulado. */
  let totalIncome = 0;
  let totalExpense = 0;
  let totalInterest = 0;
  let lowest = null;

  for (const row of months) {
    row.net = round2(row.income - row.expense);
    balance = round2(balance + row.net);
    row.balance = balance;
    totalIncome = round2(totalIncome + row.income);
    totalExpense = round2(totalExpense + row.expense);
    totalInterest = round2(totalInterest + row.interest);
    if (!lowest || row.balance < lowest.balance) lowest = row;
  }

  return {
    months,
    startKey,
    startBalance,
    endBalance: round2(balance),
    totalIncome,
    totalExpense,
    totalInterest,
    lowest,
  };
}

function todayISOLocal() {
  const n = new Date();
  return toISO(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

function todayFirstOfMonth() {
  const n = new Date();
  return toISO(n.getFullYear(), n.getMonth() + 1, 1);
}

/**
 * Foto económica de un mes: qué ha entrado y salido ya, y qué falta.
 *
 * Es lo que alimenta el "te queda X del sueldo": `libre` empieza siendo el
 * total de ingresos del mes y va bajando conforme se gasta y se compromete.
 *
 * @param {string} key "YYYY-MM"
 */
export function monthBudget(state, key) {
  const [y, m] = key.split('-').map(Number);
  const from = toISO(y, m, 1);
  const to = toISO(y, m, daysInMonth(y, m));
  const today = todayISOLocal();

  const flows = flowsBetween(state, from, to);
  const hecho = (f) => f.status === 'cobrado' || f.status === 'asumido';

  const sum = (pred) => round2(flows.filter(pred).reduce((s, f) => s + f.amount, 0));

  const income = sum((f) => f.kind === 'ingreso');
  const incomeReceived = sum((f) => f.kind === 'ingreso' && hecho(f));
  const expense = sum((f) => f.kind === 'gasto');
  const expenseSoFar = sum((f) => f.kind === 'gasto' && hecho(f));
  const expensePending = round2(expense - expenseSoFar);

  const balance = balanceAt(state, today);
  const incomePending = round2(income - incomeReceived);

  // Lo que puedes gastar hoy: el dinero que TIENES menos lo que ya está
  // comprometido este mes.
  //
  // A propósito NO se suman los ingresos pendientes. Sumar la nómina que aún no
  // te han pagado daría una cifra mayor que tu saldo real bajo una etiqueta que
  // dice "te queda para gastar", que es exactamente el número que te lleva a
  // gastar de más. Lo que sí incluye la nómina es `endOfMonth`, y va aparte.
  const available = round2(balance - expensePending);
  const endOfMonth = round2(balance - expensePending + incomePending);

  return {
    key, from, to,
    income, incomeReceived, incomePending,
    expense, expenseSoFar, expensePending,
    net: round2(income - expense),            // balance del mes: lo que entra menos lo que sale
    balance,                                   // saldo real de hoy
    available,                                 // gastable ahora mismo, sin contar lo no cobrado
    endOfMonth,                                // saldo previsto para el día 1 del mes que viene
    // Cuánto del sueldo del mes te has fundido ya (0..1). Sin ingresos no aplica.
    consumido: income > 0 ? Math.min(1, expenseSoFar / income) : 0,
    comprometido: income > 0 ? Math.min(1, expense / income) : 0,
    flows,
  };
}

/**
 * Semanas de un mes, de lunes a domingo (convención española).
 *
 * La primera y la última semana se recortan a los días que caen dentro del mes:
 * si no, los totales por semana no sumarían el total del mes.
 */
export function weeksOfMonth(state, key) {
  const [y, m] = key.split('-').map(Number);
  const first = toISO(y, m, 1);
  const last = toISO(y, m, daysInMonth(y, m));

  // getDay(): 0=domingo. Lo giramos para que 0=lunes.
  const dow = (iso) => { const { y: a, m: b, d } = parseISO(iso); return (new Date(a, b - 1, d).getDay() + 6) % 7; };

  const weeks = [];
  let cursor = first;
  let n = 1;
  while (cmpISO(cursor, last) <= 0) {
    const weekEnd = addDays(cursor, 6 - dow(cursor));
    const to = cmpISO(weekEnd, last) > 0 ? last : weekEnd;
    const flows = flowsBetween(state, cursor, to);
    weeks.push({
      n: n++,
      from: cursor,
      to,
      income: round2(flows.filter((f) => f.kind === 'ingreso').reduce((s, f) => s + f.amount, 0)),
      expense: round2(flows.filter((f) => f.kind === 'gasto').reduce((s, f) => s + f.amount, 0)),
      flows,
    });
    cursor = addDays(to, 1);
  }
  for (const w of weeks) w.net = round2(w.income - w.expense);
  return weeks;
}

/** Los 12 meses de un año, con sus totales. */
export function monthsOfYear(state, year) {
  const out = [];
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    const flows = flowsBetween(state, toISO(year, m, 1), toISO(year, m, daysInMonth(year, m)));
    const income = round2(flows.filter((f) => f.kind === 'ingreso').reduce((s, f) => s + f.amount, 0));
    const expense = round2(flows.filter((f) => f.kind === 'gasto').reduce((s, f) => s + f.amount, 0));
    out.push({ key, m, income, expense, net: round2(income - expense) });
  }
  return out;
}

/**
 * Reparto por categoría de los flujos de un rango. Devuelve la lista ordenada
 * de mayor a menor, con el total para poder calcular porcentajes.
 */
export function byCategory(state, kind, from, to) {
  const map = new Map();
  let total = 0;
  for (const f of flowsBetween(state, from, to)) {
    if (f.kind !== kind) continue;
    const key = f.categoryId || '__none__';
    map.set(key, round2((map.get(key) || 0) + f.amount));
    total = round2(total + f.amount);
  }
  const items = [...map.entries()]
    .map(([categoryId, value]) => ({ categoryId, value }))
    .sort((a, b) => b.value - a.value);
  return { items, total };
}

/**
 * Ocurrencias recurrentes en un rango, con su estado. A diferencia de
 * flowsBetween(), aquí NO se filtran las omitidas ni se mueven de fecha:
 * esto sirve para pintar listas y avisos, no para calcular saldos.
 */
export function occurrencesWithStatus(state, from, to) {
  const today = todayISOLocal();
  const confirmed = confirmationIndex(state);
  const out = [];
  for (const rec of state.recurrings) {
    if (rec.archived) continue;
    for (const o of occurrencesBetween(rec, from, to)) {
      const c = confirmed.get(`${rec.id}@${o.date}`);
      out.push({
        ...o,
        source: 'rec',
        dueDate: o.date,
        status: occurrenceStatus(o, c, today),
        confirmation: c ?? null,
        amount: c?.amount ?? o.amount,
      });
    }
  }
  return out.sort((a, b) => cmpISO(a.date, b.date));
}

/**
 * Lo que hay que enseñar en el aviso: cobros ya vencidos sin confirmar y
 * cobros que llegan en los próximos `days` días.
 */
export function pendingCharges(state, days = 7, lookback = 10) {
  const today = todayISOLocal();

  // Solo miramos `lookback` días atrás. Como los vencidos ya se dan por
  // cobrados, confirmarlos es opcional: si aquí saliera todo el histórico sin
  // confirmar, el aviso estaría siempre lleno y acabarías ignorándolo. Diez
  // días es lo que tarda un cargo en aparecer en el banco y lo que puedes
  // comprobar de memoria.
  const vencidos = occurrencesWithStatus(state, addDays(today, -lookback), today)
    .filter((o) => o.status === 'asumido');
  const proximos = occurrencesWithStatus(state, addDays(today, 1), addDays(today, days))
    .filter((o) => o.status === 'previsto');
  return { vencidos, proximos, today };
}

/** Próximos vencimientos de las recurrencias, ordenados por fecha. */
export function upcoming(state, days = 30, fromISO) {
  const from = fromISO || todayISOLocal();
  return occurrencesWithStatus(state, from, addDays(from, days))
    .filter((o) => o.status !== 'omitido');
}

export { round2 };
