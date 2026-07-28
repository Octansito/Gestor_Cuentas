/**
 * Gráficos en SVG dibujados a mano. Sin librerías.
 *
 * Todos usan un viewBox de ancho fijo y `width:100%`, así que escalan solos
 * en cualquier pantalla sin necesidad de recalcular en el resize.
 */

import { svg } from './ui.js';
import { moneyShort, money } from './format.js';

const W = 700;

/** Escala lineal valor -> píxel. */
function scale(domainMin, domainMax, rangeMin, rangeMax) {
  const span = domainMax - domainMin || 1;
  return (v) => rangeMin + ((v - domainMin) / span) * (rangeMax - rangeMin);
}

/** Extiende el dominio a un número "redondo" para que los ejes se lean bien. */
function niceMax(v) {
  if (v <= 0) return 0;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/* ============================================================ barras ==== */

/**
 * Barras agrupadas de ingresos y gastos por periodo.
 * @param {Array<{label:string, income:number, expense:number}>} data
 */
export function barChart(data, { height = 200 } = {}) {
  const padL = 44, padR = 8, padT = 10, padB = 22;
  const H = height;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  if (!data.length) return emptyChart(H, 'Sin datos que mostrar');

  const max = niceMax(Math.max(1, ...data.map((d) => Math.max(d.income, d.expense))));
  const y = scale(0, max, H - padB, padT);
  const bandW = innerW / data.length;
  const barW = Math.min(16, (bandW - 8) / 2);

  const node = svg('svg', {
    class: 'chart',
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': `Gráfico de ingresos y gastos de ${data.length} periodos`,
  });

  // Rejilla + etiquetas del eje Y
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    const yy = y(v);
    node.append(svg('line', { class: 'grid-line', x1: padL, x2: W - padR, y1: yy, y2: yy, opacity: i === 0 ? 1 : 0.4 }));
    node.append(svg('text', { x: padL - 7, y: yy + 3.5, 'text-anchor': 'end' }, moneyShort(v)));
  }

  data.forEach((d, i) => {
    const cx = padL + bandW * i + bandW / 2;
    const gap = 2;

    for (const [key, color, offset] of [
      ['income', 'var(--income)', -barW / 2 - gap / 2],
      ['expense', 'var(--expense)', barW / 2 + gap / 2],
    ]) {
      const v = d[key] || 0;
      const hgt = Math.max(v > 0 ? 2 : 0, (H - padB) - y(v));
      if (hgt <= 0) continue;
      node.append(svg('rect', {
        x: cx + offset - barW / 2,
        y: (H - padB) - hgt,
        width: barW,
        height: hgt,
        rx: Math.min(3, barW / 2),
        fill: color,
      }, svg('title', {}, `${d.label} · ${key === 'income' ? 'Ingresos' : 'Gastos'}: ${money(v)}`)));
    }

    node.append(svg('text', { x: cx, y: H - padB + 14, 'text-anchor': 'middle' }, d.label));
  });

  return node;
}

/* ============================================================= línea ==== */

/**
 * Línea de evolución del saldo, con relleno degradado y línea de cero
 * cuando el saldo entra en negativo.
 * @param {Array<{label:string, value:number}>} points
 */
