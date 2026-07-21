/**
 * Motor de consejos para reducir el gasto.
 *
 * Reglas deterministas sobre TUS cifras. Cada consejo lleva el número concreto
 * que lo dispara y un ahorro estimado; nada de "controla tus gastos hormiga".
 * Si una regla no tiene datos suficientes, no dice nada: es preferible callar a
 * soltar un consejo genérico.
 *
 * Cada consejo:
 *   { id, nivel: 'alto'|'medio'|'info', titulo, texto, ahorroAnual|null, categoriaId? }
 */

import {
  byCategory, monthBudget, monthlyEquivalent, flowsBetween, project, loanSchedule,
} from './finance.js';
import { money, percent, monthKey, addMonths, fmtMonthLong, todayISO, daysInMonth, parseISO, toISO } from './format.js';

/** Categorías que casi siempre son elegibles: donde un recorte es realista. */
const DISCRECIONALES = new Set([
  'cat-ocio', 'cat-restaurante', 'cat-compras', 'cat-suscrip',
]);

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function generateAdvice(state) {
  const tips = [];
  const today = todayISO();
  const key = monthKey(today);
  const prevKey = monthKey(addMonths(today, -1));

  const cats = (k) => state.categories.find((c) => c.id === k);
  const nombreCat = (id) => (id === '__none__' ? 'Sin categoría' : cats(id)?.name ?? 'Sin categoría');

  const rango = (mk) => {
    const [y, m] = mk.split('-').map(Number);
    return [toISO(y, m, 1), toISO(y, m, daysInMonth(y, m))];
  };

  const mes = monthBudget(state, key);
  const gastoMes = byCategory(state, 'gasto', ...rango(key));
  const gastoPrev = byCategory(state, 'gasto', ...rango(prevKey));

  /* ------------------------------------------------- 1. no llegas a fin de mes */
  if (mes.income > 0 && mes.expense > mes.income) {
    tips.push({
      id: 'deficit',
      nivel: 'alto',
      titulo: 'Este mes gastas más de lo que ingresas',
      texto: `Llevas ${money(mes.expense)} de gastos frente a ${money(mes.income)} de ingresos: `
           + `${money(mes.expense - mes.income)} de más. Si se repite, cada mes tiras de ahorros o de deuda.`,
      ahorroAnual: null,
    });
  }

  /* ------------------------------------------- 2. la categoría que te desangra */
  if (gastoMes.total > 0 && gastoMes.items.length) {
    const top = gastoMes.items[0];
    const cuota = top.value / gastoMes.total;
    if (cuota >= 0.25) {
      const recorte = round2(top.value * 0.15);
      tips.push({
        id: 'categoria-dominante',
        nivel: cuota >= 0.4 ? 'alto' : 'medio',
        categoriaId: top.categoryId,
        titulo: `${nombreCat(top.categoryId)} se lleva ${percent(cuota * 100, 0)} de tu gasto`,
        texto: `${money(top.value)} de los ${money(gastoMes.total)} que has gastado en ${fmtMonthLong(key)}. `
             + `Es tu mayor partida con diferencia: recortarla un 15 % son ${money(recorte)} al mes.`,
        ahorroAnual: round2(recorte * 12),
      });
    }
  }

  /* --------------------------------------- 3. qué categoría se ha disparado */
  if (gastoPrev.total > 0) {
    const prevMap = new Map(gastoPrev.items.map((i) => [i.categoryId, i.value]));
    const subidas = gastoMes.items
      .map((i) => ({ ...i, antes: prevMap.get(i.categoryId) ?? 0 }))
      .filter((i) => i.antes >= 20 && i.value > i.antes * 1.3 && i.value - i.antes >= 30)
      .sort((a, b) => (b.value - b.antes) - (a.value - a.antes));

    if (subidas.length) {
      const s = subidas[0];
      const delta = round2(s.value - s.antes);
      tips.push({
        id: 'subida-categoria',
        nivel: 'medio',
        categoriaId: s.categoryId,
        titulo: `${nombreCat(s.categoryId)} se ha disparado un ${percent(((s.value / s.antes) - 1) * 100, 0)}`,
        texto: `Has pasado de ${money(s.antes)} en ${fmtMonthLong(prevKey)} a ${money(s.value)} este mes: `
             + `${money(delta)} más. Si ha sido algo puntual, ignóralo; si no, es el sitio por donde empezar.`,
        ahorroAnual: round2(delta * 12),
      });
    }
  }

  /* --------------------------------------------------- 4. suscripciones */
  const subs = state.recurrings.filter((r) =>
    !r.archived && r.kind !== 'ingreso' && r.type !== 'prestamo'
    && (r.categoryId === 'cat-suscrip' || /netflix|spotify|hbo|disney|prime|youtube|apple|dazn|movistar/i.test(r.name)));

  if (subs.length >= 2) {
    const mesSubs = round2(subs.reduce((s, r) => s + monthlyEquivalent(r), 0));
    tips.push({
      id: 'suscripciones',
      nivel: mesSubs >= 50 ? 'medio' : 'info',
      titulo: `${subs.length} suscripciones: ${money(mesSubs)} al mes`,
      texto: `Son ${money(mesSubs * 12)} al año en ${subs.map((r) => r.name).join(', ')}. `
           + 'Las suscripciones no duelen porque no las ves pasar. Mira cuáles has usado de verdad este mes.',
      ahorroAnual: round2(mesSubs * 12),
    });
  }

  /* ---------------------------------------------- 5. goteo de recurrentes */
  const pequenos = state.recurrings.filter((r) =>
    !r.archived && r.kind !== 'ingreso' && r.type !== 'prestamo' && monthlyEquivalent(r) < 20);
  if (pequenos.length >= 4) {
    const goteo = round2(pequenos.reduce((s, r) => s + monthlyEquivalent(r), 0));
    tips.push({
      id: 'goteo',
      nivel: 'info',
      titulo: `${pequenos.length} recurrentes pequeños suman ${money(goteo)} al mes`,
      texto: `Ninguno llega a ${money(20)} al mes, así que ninguno parece importante. Juntos son `
           + `${money(goteo * 12)} al año.`,
      ahorroAnual: round2(goteo * 12),
    });
  }

  /* ------------------------------------------------------ 6. intereses */
  const prestamos = state.recurrings.filter((r) => !r.archived && r.type === 'prestamo');
  if (prestamos.length) {
    let interesTotal = 0;
    let peor = null;
    for (const p of prestamos) {
      const s = loanSchedule({
        principal: p.principal, annualRate: p.annualRate, months: p.months,
        insuranceMonthly: p.insuranceMonthly, openingFee: p.openingFee, startDate: p.startDate,
      });
      interesTotal += s.totalInterest;
      if (!peor || s.apr > peor.apr) peor = { nombre: p.name, apr: s.apr, coste: s.totalCost, sched: s };
    }
    if (interesTotal >= 100) {
      tips.push({
        id: 'intereses',
        nivel: interesTotal >= 2000 ? 'alto' : 'medio',
        titulo: `${money(round2(interesTotal))} en intereses a lo largo de tus préstamos`,
        texto: prestamos.length === 1
          ? `Es lo que te cuesta el dinero de "${peor.nombre}" (TAE ${percent(peor.apr)}). `
            + 'Amortizar anticipadamente reduce esa cifra; pregunta a tu banco por la comisión.'
          : `Repartidos en ${prestamos.length} préstamos. El más caro es "${peor.nombre}", `
            + `con una TAE del ${percent(peor.apr)}. Si vas a amortizar algo, empieza por ese.`,
        ahorroAnual: null,
      });
    }
  }

  /* ------------------------------------------------- 7. peso de los fijos */
  const fijos = round2(state.recurrings
    .filter((r) => !r.archived && r.kind !== 'ingreso')
    .reduce((s, r) => s + monthlyEquivalent(r), 0));
  const ingFijos = round2(state.recurrings
    .filter((r) => !r.archived && r.kind === 'ingreso')
    .reduce((s, r) => s + monthlyEquivalent(r), 0));

  if (ingFijos > 0) {
    const ratio = fijos / ingFijos;
    if (ratio >= 0.6) {
      tips.push({
        id: 'fijos',
        nivel: ratio >= 0.8 ? 'alto' : 'medio',
        titulo: `Tus gastos fijos se comen el ${percent(ratio * 100, 0)} de lo que ingresas`,
        texto: `${money(fijos)} de gastos comprometidos frente a ${money(ingFijos)} de ingresos fijos. `
             + `Te quedan ${money(ingFijos - fijos)} al mes de margen para todo lo demás. `
             + 'Con los fijos tan altos, recortar en el día a día apenas mueve la aguja: lo que cambia las cosas '
             + 'es tocar el alquiler, los préstamos o los seguros.',
        ahorroAnual: null,
      });
    }
  }

  /* ------------------------------------------- 8. gasto discrecional */
  if (gastoMes.total > 0) {
    const disc = gastoMes.items
      .filter((i) => DISCRECIONALES.has(i.categoryId))
      .reduce((s, i) => s + i.value, 0);
    const cuota = disc / gastoMes.total;
    if (disc >= 100 && cuota >= 0.2) {
      const recorte = round2(disc * 0.25);
      tips.push({
        id: 'discrecional',
        nivel: 'info',
        titulo: `${money(round2(disc))} en gasto prescindible este mes`,
        texto: `Ocio, restaurantes, compras y suscripciones: el ${percent(cuota * 100, 0)} de tu gasto. `
             + 'No es "malo", pero es la parte sobre la que de verdad decides. '
             + `Un cuarto menos son ${money(recorte)} al mes.`,
        ahorroAnual: round2(recorte * 12),
      });
    }
  }

  /* ------------------------------------------------ 9. tasa de ahorro */
  if (mes.income > 0 && mes.expense <= mes.income) {
    const tasa = (mes.income - mes.expense) / mes.income;
    if (tasa < 0.1) {
      tips.push({
        id: 'ahorro-bajo',
        nivel: 'medio',
        titulo: `Solo ahorras el ${percent(tasa * 100, 0)} de lo que ingresas`,
        texto: `Te quedan ${money(mes.income - mes.expense)} al mes. Cualquier imprevisto `
             + '(una avería, un mes malo) te mete en números rojos. Lo habitual es apuntar al 20 %; '
             + `en tu caso serían ${money(mes.income * 0.2)}.`,
        ahorroAnual: null,
      });
    } else if (tasa >= 0.2) {
      tips.push({
        id: 'ahorro-bueno',
        nivel: 'info',
        titulo: `Vas ahorrando el ${percent(tasa * 100, 0)} de tus ingresos`,
        texto: `${money(mes.income - mes.expense)} este mes. Está por encima del 20 % que suele `
             + 'recomendarse. Si ese dinero se queda parado en la cuenta, la inflación se lo va comiendo.',
        ahorroAnual: null,
      });
    }
  }

  /* ------------------------------------------ 10. te vas a quedar en rojo */
  const p = project(state, 24);
  if (p.lowest && p.lowest.balance < 0) {
    tips.push({
      id: 'saldo-negativo',
      nivel: 'alto',
      titulo: `En ${fmtMonthLong(p.lowest.key)} te quedarías en ${money(p.lowest.balance)}`,
      texto: 'Con tus recurrentes actuales, la proyección se va a negativo. '
           + 'No es una predicción exacta, pero la dirección es la que es.',
      ahorroAnual: null,
    });
  }

  /* --------------------------------------- 11. revalorizaciones dormidas */
  const suben = state.recurrings.filter((r) => !r.archived && r.kind !== 'ingreso' && r.annualIncrease >= 3);
  if (suben.length) {
    const extra = round2(suben.reduce((s, r) =>
      s + monthlyEquivalent(r) * (r.annualIncrease / 100), 0) * 12);
    if (extra >= 50) {
      tips.push({
        id: 'revalorizacion',
        nivel: 'info',
        titulo: `Tus gastos fijos subirán ${money(extra)} el año que viene solos`,
        texto: `${suben.map((r) => `${r.name} (+${r.annualIncrease} %)`).join(', ')}. `
             + 'No tienes que hacer nada para gastar más: ya está programado.',
        ahorroAnual: null,
      });
    }
  }

  const orden = { alto: 0, medio: 1, info: 2 };
  return tips.sort((a, b) => orden[a.nivel] - orden[b.nivel]
    || (b.ahorroAnual ?? 0) - (a.ahorroAnual ?? 0));
}

/*
 * Deliberadamente NO hay un "ahorro total potencial" sumando los `ahorroAnual`.
 * Las reglas se solapan (una suscripción cuenta en 'suscripciones', en
 * 'discrecional' y quizá en 'categoria-dominante'), así que la suma daría una
 * cifra inflada que parecería precisa y no lo sería. Cada consejo lleva su
 * propia estimación y ahí se queda.
 */
