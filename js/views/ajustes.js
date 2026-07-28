/** Vista "Ajustes": saldo de partida, moneda, categorías y copias de seguridad. */

import {
  h, modal, toast, confirmDialog, readNumber, markInvalid, setChildren, svgIcon, ICONS,
} from '../ui.js';
import { money, todayISO, fmtDate } from '../format.js';
import {
  getState, updateSettings, exportJSON, importJSON, resetAll, loadDemoData,
  categoriesFor, addCategory, deleteCategory,
} from '../state.js';
import {
  notificationPermission, requestNotificationPermission, testNotification,
} from '../notify.js';
import { buildICS, countICSEvents } from '../calendar.js';

const CURRENCIES = [
  ['EUR', 'Euro (€)'],
  ['USD', 'Dólar ($)'],
  ['GBP', 'Libra (£)'],
  ['MXN', 'Peso mexicano'],
  ['ARS', 'Peso argentino'],
  ['COP', 'Peso colombiano'],
  ['CLP', 'Peso chileno'],
  ['BRL', 'Real brasileño'],
];

export function render(rerender) {
  const s = getState();
  const root = h('div.stack');

  /* ---------------------------------------------------- punto de partida -- */
  root.append(h('h2.section-title', 'Punto de partida'));

  const balanceInput = h('input.input', {
    type: 'text', inputmode: 'decimal',
    value: String(s.settings.initialBalance ?? 0).replace('.', ','),
  });
  const trackInput = h('input.input', {
    type: 'date', value: s.settings.trackingStart || todayISO(),
  });

  root.append(h('div.card',
    h('label.field',
      h('span.field__label', 'Saldo que tenías'),
      balanceInput,
      h('span.field__hint', 'El dinero que había en tus cuentas en la fecha de abajo. Todo lo demás se calcula a partir de aquí.'),
    ),
    h('label.field',
      h('span.field__label', 'Fecha de ese saldo'),
      trackInput,
      h('span.field__hint', 'Los recurrentes anteriores a esta fecha no cuentan para el saldo actual: se supone que ya estaban incluidos.'),
    ),
    h('button.btn.btn--primary.btn--block', {
      onclick: () => {
        const v = readNumber(balanceInput);
        if (!Number.isFinite(v)) return markInvalid(balanceInput, 'Introduce un número.');
        if (!trackInput.value) return markInvalid(trackInput, 'Elige una fecha.');
        updateSettings({ initialBalance: v, trackingStart: trackInput.value });
        toast('Guardado');
        rerender();
      },
    }, 'Guardar'),
  ));

  /* ----------------------------------------------------------- moneda ---- */
  root.append(h('h2.section-title', 'Moneda'));
  root.append(h('div.card',
    h('label.field', { style: { marginBottom: 0 } },
      h('span.field__label', 'Divisa'),
      h('select.select', {
        onchange: (e) => { updateSettings({ currency: e.target.value }); rerender(); toast('Moneda actualizada'); },
      }, ...CURRENCIES.map(([code, label]) =>
        h('option', { value: code, selected: s.settings.currency === code }, label))),
    ),
  ));

  /* ---------------------------------------------------- notificaciones --- */
  root.append(h('h2.section-title', 'Avisos de cobro'));
  root.append(notificacionesCard(s, rerender));

  /* ------------------------------------------------------- categorías ---- */
  root.append(h('h2.section-title', 'Categorías'));
  root.append(h('div.card',
    h('div.small.muted', { style: { marginBottom: '10px' } },
      `${s.categories.length} categorías (${categoriesFor('gasto').length} de gasto, `
      + `${categoriesFor('ingreso').length} de ingreso).`),
    h('button.btn.btn--block', { onclick: () => categoriesModal(rerender) }, 'Gestionar categorías'),
  ));

  /* --------------------------------------------------------- tus datos --- */
  root.append(h('h2.section-title', 'Tus datos'));
  root.append(h('div.card',
    h('div.kv', h('span.kv__k', 'Movimientos'), h('span.kv__v', String(s.transactions.length))),
    h('div.kv', h('span.kv__k', 'Recurrentes'), h('span.kv__v', String(s.recurrings.length))),
    h('div.kv', h('span.kv__k', 'Seguimiento desde'), h('span.kv__v', fmtDate(s.settings.trackingStart || todayISO()))),
    h('div.kv', h('span.kv__k', 'Tamaño en el navegador'), h('span.kv__v', storageSize())),
  ));

  root.append(h('div.card',
    h('button.btn.btn--block', { onclick: doExport },
      svgIcon(ICONS.download), 'Exportar copia de seguridad'),
    h('div', { style: { height: '8px' } }),
    h('button.btn.btn--block', { onclick: () => doImport(rerender) },
      svgIcon(ICONS.upload), 'Importar copia'),
    h('div.field__hint', { style: { marginTop: '10px' } },
      'La copia es un archivo JSON con todo tu historial. Guárdalo donde quieras: '
      + 'es la única forma de pasar los datos a otro móvil o de recuperarlos si borras el navegador.'),
  ));

  /* ------------------------------------------------------------ zona roja - */
  root.append(h('h2.section-title', 'Zona peligrosa'));
  root.append(h('div.card',
    h('button.btn.btn--block', {
      onclick: async () => {
        const ok = await confirmDialog({
          title: '¿Cargar datos de ejemplo?',
          message: 'Se reemplazará todo lo que tengas ahora por un caso de ejemplo '
                 + '(nómina, alquiler, un préstamo de coche...). Exporta antes una copia si te interesa lo que hay.',
          confirmText: 'Cargar ejemplo', danger: true,
        });
        if (ok) { loadDemoData(); toast('Datos de ejemplo cargados'); rerender(); }
      },
    }, 'Cargar datos de ejemplo'),
    h('div', { style: { height: '8px' } }),
    h('button.btn.btn--danger.btn--block', {
      onclick: async () => {
        const ok = await confirmDialog({
          title: '¿Borrar todo?',
          message: 'Se eliminan todos los movimientos, recurrentes y ajustes de este dispositivo. '
                 + 'Esto no se puede deshacer y no hay copia en ningún servidor.',
          confirmText: 'Borrar todo', danger: true,
        });
        if (ok) { resetAll(); toast('Todo borrado'); rerender(); }
      },
    }, svgIcon(ICONS.trash), 'Borrar todos mis datos'),
  ));

  /* ---------------------------------------------------------- acerca de -- */
  root.append(h('h2.section-title', 'Acerca de'));
  root.append(h('div.card',
    h('div.small.muted', { style: { lineHeight: '1.6' } },
      h('p', { style: { marginTop: 0 } },
        h('strong', 'Gestor de Cuentas'), ' · versión 1.3'),
      h('p',
        'Todos los datos se guardan ',
        h('strong', 'solo en este dispositivo'),
        ', en el almacenamiento local del navegador. No hay cuentas, no hay analítica '
        + 'y funciona sin conexión.'),
      h('p',
        'Una sola excepción, y solo si la usas tú: al ',
        h('strong', 'exportar al calendario'),
        ', el nombre, importe y fecha de tus gastos recurrentes van al archivo que '
        + 'descargas, y de ahí a donde tú lo importes. Tu saldo, tu histórico y tus '
        + 'movimientos sueltos no salen nunca de aquí.'),
      h('p',
        h('strong', 'Ojo: '),
        'si borras los datos de navegación del navegador, se borra también la app. '
        + 'Exporta una copia de vez en cuando.'),
      h('p', { style: { marginBottom: 0 } },
        'Los cálculos de préstamos usan el sistema francés de cuota constante. '
        + 'La TAE es una estimación e incluye comisión de apertura y seguro; '
        + 'puede diferir de la de tu banco según qué gastos incluya. '
        + 'Esto es una herramienta de orientación, no asesoramiento financiero.'),
    ),
  ));

  return root;
}

