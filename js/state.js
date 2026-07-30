/**
 * Estado de la aplicación y persistencia.
 *
 * Todo vive en localStorage, en el dispositivo. No hay servidor, no hay
 * telemetría y nada sale del navegador salvo que exportes el JSON tú mismo.
 */

import { setFormatOptions, todayISO, toISO } from './format.js';

function firstOfThisMonth() {
  const n = new Date();
  return toISO(n.getFullYear(), n.getMonth() + 1, 1);
}

const STORAGE_KEY = 'gestor-cuentas/v1';
export const SCHEMA_VERSION = 1;

export const DEFAULT_CATEGORIES = [
  // Gastos
  { id: 'cat-vivienda',    name: 'Vivienda',      kind: 'gasto',   icon: '🏠' },
  { id: 'cat-super',       name: 'Supermercado',  kind: 'gasto',   icon: '🛒' },
  { id: 'cat-transporte',  name: 'Transporte',    kind: 'gasto',   icon: '🚗' },
  { id: 'cat-suministros', name: 'Suministros',   kind: 'gasto',   icon: '💡' },
  { id: 'cat-salud',       name: 'Salud',         kind: 'gasto',   icon: '⚕️' },
  { id: 'cat-ocio',        name: 'Ocio',          kind: 'gasto',   icon: '🎬' },
  { id: 'cat-restaurante', name: 'Restaurantes',  kind: 'gasto',   icon: '🍽️' },
  { id: 'cat-compras',     name: 'Compras',       kind: 'gasto',   icon: '🛍️' },
  { id: 'cat-suscrip',     name: 'Suscripciones', kind: 'gasto',   icon: '📱' },
  { id: 'cat-prestamos',   name: 'Préstamos',     kind: 'gasto',   icon: '🏦' },
  { id: 'cat-impuestos',   name: 'Impuestos',     kind: 'gasto',   icon: '🧾' },
  { id: 'cat-otros-g',     name: 'Otros gastos',  kind: 'gasto',   icon: '📦' },
  // Ingresos
  { id: 'cat-nomina',      name: 'Nómina',        kind: 'ingreso', icon: '💼' },
  { id: 'cat-freelance',   name: 'Facturación',   kind: 'ingreso', icon: '🧑‍💻' },
  { id: 'cat-alquiler-i',  name: 'Alquileres',    kind: 'ingreso', icon: '🔑' },
  { id: 'cat-inversion',   name: 'Inversiones',   kind: 'ingreso', icon: '📈' },
  { id: 'cat-otros-i',     name: 'Otros ingresos', kind: 'ingreso', icon: '💰' },
];

function defaultState() {
  return {
    version: SCHEMA_VERSION,
    settings: {
      currency: 'EUR',
      locale: 'es-ES',
      initialBalance: 0,
      // Fecha desde la que se cuenta. El saldo inicial es el que tenías ese día;
      // a partir de ahí se suman movimientos y vencimientos recurrentes.
      trackingStart: firstOfThisMonth(),
      horizonMonths: 60,
      // Avisos. `notifyDaysBefore` lo comparten los avisos de la app y el .ics,
      // para que no digan cosas distintas.
      notifyDaysBefore: 3,
      notifyEnabled: true,
      // Seguridad: hash del PIN de apertura (null = sin PIN). Ver js/lock.js.
      pinHash: null,
      // Marca de la última copia de seguridad, para avisar si llevas mucho.
      lastBackup: null,
      createdAt: todayISO(),
    },
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    transactions: [],
    recurrings: [],
    // Marcas de "esto me lo han cobrado de verdad". Ver confirmKey() abajo.
    confirmations: [],
    // Inversiones (MyInvestor u otra). Sección aparte: no toca el saldo del
    // día a día. `contributions` = lo que aportas de tu bolsillo (o retiras, en
    // negativo); `valuations` = el valor total que anotas cada par de días.
    investment: {
      name: 'MyInvestor',
      contributions: [],
      valuations: [],
    },
  };
}

function normalizeInvestment(inv) {
  const base = { name: 'MyInvestor', contributions: [], valuations: [] };
  if (!inv || typeof inv !== 'object') return base;
  return {
    name: typeof inv.name === 'string' && inv.name ? inv.name : base.name,
    contributions: Array.isArray(inv.contributions) ? inv.contributions : [],
    // Una valoración es {id, date, mode:'total'|'ganancia', amount}. Las de
    // versiones anteriores traían {value} (siempre valor total): las convertimos.
    valuations: Array.isArray(inv.valuations)
      ? inv.valuations.map((v) => (
          v.mode
            ? v
            : { id: v.id, date: v.date, mode: 'total', amount: v.value ?? v.amount ?? 0 }
        ))
      : [],
  };
}

/* --------------------------------------------------------------- store -- */