export function lineChart(points, { height = 220, showEveryNth, dots = false, emptyText } = {}) {
  const padL = 46, padR = 10, padT = 12, padB = 22;
  const H = height;

  if (points.length < 2) return emptyChart(H, emptyText ?? 'Se necesitan al menos dos meses');

  const values = points.map((p) => p.value);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const pad = (rawMax - rawMin) * 0.08 || 1;
  const min = rawMin - (rawMin < 0 ? pad : 0);
  const max = rawMax + pad;

  const x = scale(0, points.length - 1, padL, W - padR);
  const y = scale(min, max, H - padB, padT);

  const uid = 'g' + Math.random().toString(36).slice(2, 8);
  const node = svg('svg', {
    class: 'chart',
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': `Evolución del saldo durante ${points.length} meses. `
      + `Empieza en ${money(values[0])} y termina en ${money(values[values.length - 1])}.`,
  });

  const positive = values[values.length - 1] >= 0;
  const stroke = positive ? 'var(--accent)' : 'var(--expense)';

  node.append(svg('defs', {},
    svg('linearGradient', { id: uid, x1: 0, y1: 0, x2: 0, y2: 1 },
      svg('stop', { offset: '0%', 'stop-color': stroke, 'stop-opacity': 0.28 }),
      svg('stop', { offset: '100%', 'stop-color': stroke, 'stop-opacity': 0 }),
    ),
  ));

  // Rejilla horizontal
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) / 4) * i;
    const yy = y(v);
    node.append(svg('line', { class: 'grid-line', x1: padL, x2: W - padR, y1: yy, y2: yy, opacity: 0.4 }));
    node.append(svg('text', { x: padL - 7, y: yy + 3.5, 'text-anchor': 'end' }, moneyShort(v)));
  }

  // Línea del cero, solo si el saldo llega a cruzarla
  if (min < 0) {
    node.append(svg('line', { class: 'zero-line', x1: padL, x2: W - padR, y1: y(0), y2: y(0) }));
  }

  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const baseY = y(Math.max(min, 0));

  node.append(svg('path', {
    d: `${d} L${x(points.length - 1).toFixed(1)},${baseY} L${x(0).toFixed(1)},${baseY} Z`,
    fill: `url(#${uid})`,
  }));
  node.append(svg('path', {
    d, fill: 'none', stroke, 'stroke-width': 2.2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }));

  // Un punto en cada valor (gráfica de puntos), o solo el final.
  const last = points.length - 1;
  if (dots) {
    points.forEach((p, i) => {
      node.append(svg('circle', {
        cx: x(i), cy: y(p.value), r: i === last ? 3.8 : 2.6,
        fill: i === last ? stroke : 'var(--bg-elev)', stroke, 'stroke-width': 1.5,
      }));
    });
  } else {
    node.append(svg('circle', { cx: x(last), cy: y(points[last].value), r: 3.5, fill: stroke }));
  }

  // Etiquetas del eje X: solo algunas, para que no se solapen
  const nth = showEveryNth ?? Math.max(1, Math.ceil(points.length / 6));
  points.forEach((p, i) => {
    if (i % nth !== 0 && i !== last) return;
    node.append(svg('text', { x: x(i), y: H - padB + 14, 'text-anchor': 'middle' }, p.label));
  });

  // Zonas invisibles para el tooltip nativo del navegador
  const bw = (W - padL - padR) / points.length;
  points.forEach((p, i) => {
    node.append(svg('rect', {
      x: x(i) - bw / 2, y: padT, width: bw, height: H - padT - padB, fill: 'transparent',
    }, svg('title', {}, `${p.label}: ${money(p.value)}`)));
  });

  return node;
}

/* =========================================== barras por categoría ======= */

/**
 * Ranking horizontal por categoría.
 * @param {Array<{label:string, value:number, icon?:string}>} items
 */
export function categoryBars(items, { color = 'var(--expense)' } = {}) {
  if (!items.length) return null;
  const max = Math.max(...items.map((i) => i.value)) || 1;

  return items.map((it) => {
    const pct = (it.value / max) * 100;
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:10px;padding:7px 0';
    bar.innerHTML = `
      <span style="width:22px;text-align:center;flex:none">${it.icon || '•'}</span>
      <span style="flex:1;min-width:0">
        <span style="display:flex;justify-content:space-between;gap:10px;font-size:13px;margin-bottom:4px">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
          <span class="num" style="font-weight:620;flex:none"></span>
        </span>
        <span style="display:block;height:6px;border-radius:3px;background:var(--bg-elev-2);overflow:hidden">
          <span style="display:block;height:100%;width:${pct.toFixed(1)}%;background:${color};border-radius:3px"></span>
        </span>
      </span>`;
    // textContent en lugar de innerHTML: los nombres de categoría los escribe
    // el usuario y podrían contener "<" o "&".
    bar.querySelectorAll('span > span > span')[0].textContent = it.label;
    bar.querySelector('.num').textContent = money(it.value);
    return bar;
  });
}

/* ---------------------------------------------------------------------- */

function emptyChart(H, message) {
  const node = svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': message });
  node.append(svg('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle' }, message));
  return node;
}
