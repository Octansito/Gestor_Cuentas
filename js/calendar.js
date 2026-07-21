/**
 * Exportación de los cobros a un archivo .ics (RFC 5545).
 *
 * Es la única forma de tener notificaciones reales, a la hora exacta y con la
 * app cerrada, sin montar un servidor: se importa en Google Calendar (o el que
 * uses) y es él quien avisa.
 *
 * Se genera un VEVENT por recurrente con su RRULE, no un evento por
 * vencimiento: así el calendario los mantiene solo hacia el futuro, sin que
 * haya que volver a exportar nunca.
 */

import { FREQUENCIES, recurringEndDate, loanPayment } from './finance.js';
import { money, parseISO } from './format.js';

/** Escapa según RFC 5545 §3.3.11: barra, punto y coma, coma y salto de línea. */
function esc(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Pliega las líneas a 75 octetos (RFC 5545 §3.1).
 *
 * El límite es en OCTETOS, no en caracteres: partir por caracteres rompería
 * un UTF-8 multibyte por la mitad y el archivo quedaría corrupto. "Nómina" o
 * un emoji de categoría bastan para provocarlo, así que medimos en bytes.
 */
function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;

  const out = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // No cortar en mitad de una secuencia UTF-8: los bytes de continuación
    // son 10xxxxxx.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push(new TextDecoder().decode(bytes.slice(start, end)));
    start = end;
    limit = 74; // las líneas plegadas empiezan por un espacio, que también cuenta
  }
  return out.join('\r\n ');
}

const stamp = (iso) => iso.replace(/-/g, '');

/**
 * Desplazamiento del recordatorio respecto al inicio del evento.
 *
 * Los eventos son de día completo, así que empiezan a las 00:00 del día del
 * cargo. Para avisar `daysBefore` días antes a las `hour`:00, el desplazamiento
 * es de `daysBefore*24 − hour` horas ANTES del inicio.
 *
 * Con daysBefore=0 esa cuenta sale negativa (avisar a las 9:00 del mismo día es
 * 9 horas DESPUÉS de las 00:00), y "-PT-9H" no es válido en RFC 5545: hay que
 * emitir un desplazamiento positivo.
 */
function trigger(daysBefore, hour) {
  const h = daysBefore * 24 - hour;
  return h >= 0 ? `-PT${h}H` : `PT${-h}H`;
}

/** RRULE equivalente a nuestra frecuencia, o null si no se repite. */
function rrule(rec) {
  if (rec.type === 'prestamo') {
    return `FREQ=MONTHLY;COUNT=${Math.max(1, rec.months)}`;
  }
  const f = FREQUENCIES[rec.frequency];
  if (!f) return null;

  const base = f.unit === 'day'
    ? `FREQ=WEEKLY;INTERVAL=${f.step / 7}`
    : `FREQ=MONTHLY;INTERVAL=${f.step}`;

  if (rec.endMode === 'repeticiones' && rec.occurrences) {
    return `${base};COUNT=${rec.occurrences}`;
  }
  if (rec.endMode === 'fecha' && rec.endDate) {
    return `${base};UNTIL=${stamp(rec.endDate)}T235959Z`;
  }
  return base;
}

/** Importe que toca en cada vencimiento (la cuota, si es préstamo). */
function importe(rec) {
  if (rec.type === 'prestamo') {
    return loanPayment(rec.principal, rec.annualRate, rec.months) + (rec.insuranceMonthly || 0);
  }
  return rec.amount;
}

/**
 * Genera el .ics.
 *
 * @param {object} state
 * @param {{daysBefore?:number, includeIncome?:boolean, hour?:number}} opts
 *        daysBefore: días de antelación del recordatorio (0 = el mismo día).
 *        hour: hora del recordatorio en eventos de día completo.
 */
export function buildICS(state, { daysBefore = 2, includeIncome = false, hour = 9 } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gestor de Cuentas//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Cobros y pagos',
    'X-WR-TIMEZONE:Europe/Madrid',
  ];

  // DTSTAMP debe ser un instante UTC real; es el único sitio donde usamos "ahora".
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const recs = state.recurrings.filter((r) =>
    !r.archived && (includeIncome || r.kind !== 'ingreso'));

  for (const rec of recs) {
    const rule = rrule(rec);
    const amount = importe(rec);
    const cat = state.categories.find((c) => c.id === rec.categoryId);
    const signo = rec.kind === 'ingreso' ? '+' : '−';
    const titulo = `${signo}${money(amount)} · ${rec.name}`;

    // Saltos de línea REALES: es esc() quien los convierte al "\n" de iCalendar.
    // Si se escribieran aquí ya escapados, esc() escaparía la barra invertida y
    // el calendario mostraría un "\n" literal en mitad del texto.
    const desc = [
      rec.kind === 'ingreso' ? 'Ingreso previsto.' : 'Cargo previsto.',
      cat ? `Categoría: ${cat.name}.` : null,
      rec.type === 'prestamo'
        ? `Cuota ${rec.months} meses al ${rec.annualRate} % TIN.`
        : `Frecuencia: ${FREQUENCIES[rec.frequency]?.label ?? '—'}.`,
      rec.annualIncrease ? `Sube un ${rec.annualIncrease} % cada año: el importe irá cambiando.` : null,
      '',
      'Generado por Gestor de Cuentas. Marca el cobro en la app.',
    ].filter(Boolean).join('\n');

    const end = recurringEndDate(rec);

    lines.push(
      'BEGIN:VEVENT',
      `UID:${rec.id}@gestor-cuentas`,
      `DTSTAMP:${now}`,
      // Evento de día completo: no sabemos a qué hora exacta pasa el cargo.
      `DTSTART;VALUE=DATE:${stamp(rec.startDate)}`,
      `DTEND;VALUE=DATE:${stamp(addOneDay(rec.startDate))}`,
      rule ? `RRULE:${rule}` : null,
      `SUMMARY:${esc(titulo)}`,
      `DESCRIPTION:${esc(desc)}`,
      cat ? `CATEGORIES:${esc(cat.name)}` : null,
      'TRANSP:TRANSPARENT',
      end ? `X-ULTIMO-PAGO:${end}` : null,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(titulo)}`,
      `TRIGGER:${trigger(daysBefore, hour)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');

  return lines.filter((l) => l != null).map(fold).join('\r\n') + '\r\n';
}

function addOneDay(iso) {
  const { y, m, d } = parseISO(iso);
  const dt = new Date(y, m - 1, d + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** Cuenta cuántos eventos saldrían, para avisar antes de descargar. */
export function countICSEvents(state, { includeIncome = false } = {}) {
  return state.recurrings.filter((r) => !r.archived && (includeIncome || r.kind !== 'ingreso')).length;
}
