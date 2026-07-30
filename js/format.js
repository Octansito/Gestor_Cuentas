/**
 * Formateo de números y fechas.
 *
 * Todas las fechas de la app se manejan como cadenas ISO "YYYY-MM-DD" y se
 * parsean a mano. Nunca usamos `new Date("2026-01-31")` para fechas civiles:
 * ese constructor las interpreta como UTC y, en husos al oeste de Greenwich,
 * devuelve el día anterior.
 */

let _currency = 'EUR';
let _locale = 'es-ES';

export function setFormatOptions({ currency, locale }) {
  if (currency) _currency = currency;
  if (locale) _locale = locale;
}

export function money(value, { sign = false, decimals = 2 } = {}) {
  const n = Number.isFinite(value) ? value : 0;
  const s = new Intl.NumberFormat(_locale, {
    style: 'currency',
    currency: _currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Math.abs(n) < 0.005 ? 0 : n);
  // Intl ya antepone "-" a los negativos; solo añadimos "+" cuando se pide.
  return sign && n > 0 ? '+' + s : s;
}

/** Versión compacta para ejes de gráficos: 1.2k, 340, -8.5k */
export function moneyShort(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e6) return (n / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace('.', ',') + 'M';
  if (abs >= 1000) return (n / 1000).toFixed(abs >= 10000 ? 0 : 1).replace('.', ',') + 'k';
  return String(Math.round(n));
}

export function percent(value, decimals = 2) {
  return new Intl.NumberFormat(_locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(value) || 0) + ' %';
}

export function currencySymbol() {
  const parts = new Intl.NumberFormat(_locale, { style: 'currency', currency: _currency })
    .formatToParts(0);
  return parts.find((p) => p.type === 'currency')?.value ?? _currency;
}

/* ------------------------------------------------------------- fechas -- */

/** "2026-07-17" -> {y:2026, m:7, d:17} */
export function parseISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return { y, m, d };
}

/** {y,m,d} o (y,m,d) -> "2026-07-17" */
export function toISO(y, m, d) {
  if (typeof y === 'object') ({ y, m, d } = y);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function todayISO() {
  const n = new Date();
  return toISO(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

export function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

/**
 * Suma `n` meses a una fecha ISO, recortando el día al último del mes destino.
 * addMonths("2026-01-31", 1) -> "2026-02-28"
 */
export function addMonths(iso, n) {
  const { y, m, d } = parseISO(iso);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return toISO(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addDays(iso, n) {
  const { y, m, d } = parseISO(iso);
  const dt = new Date(y, m - 1, d + n);
  return toISO(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

/** Compara dos fechas ISO. Al ser de ancho fijo, el orden lexicográfico basta. */
export function cmpISO(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Índice absoluto de mes, útil para comparar y restar meses. */
export function monthIndex(iso) {
  const { y, m } = parseISO(iso);
  return y * 12 + (m - 1);
}

/** "2026-07" a partir de una fecha ISO */
export function monthKey(iso) {
  return String(iso).slice(0, 7);
}

/* ------------------------------------------------------------- ciclos -- *
 *
 * Un "ciclo" es el mes económico del usuario, que puede no empezar el día 1.
 * Con startDay = 30, el ciclo va del 30 de un mes al 30 del siguiente (ambos
 * incluidos, como pidió el usuario). Toda la lógica del ciclo vive aquí, así
 * que cambiar la regla es tocar solo este bloque.
 *
 * En meses sin ese día (febrero y el 30/31), se usa el último día del mes.
 */

/** Día en que empieza el ciclo que contiene `iso`. */
export function cycleStartOf(iso, startDay) {
  startDay = Math.min(31, Math.max(1, Number(startDay) || 1));
  const { y, m, d } = parseISO(iso);
  const startThis = Math.min(startDay, daysInMonth(y, m));
  if (d >= startThis) return toISO(y, m, startThis);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return toISO(py, pm, Math.min(startDay, daysInMonth(py, pm)));
}

/** Inicio del ciclo siguiente al que empieza en `cycleStartISO`. */
export function cycleNextStart(cycleStartISO, startDay) {
  startDay = Math.min(31, Math.max(1, Number(startDay) || 1));
  const { y, m } = parseISO(cycleStartISO);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return toISO(ny, nm, Math.min(startDay, daysInMonth(ny, nm)));
}

/** Inicio del ciclo anterior. */
export function cyclePrevStart(cycleStartISO, startDay) {
  startDay = Math.min(31, Math.max(1, Number(startDay) || 1));
  const { y, m } = parseISO(cycleStartISO);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return toISO(py, pm, Math.min(startDay, daysInMonth(py, pm)));
}

/**
 * Rango [from, to] del ciclo que contiene `iso`.
 *  - startDay = 1  → mes natural [1 .. último día].
 *  - startDay > 1  → del día 30 al 30 del siguiente, AMBOS incluidos.
 */
export function cycleRange(iso, startDay) {
  startDay = Math.min(31, Math.max(1, Number(startDay) || 1));
  const from = cycleStartOf(iso, startDay);
  if (startDay === 1) {
    const { y, m } = parseISO(from);
    return { from, to: toISO(y, m, daysInMonth(y, m)) };
  }
  return { from, to: cycleNextStart(from, startDay) };  // 30 → 30 incluido
}

/** Mes "dueño" del ciclo (el que ocupa la mayor parte), para etiquetarlo. */
export function cycleLabelKey(cycleStartISO) {
  return monthKey(addDays(cycleStartISO, 15));
}

const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DAYS_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** "17 jul 2026" */
export function fmtDate(iso) {
  const { y, m, d } = parseISO(iso);
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
}

/** "viernes, 17 de julio" (+ año si no es el actual) */
export function fmtDateLong(iso) {
  const { y, m, d } = parseISO(iso);
  const wd = DAYS_LONG[new Date(y, m - 1, d).getDay()];
  const thisYear = new Date().getFullYear();
  return `${wd}, ${d} de ${MONTHS_LONG[m - 1]}${y === thisYear ? '' : ' de ' + y}`;
}

/** "jul 2026" a partir de "2026-07" o de una fecha ISO completa */
export function fmtMonth(key) {
  const [y, m] = String(key).split('-').map(Number);
  return `${MONTHS_SHORT[m - 1]} ${y}`;
}

/** "julio de 2026" */
export function fmtMonthLong(key) {
  const [y, m] = String(key).split('-').map(Number);
  return `${MONTHS_LONG[m - 1]} de ${y}`;
}

/** "Hoy" / "Mañana" / "Ayer" / "17 jul 2026" */
export function fmtDateRelative(iso) {
  const t = todayISO();
  if (iso === t) return 'Hoy';
  if (iso === addDays(t, 1)) return 'Mañana';
  if (iso === addDays(t, -1)) return 'Ayer';
  return fmtDate(iso);
}

/** 30 -> "30 días"; 400 -> "1 año y 1 mes" (aproximado, para textos de resumen) */
export function fmtDuration(months) {
  const m = Math.round(months);
  if (m < 1) return 'menos de un mes';
  if (m < 12) return `${m} ${m === 1 ? 'mes' : 'meses'}`;
  const y = Math.floor(m / 12);
  const rem = m % 12;
  const ys = `${y} ${y === 1 ? 'año' : 'años'}`;
  if (rem === 0) return ys;
  return `${ys} y ${rem} ${rem === 1 ? 'mes' : 'meses'}`;
}