let state = defaultState();
const listeners = new Set();

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(state);
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    // Cuota llena o modo privado: avisamos en lugar de perder datos en silencio.
    console.error('No se pudo guardar en localStorage', err);
    window.dispatchEvent(new CustomEvent('storage-error', { detail: err }));
  }
}

/** Aplica un cambio, guarda y notifica a las vistas. */
export function update(mutator) {
  mutator(state);
  persist();
  emit();
}

export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = migrate(JSON.parse(raw));
  } catch (err) {
    console.error('Datos corruptos en localStorage; se arranca en limpio', err);
    state = defaultState();
  }
  limpiarRestos();
  setFormatOptions(state.settings);
  return state;
}

/**
 * Borra claves de versiones anteriores que ya no usa nadie.
 *
 * `ultimo-aviso` guardaba el tope de "una notificación al día"; ahora se avisa
 * en cada apertura y la clave no se lee nunca, pero se quedaría en el navegador
 * para siempre. Se puede quitar esta función dentro de unas cuantas versiones.
 */
function limpiarRestos() {
  for (const clave of ['gestor-cuentas/ultimo-aviso']) {
    try { localStorage.removeItem(clave); } catch { /* da igual */ }
  }
}

/**
 * Punto único donde adaptar datos guardados por versiones anteriores.
 * Hoy solo hay v1, pero deja el hueco preparado y rellena campos que falten.
 */
function migrate(data) {
  const base = defaultState();
  const out = {
    ...base,
    ...data,
    settings: { ...base.settings, ...(data.settings || {}) },
    categories: Array.isArray(data.categories) && data.categories.length
      ? data.categories
      : base.categories,
    transactions: Array.isArray(data.transactions) ? data.transactions : [],
    recurrings: Array.isArray(data.recurrings) ? data.recurrings : [],
    confirmations: Array.isArray(data.confirmations) ? data.confirmations : [],
    investment: normalizeInvestment(data.investment),
  };
  out.version = SCHEMA_VERSION;
  return out;
}

/* ------------------------------------------------- confirmaciones -- */

/**
 * Una ocurrencia recurrente se identifica por (recurrente, fecha prevista).
 * Esa pareja es la clave de su confirmación.
 */
export function confirmKey(recurringId, dueDate) {
  return `${recurringId}@${dueDate}`;
}

export function getConfirmation(recurringId, dueDate) {
  const key = confirmKey(recurringId, dueDate);
  return state.confirmations.find((c) => confirmKey(c.recurringId, c.dueDate) === key) ?? null;
}

/**
 * Marca un cobro como realizado.
 * @param {string} recurringId
 * @param {string} dueDate   fecha prevista (la que identifica la ocurrencia)
 * @param {{paidDate?:string, amount?:number, skipped?:boolean, note?:string}} data
 *        `amount` y `paidDate` permiten corregir lo que de verdad pasó:
 *        te cobraron otro día, o te cobraron de más.
 */
export function confirmOccurrence(recurringId, dueDate, data = {}) {
  update((s) => {
    const key = confirmKey(recurringId, dueDate);
    const i = s.confirmations.findIndex((c) => confirmKey(c.recurringId, c.dueDate) === key);
    const item = {
      id: uid('cnf'),
      recurringId,
      dueDate,
      paidDate: data.paidDate ?? dueDate,
      amount: data.amount ?? null,      // null = el importe previsto, sin cambios
      skipped: data.skipped ?? false,
      note: data.note ?? '',
      confirmedAt: Date.now(),
    };
    if (i >= 0) s.confirmations[i] = { ...s.confirmations[i], ...item, id: s.confirmations[i].id };
    else s.confirmations.push(item);
  });
}

/** Deshace la confirmación: la ocurrencia vuelve a "prevista/asumida". */
export function unconfirmOccurrence(recurringId, dueDate) {
  update((s) => {
    const key = confirmKey(recurringId, dueDate);
    s.confirmations = s.confirmations.filter((c) => confirmKey(c.recurringId, c.dueDate) !== key);
  });
}