/* ------------------------------------------------------ notificaciones -- */

/**
 * Las tres vías de aviso, de más a menos fiable. El orden es intencionado:
 * el calendario es el único que avisa con la app cerrada sin depender de nada
 * que tengas que mantener tú.
 */
function notificacionesCard(s, rerender) {
  const box = h('div.stack');

  /* --- días de antelación (común a todo) -------------------------------- */
  box.append(h('div.card',
    h('label.field', { style: { marginBottom: 0 } },
      h('span.field__label', 'Avisarme con esta antelación'),
      h('select.select', {
        onchange: (e) => { updateSettings({ notifyDaysBefore: Number(e.target.value) }); rerender(); },
      }, ...[0, 1, 2, 3, 5, 7].map((d) =>
        h('option', { value: d, selected: (s.settings.notifyDaysBefore ?? 3) === d },
          d === 0 ? 'El mismo día' : `${d} ${d === 1 ? 'día' : 'días'} antes`))),
      h('span.field__hint', 'Se aplica tanto a los avisos de la app como al calendario.'),
    ),
  ));

  /* --- 1. calendario ---------------------------------------------------- */
  box.append(h('div.card',
    h('div.alert__title', { style: { color: 'var(--income)' } },
      svgIcon(ICONS.calendar), 'Calendario  ·  lo más fiable'),
    h('div.field__hint', { style: { margin: '6px 0 12px' } },
      'Descarga tus cobros e impórtalos en Google Calendar. Te avisa a la hora exacta '
      + 'aunque la app esté cerrada, gratis y sin depender de nada. Los eventos se repiten '
      + 'solos, así que se hace una vez y ya está.'),
    h('button.btn.btn--primary.btn--block', {
      onclick: () => descargarICS(s),
    }, svgIcon(ICONS.download), 'Descargar calendario (.ics)'),
    h('div.field__hint', { style: { marginTop: '10px' } },
      'Luego: Google Calendar en el navegador → Configuración → Importar y exportar → '
      + 'selecciona el archivo. Desde la app del móvil no se puede importar.'),
  ));

  /* --- 2. avisos al abrir ----------------------------------------------- */
  const permiso = notificationPermission();
  const estados = {
    granted: ['Concedido', 'var(--income)'],
    denied: ['Bloqueado en el navegador', 'var(--expense)'],
    default: ['Sin pedir', 'var(--text-dim)'],
    unsupported: ['No soportado', 'var(--text-faint)'],
  };
  const [txt, color] = estados[permiso] ?? estados.default;

  box.append(h('div.card',
    h('div.alert__title', { style: { color: 'var(--accent)' } },
      svgIcon(ICONS.bell), 'Avisos al abrir la app'),
    h('div.field__hint', { style: { margin: '6px 0 12px' } },
      'Cada vez que abras la app te notifica si hay cobros próximos o sin confirmar. '
      + 'También al volver a ella tras un rato en segundo plano. Si no hay nada que '
      + 'decir, no molesta. Eso sí: si no abres la app, no te enteras — un navegador '
      + 'no puede programar una notificación para una fecha futura. Para eso está '
      + 'el calendario de arriba.'),
    h('div.kv',
      h('span.kv__k', 'Permiso de notificaciones'),
      h('span.kv__v', { style: { color } }, txt),
    ),
    permiso === 'default'
      ? h('button.btn.btn--block', {
          style: { marginTop: '10px' },
          onclick: async () => {
            await requestNotificationPermission();
            rerender();
          },
        }, 'Dar permiso')
      : null,
    permiso === 'granted'
      ? h('button.btn.btn--block', {
          style: { marginTop: '10px' },
          onclick: async () => {
            await testNotification();
            toast('Notificación enviada');
          },
        }, 'Probar notificación')
      : null,
    permiso === 'denied'
      ? h('div.note.note--warn', { style: { marginTop: '10px' } },
          'Lo bloqueaste. Para reactivarlo: candado de la barra de direcciones → '
          + 'Permisos → Notificaciones.')
      : null,
  ));

  return box;
}

