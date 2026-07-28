/**
 * Motor de la cartera de inversión.
 *
 * Dos cosas que registra el usuario:
 *   - contributions: dinero que aporta de su bolsillo (o retira, en negativo).
 *   - valuations:    el valor TOTAL de la cartera, anotado cada par de días.
 *
 * De ahí sale todo lo demás. La clave para que "sube o baja" tenga sentido es
 * separar el mercado de las aportaciones: si metes 200 €, el valor total sube
 * 200, pero no has ganado nada. Por eso la ganancia se calcula como
 * valor − aportado, que es neutral a los ingresos.
 */

import { cmpISO, monthKey, parseISO, toISO, fmtDate, fmtMonth } from './format.js';

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Aportado neto hasta una fecha (inclusive). */
export function contributedBy(inv, dateISO) {
  let s = 0;
  for (const c of inv.contributions) if (cmpISO(c.date, dateISO) <= 0) s += c.amount;
  return round2(s);
}

/**
 * Valor total de la cartera que representa una valoración.
 *
 * Si el usuario anotó el valor total, es ese número. Si anotó solo la ganancia,
 * el total es lo aportado hasta esa fecha más la ganancia. Así da igual qué
 * número lea en MyInvestor.
 */
export function valuationValue(inv, v) {
  if (v.mode === 'ganancia') return round2(contributedBy(inv, v.date) + Number(v.amount || 0));
  // 'total' (y cualquier valoración antigua ya migrada a total)
  return round2(Number(v.amount != null ? v.amount : v.value) || 0);
}

/**
 * Foto actual de la cartera.
 *
 * `valorActual` toma la última valoración y le suma las aportaciones que hayas
 * hecho DESPUÉS de esa valoración (dinero que ya está en la cuenta pero que aún
 * no se ha reflejado en un valor anotado). Así un ingreso reciente no aparece
 * como una ganancia falsa.
 */
export function investmentSummary(state) {
  const inv = state.investment;
  const contributions = [...inv.contributions].sort((a, b) => cmpISO(a.date, b.date));
  const valuations = [...inv.valuations].sort((a, b) => cmpISO(a.date, b.date));

  const aportado = round2(contributions.reduce((s, c) => s + c.amount, 0));
  const last = valuations.at(-1) || null;

  let valorActual;
  if (last) {
    const aportadoTrasUltima = round2(
      contributions.filter((c) => cmpISO(c.date, last.date) > 0).reduce((s, c) => s + c.amount, 0),
    );
    valorActual = round2(valuationValue(inv, last) + aportadoTrasUltima);
  } else {
    // Sin ninguna valoración, lo que vale es lo aportado (aún no hay mercado).
    valorActual = aportado;
  }

  const ganancia = round2(valorActual - aportado);
  const rentabilidad = aportado > 0 ? round2((ganancia / aportado) * 100) : 0;

  // Variación desde la valoración anterior (para el "última vez: +X").
  let variacion = null;
  if (valuations.length >= 2) {
    const prev = valuations[valuations.length - 2];
    // Descontamos las aportaciones entre ambas valoraciones para que la
    // variación sea solo mercado, no dinero metido.
    const aportadoEntre = round2(
      contributions
        .filter((c) => cmpISO(c.date, prev.date) > 0 && cmpISO(c.date, last.date) <= 0)
        .reduce((s, c) => s + c.amount, 0),
    );
    variacion = round2(valuationValue(inv, last) - valuationValue(inv, prev) - aportadoEntre);
  }

  return {
    nombre: inv.name,
    aportado,
    valorActual,
    ganancia,
    rentabilidad,
    variacion,
    ultima: last,
    primeraFecha: contributions[0]?.date ?? valuations[0]?.date ?? null,
    nAportaciones: contributions.length,
    nValoraciones: valuations.length,
    contributions,
    valuations,
  };
}

/**
 * Serie de puntos para la gráfica.
 *
 * Cada punto lleva `valor` (total anotado) y `ganancia` (valor − aportado a esa
 * fecha, neutral a las aportaciones). La vista elige cuál pintar.
 *
 * @param {'semana'|'mes'} modo
 *        'semana' → un punto por semana (la última valoración de cada semana).
 *        'mes'    → un punto por mes (la última valoración de cada mes).
 */
export function investmentSeries(state, modo = 'semana') {
  const inv = state.investment;
  const valuations = [...inv.valuations].sort((a, b) => cmpISO(a.date, b.date));
  if (!valuations.length) return [];

  const keyOf = (iso) => (modo === 'mes' ? monthKey(iso) : weekKey(iso));

  // Última valoración de cada periodo (semana o mes).
  const porPeriodo = new Map();
  for (const v of valuations) porPeriodo.set(keyOf(v.date), v);

  const puntos = [...porPeriodo.values()]
    .sort((a, b) => cmpISO(a.date, b.date))
    .map((v) => {
      const aportado = contributedBy(inv, v.date);
      const valor = valuationValue(inv, v);
      return {
        date: v.date,
        valor,
        aportado,
        ganancia: round2(valor - aportado),
        label: modo === 'mes' ? fmtMonth(monthKey(v.date)).split(' ')[0] : etiquetaDia(v.date),
      };
    });

  // Limitamos para que la gráfica no se sature: últimas ~16 semanas / 12 meses.
  const max = modo === 'mes' ? 12 : 16;
  return puntos.slice(-max);
}

/** Lunes de la semana de una fecha, como clave "YYYY-MM-DD". */
function weekKey(iso) {
  const { y, m, d } = parseISO(iso);
  const dt = new Date(y, m - 1, d);
  const dow = (dt.getDay() + 6) % 7; // 0 = lunes
  dt.setDate(dt.getDate() - dow);
  return toISO(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

/** "17/7" — etiqueta corta de día/mes para el eje. */
function etiquetaDia(iso) {
  const { m, d } = parseISO(iso);
  return `${d}/${m}`;
}

export { round2 as roundInvest };