export function uid(prefix = 'id') {
  // crypto.randomUUID no existe en contextos no seguros (http:// sin localhost).
  const rnd = globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}-${rnd}`;
}

/* ------------------------------------------------------------ acciones -- */

export function addTransaction(tx) {
  const item = { id: uid('tx'), createdAt: Date.now(), ...tx };
  update((s) => { s.transactions.push(item); });
  return item;
}

export function updateTransaction(id, patch) {
  update((s) => {
    const i = s.transactions.findIndex((t) => t.id === id);
    if (i >= 0) s.transactions[i] = { ...s.transactions[i], ...patch };
  });
}

export function deleteTransaction(id) {
  update((s) => { s.transactions = s.transactions.filter((t) => t.id !== id); });
}

export function addRecurring(rec) {
  const item = { id: uid('rec'), createdAt: Date.now(), archived: false, ...rec };
  update((s) => { s.recurrings.push(item); });
  return item;
}

export function updateRecurring(id, patch) {
  update((s) => {
    const i = s.recurrings.findIndex((r) => r.id === id);
    if (i >= 0) s.recurrings[i] = { ...s.recurrings[i], ...patch };
  });
}

export function deleteRecurring(id) {
  update((s) => {
    s.recurrings = s.recurrings.filter((r) => r.id !== id);
    // Sin recurrente no hay ocurrencias que confirmar: sus marcas quedarían huérfanas.
    s.confirmations = s.confirmations.filter((c) => c.recurringId !== id);
  });
}

export function updateSettings(patch) {
  update((s) => { Object.assign(s.settings, patch); });
  setFormatOptions(state.settings);
}

/* ------------------------------------------------------ inversiones -- */

export function setInvestmentName(name) {
  update((s) => { s.investment.name = name || 'Inversiones'; });
}

/** Aportación (o retirada, si `amount` es negativo) de dinero a la cartera. */
export function addContribution({ date, amount, note }) {
  const item = { id: uid('apo'), date, amount, note: note || '' };
  update((s) => { s.investment.contributions.push(item); });
  return item;
}

export function updateContribution(id, patch) {
  update((s) => {
    const i = s.investment.contributions.findIndex((c) => c.id === id);
    if (i >= 0) s.investment.contributions[i] = { ...s.investment.contributions[i], ...patch };
  });
}

export function deleteContribution(id) {
  update((s) => {
    s.investment.contributions = s.investment.contributions.filter((c) => c.id !== id);
  });
}

/**
 * Valoración anotada en una fecha. `mode` dice qué número metió el usuario:
 *   'total'    → el valor total de la cartera
 *   'ganancia' → solo lo ganado (la app deduce el total: aportado + ganancia)
 */
export function addValuation({ date, mode = 'total', amount }) {
  const item = { id: uid('val'), date, mode, amount };
  update((s) => { s.investment.valuations.push(item); });
  return item;
}

export function updateValuation(id, patch) {
  update((s) => {
    const i = s.investment.valuations.findIndex((v) => v.id === id);
    if (i >= 0) s.investment.valuations[i] = { ...s.investment.valuations[i], ...patch };
  });
}

export function deleteValuation(id) {
  update((s) => {
    s.investment.valuations = s.investment.valuations.filter((v) => v.id !== id);
  });
}

export function categoriesFor(kind) {
  return state.categories.filter((c) => c.kind === kind);
}

export function categoryById(id) {
  return state.categories.find((c) => c.id === id) ?? null;
}

export function addCategory({ name, kind, icon }) {
  const item = { id: uid('cat'), name, kind, icon: icon || '📦' };
  update((s) => { s.categories.push(item); });
  return item;
}

export function deleteCategory(id) {
  update((s) => {
    s.categories = s.categories.filter((c) => c.id !== id);
    // No borramos los movimientos huérfanos: se muestran como "Sin categoría".
    for (const t of s.transactions) if (t.categoryId === id) t.categoryId = null;
    for (const r of s.recurrings) if (r.categoryId === id) r.categoryId = null;
  });
}

/* ------------------------------------------------ copia de seguridad -- */

export function exportJSON() {
  return JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
}

/**
 * Importa una copia previa. Valida lo mínimo para no dejar el estado
 * en un limbo si el archivo no es lo que dice ser.
 */
export function importJSON(text) {
  const data = JSON.parse(text);
  if (typeof data !== 'object' || data === null) throw new Error('El archivo no contiene un objeto JSON.');
  if (!Array.isArray(data.transactions) || !Array.isArray(data.recurrings)) {
    throw new Error('No parece una copia de Gestor de Cuentas: faltan "transactions" o "recurrings".');
  }
  state = migrate(data);
  persist();
  setFormatOptions(state.settings);
  emit();
  return state;
}

export function resetAll() {
  state = defaultState();
  persist();
  setFormatOptions(state.settings);
  emit();
}

/** Datos de ejemplo para ver la app funcionando sin teclear nada. */
export function loadDemoData() {
  const today = todayISO();
  const [y, m] = today.split('-').map(Number);
  const iso = (mm, dd) => {
    const total = (y * 12 + (m - 1)) + mm;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  };

  state = defaultState();
  state.settings.initialBalance = 4200;
  state.settings.trackingStart = iso(-6, 1);   // 4.200 € era el saldo hace 6 meses
  state.recurrings = [
    {
      id: uid('rec'), type: 'simple', name: 'Nómina', kind: 'ingreso',
      categoryId: 'cat-nomina', amount: 2400, frequency: 'mensual',
      startDate: iso(-6, 25), endMode: 'nunca', annualIncrease: 2, archived: false,
    },
    {
      id: uid('rec'), type: 'simple', name: 'Alquiler piso', kind: 'gasto',
      categoryId: 'cat-vivienda', amount: 780, frequency: 'mensual',
      startDate: iso(-6, 1), endMode: 'nunca', annualIncrease: 3, archived: false,
    },
    {
      id: uid('rec'), type: 'prestamo', name: 'Préstamo coche', kind: 'gasto',
      categoryId: 'cat-prestamos', principal: 18000, annualRate: 6.5, months: 60,
      insuranceMonthly: 12, openingFee: 300, startDate: iso(-4, 5), archived: false,
    },
    {
      id: uid('rec'), type: 'simple', name: 'Internet + móvil', kind: 'gasto',
      categoryId: 'cat-suministros', amount: 45, frequency: 'mensual',
      startDate: iso(-6, 12), endMode: 'nunca', annualIncrease: 0, archived: false,
    },
    {
      id: uid('rec'), type: 'simple', name: 'Seguro hogar', kind: 'gasto',
      categoryId: 'cat-vivienda', amount: 210, frequency: 'anual',
      startDate: iso(-2, 15), endMode: 'nunca', annualIncrease: 0, archived: false,
    },
    {
      id: uid('rec'), type: 'simple', name: 'Gimnasio', kind: 'gasto',
      categoryId: 'cat-ocio', amount: 35, frequency: 'mensual',
      startDate: iso(-3, 3), endMode: 'repeticiones', occurrences: 24,
      annualIncrease: 0, archived: false,
    },
  ];
  state.transactions = [
    { id: uid('tx'), date: iso(0, Math.min(3, 28)),  kind: 'gasto',   amount: 92.4,  categoryId: 'cat-super',       note: 'Compra semanal' },
    { id: uid('tx'), date: iso(0, Math.min(6, 28)),  kind: 'gasto',   amount: 48,    categoryId: 'cat-restaurante', note: 'Cena con Marta' },
    { id: uid('tx'), date: iso(0, Math.min(8, 28)),  kind: 'gasto',   amount: 60,    categoryId: 'cat-transporte',  note: 'Gasolina' },
    { id: uid('tx'), date: iso(0, Math.min(11, 28)), kind: 'ingreso', amount: 450,   categoryId: 'cat-freelance',   note: 'Proyecto web' },
    { id: uid('tx'), date: iso(-1, 14), kind: 'gasto',   amount: 129.9, categoryId: 'cat-compras',     note: 'Zapatillas' },
    { id: uid('tx'), date: iso(-1, 20), kind: 'gasto',   amount: 88,    categoryId: 'cat-super',       note: 'Compra semanal' },
    { id: uid('tx'), date: iso(-2, 9),  kind: 'ingreso', amount: 300,   categoryId: 'cat-otros-i',     note: 'Venta bici' },
  ];

  // Inversión de ejemplo: aportación inicial + 200 €/mes, y valoraciones que
  // suben y bajan (para que la gráfica no sea una recta perfecta).
  state.investment = {
    name: 'MyInvestor',
    contributions: [
      { id: uid('apo'), date: iso(-6, 2), amount: 3000, note: 'Aportación inicial' },
      { id: uid('apo'), date: iso(-5, 2), amount: 200, note: '' },
      { id: uid('apo'), date: iso(-4, 2), amount: 200, note: '' },
      { id: uid('apo'), date: iso(-3, 2), amount: 200, note: '' },
      { id: uid('apo'), date: iso(-2, 2), amount: 200, note: '' },
      { id: uid('apo'), date: iso(-1, 2), amount: 200, note: '' },
    ],
    // Valores elegidos para que la ganancia (valor − aportado) oscile pero
    // acabe en positivo. Aportado en cada fecha: 3000, 3200, 3400, 3600, 3800, 4000.
    valuations: [
      { id: uid('val'), date: iso(-6, 4),  mode: 'total', amount: 3030 },   // +30
      { id: uid('val'), date: iso(-5, 6),  mode: 'total', amount: 3275 },   // +75
      { id: uid('val'), date: iso(-4, 8),  mode: 'total', amount: 3440 },   // +40  (baja la ganancia)
      { id: uid('val'), date: iso(-3, 5),  mode: 'total', amount: 3760 },   // +160 (sube)
      { id: uid('val'), date: iso(-2, 7),  mode: 'total', amount: 3890 },   // +90  (baja)
      { id: uid('val'), date: iso(-1, 6),  mode: 'total', amount: 4240 },   // +240 (sube)
      { id: uid('val'), date: iso(0, Math.min(4, 28)), mode: 'total', amount: 4360 },  // +360
    ],
  };

  persist();
  setFormatOptions(state.settings);
  emit();
}