function descargarICS(s) {
  const n = countICSEvents(getState());
  if (!n) return toast('No tienes gastos recurrentes que exportar');

  const ics = buildICS(getState(), { daysBefore: s.settings.notifyDaysBefore ?? 3 });
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cobros-gestor-cuentas.ics';
  a.click();
  URL.revokeObjectURL(url);
  toast(`${n} ${n === 1 ? 'cobro exportado' : 'cobros exportados'}`);
}

/* ------------------------------------------------------------ acciones -- */

function doExport() {
  const blob = new Blob([exportJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gestor-cuentas-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Copia descargada');
}

function doImport(rerender) {
  const input = h('input', { type: 'file', accept: 'application/json,.json' });
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const ok = await confirmDialog({
      title: '¿Importar y reemplazar?',
      message: `Se sustituirán todos los datos actuales por el contenido de "${file.name}". `
             + 'Lo que tengas ahora se perderá.',
      confirmText: 'Importar', danger: true,
    });
    if (!ok) return;
    try {
      importJSON(await file.text());
      toast('Copia importada');
      rerender();
    } catch (err) {
      toast('No se pudo importar: ' + err.message, 5000);
    }
  };
  input.click();
}

function categoriesModal(rerender) {
  let kind = 'gasto';

  modal({
    title: 'Categorías',
    onClose: rerender,
    render: () => {
      const body = h('div');

      const draw = () => {
        const list = categoriesFor(kind);
        const iconInput = h('input.input', { placeholder: '📦', maxlength: 4, style: { textAlign: 'center' } });
        const nameInput = h('input.input', { placeholder: 'Nombre de la categoría', maxlength: 30 });

        setChildren(body,
          h('div.segmented', { style: { marginBottom: '14px' } },
            ...[['gasto', 'Gastos'], ['ingreso', 'Ingresos']].map(([k, label]) =>
              h('button', {
                type: 'button', 'aria-pressed': String(kind === k),
                onclick: () => { kind = k; draw(); },
              }, label)),
          ),

          h('form', {
            style: { display: 'grid', gridTemplateColumns: '64px 1fr auto', gap: '8px', marginBottom: '16px' },
            onsubmit: (e) => {
              e.preventDefault();
              const name = nameInput.value.trim();
              if (!name) return markInvalid(nameInput, 'Escribe un nombre.');
              addCategory({ name, kind, icon: iconInput.value.trim() || '📦' });
              toast('Categoría añadida');
              draw();
            },
          }, iconInput, nameInput, h('button.btn.btn--primary', { type: 'submit' }, svgIcon(ICONS.plus))),

          h('div.list', ...list.map((c) => h('div.row', { style: { cursor: 'default' } },
            h('div.row__icon', c.icon),
            h('div.row__main', h('div.row__title', c.name)),
            h('button.btn.btn--ghost', {
              'aria-label': `Borrar ${c.name}`,
              onclick: async () => {
                const used = countUsage(c.id);
                const ok = await confirmDialog({
                  title: `¿Borrar "${c.name}"?`,
                  message: used
                    ? `${used} ${used === 1 ? 'registro usa' : 'registros usan'} esta categoría. `
                      + 'No se borrarán, pero pasarán a quedarse sin categoría.'
                    : 'No la usa ningún registro.',
                  confirmText: 'Borrar', danger: true,
                });
                if (ok) { deleteCategory(c.id); toast('Categoría borrada'); draw(); }
              },
            }, svgIcon(ICONS.trash)),
          ))),

          list.length ? null : h('div.small.faint.center', { style: { padding: '20px' } },
            'No hay categorías de este tipo.'),
        );
      };

      draw();
      return body;
    },
  });
}

function countUsage(catId) {
  const s = getState();
  return s.transactions.filter((t) => t.categoryId === catId).length
       + s.recurrings.filter((r) => r.categoryId === catId).length;
}

function storageSize() {
  try {
    const bytes = new Blob([localStorage.getItem('gestor-cuentas/v1') ?? '']).size;
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
  } catch {
    return '—';
  }
}

export const title = 'Ajustes';
